import { DescribeInstancesCommand, EC2Client, Instance } from '@aws-sdk/client-ec2';
import {
  Change,
  ChangeResourceRecordSetsCommand,
  GetHostedZoneCommand,
  HostedZone,
  ListResourceRecordSetsCommand,
  ResourceRecordSet,
  Route53Client
} from '@aws-sdk/client-route-53';
import punycode from 'punycode';

const HOSTED_ZONE = 'HostedZone';
const HOST_NAME = 'HostName';
const NAME = 'Name';
const TTL = 300;

const ec2 = new EC2Client({});
const route53 = new Route53Client({});

function getTagValue(resource: Instance, key: string): string | undefined {
  if (!resource.Tags) return;

  for (const tag of resource.Tags) {
    if (tag.Key === key) return tag.Value;
  }

  return undefined;
}

type Predicate<T> = (value: T) => boolean;

function byName(name: string): Predicate<ResourceRecordSet> {
  return ({ Name }) => Name === name;
}

function byValue(value: string): Predicate<ResourceRecordSet> {
  return (set) => !!set.ResourceRecords?.find(({ Value }) => Value === value);
}

function anyOf<T>(...predicates: Predicate<T>[]): Predicate<T> {
  return (value) => {
    for (const predicate of predicates) {
      if (predicate(value)) return true;
    }

    return false;
  };
}

type Task = (instance: Instance, hostedZone: HostedZone) => Promise<Change[]>;

export const register: Task = async (instance, hostedZone) => {
  const privateV4: string[] = [];
  const publicV4: string[] = [];
  const publicV6: string[] = [];
  instance.NetworkInterfaces?.forEach((eni) => {
    eni.PrivateIpAddresses?.forEach((addr) => {
      if (addr.PrivateIpAddress) privateV4.push(addr.PrivateIpAddress);
      if (addr.Association?.PublicIp) publicV4.push(addr.Association.PublicIp);
    });

    eni.Ipv6Addresses?.forEach((addr) => {
      if (addr.Ipv6Address) publicV6.push(addr.Ipv6Address);
    });
  });

  const name = `${instance.InstanceId}.${hostedZone.Name}`;
  const sets: ResourceRecordSet[] = [];
  const mapper = (Value: string) => ({ Value });
  if (hostedZone.Config?.PrivateZone) {
    if (privateV4.length) {
      sets.push({
        Name: name,
        Type: 'A',
        ResourceRecords: privateV4.map(mapper),
      });
    }
  } else {
    if (publicV4.length) {
      sets.push({
        Name: name,
        Type: 'A',
        ResourceRecords: publicV4.map(mapper),
      });
    }

    if (publicV6.length) {
      sets.push({
        Name: name,
        Type: 'AAAA',
        ResourceRecords: publicV6.map(mapper),
      });
    }
  }
  if (sets.length == 0) return [];

  let label = getTagValue(instance, HOST_NAME) || getTagValue(instance, NAME);
  if (label) {
    label = punycode.toASCII(label).replace(/[^!-~]/g, '_');

    sets.push({
      Name: `${label}.${hostedZone.Name}.`,
      Type: 'CNAME',
      ResourceRecords: [{ Value: name }],
    });
  }

  return sets.map((set) => ({
    Action: 'CREATE',
    ResourceRecordSet: {
      ...set,
      TTL,
    },
  }));
}

export const unregister: Task = async (instance, hostedZone) => {
  const fqdn = `${instance.InstanceId}.${hostedZone.Name}`;

  return route53
    .send(new ListResourceRecordSetsCommand({
      HostedZoneId: hostedZone.Id,
    }))
    .then((data) => data.ResourceRecordSets || [])
    .then((sets) => sets.filter((set) => set.ResourceRecords))
    .then((sets) => sets.filter(anyOf(byName(fqdn), byValue(fqdn))))
    .then((sets) => sets.map((set) => ({
      Action: 'DELETE',
      ResourceRecordSet: set,
    })));
}

export async function handler(event: any): Promise<void> {
  let task: Task;
  switch (event.detail.state) {
    case 'running':
      task = register;
      break;

    case 'stopped':
    case 'terminated':
      task = unregister;
      break;

    default:
      return;
  }

  const instance = await ec2
    .send(new DescribeInstancesCommand({
      InstanceIds: [event.detail['instance-id']],
      Filters: [{
        Name: 'tag-key',
        Values: [HOSTED_ZONE],
      }],
    }))
    .then((data) => data.Reservations?.flatMap((r) => r.Instances)[0]);
  if (!instance) {
    console.info('No maching instance.');
    return;
  }

  const zoneId = getTagValue(instance, HOSTED_ZONE);
  if (!zoneId) {
    console.info('No hosted zone assigned.')
    return;
  }

  const hostedZone = await route53
    .send(new GetHostedZoneCommand({ Id: zoneId }))
    .then((data) => ({
      ...data.HostedZone,
      Id: zoneId,
    }));

  const changes = await task(instance, hostedZone as HostedZone);
  if (!changes.length) {
    console.info('No changes.');
    return;
  }

  await route53
    .send(new ChangeResourceRecordSetsCommand({
      HostedZoneId: zoneId,
      ChangeBatch: { Changes: changes },
    }))
    .then((data) => console.info(JSON.stringify(data)));
}
