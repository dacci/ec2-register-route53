import { DescribeInstancesCommand, EC2Client, Instance } from '@aws-sdk/client-ec2';
import {
  ChangeResourceRecordSetsCommand,
  GetHostedZoneCommand,
  HostedZone,
  ListResourceRecordSetsCommand,
  Route53Client,
} from '@aws-sdk/client-route-53';
import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';
import { handler, register, unregister } from '../app';

const ec2 = mockClient(EC2Client);
const route53 = mockClient(Route53Client);
afterEach(() => {
  ec2.reset();
  route53.reset();
});

describe('Lambda handler', () => {
  it('register', async () => {
    ec2
      .on(DescribeInstancesCommand)
      .resolves({
        Reservations: [
          {
            Instances: [
              {
                NetworkInterfaces: [
                  {
                    PrivateIpAddresses: [
                      {
                        Association: {
                          PublicIp: '0.0.0.0',
                        },
                      },
                    ],
                  },
                ],
                Tags: [
                  {
                    Key: 'HostedZone',
                    Value: 'DUMMY',
                  },
                ],
              },
            ],
          },
        ],
      });
    route53
      .on(GetHostedZoneCommand)
      .resolves({
        HostedZone: {
          Id: undefined,
          Name: undefined,
          CallerReference: undefined,
        },
      })
      .on(ChangeResourceRecordSetsCommand)
      .resolves({});

    await handler({
      detail: {
        'instance-id': 'i-dummy',
        'state': 'running',
      },
    });

    expect(route53).toHaveReceivedCommand(ChangeResourceRecordSetsCommand);
  });

  it('unregister', async () => {
    ec2
      .on(DescribeInstancesCommand)
      .resolves({
        Reservations: [
          {
            Instances: [
              {
                InstanceId: 'i-dummy',
                Tags: [
                  {
                    Key: 'HostedZone',
                    Value: 'DUMMY',
                  },
                ],
              },
            ],
          },
        ],
      });
    route53
      .on(GetHostedZoneCommand)
      .resolves({
        HostedZone: {
          Id: undefined,
          Name: 'example.org.',
          CallerReference: undefined,
        },
      })
      .on(ListResourceRecordSetsCommand)
      .resolves({
        ResourceRecordSets: [
          {
            Name: 'i-dummy.example.org.',
            Type: 'A',
            ResourceRecords: [],
          },
        ],
      })
      .on(ChangeResourceRecordSetsCommand)
      .resolves({});

    await handler({
      detail: {
        'instance-id': 'i-dummy',
        'state': 'stopped',
      },
    });

    expect(ec2).toHaveReceivedCommand(DescribeInstancesCommand);
    expect(route53).toHaveReceivedCommand(GetHostedZoneCommand);
    expect(route53).toHaveReceivedCommand(ListResourceRecordSetsCommand);
    expect(route53).toHaveReceivedCommand(ChangeResourceRecordSetsCommand);
  });

  it('event to be ignored', async () => {
    await handler({
      detail: {
        state: 'pending',
      },
    });

    expect(ec2).not.toHaveReceivedCommand(DescribeInstancesCommand);
    expect(route53).not.toHaveReceivedCommand(ChangeResourceRecordSetsCommand);
  });

  it('No maching instance', async () => {
    ec2
      .on(DescribeInstancesCommand)
      .resolves({});

    await handler({
      detail: {
        'instance-id': 'i-dummy',
        'state': 'running',
      },
    });

    expect(ec2).toHaveReceivedCommand(DescribeInstancesCommand);
    expect(route53).not.toHaveReceivedCommand(ChangeResourceRecordSetsCommand);
  });

  it('No hosted zone assigned', async () => {
    ec2
      .on(DescribeInstancesCommand)
      .resolves({
        Reservations: [
          {
            Instances: [
              {
                Tags: [],
              },
            ],
          },
        ],
      });

    await handler({
      detail: {
        'instance-id': 'i-dummy',
        'state': 'stopped',
      },
    });

    expect(ec2).toHaveReceivedCommand(DescribeInstancesCommand);
    expect(route53).not.toHaveReceivedCommand(ChangeResourceRecordSetsCommand);
  });

  it('No changes', async () => {
    ec2
      .on(DescribeInstancesCommand)
      .resolves({
        Reservations: [
          {
            Instances: [
              {
                Tags: [
                  {
                    Key: 'HostedZone',
                    Value: 'DUMMY',
                  },
                ],
              },
            ],
          },
        ],
      });
    route53
      .on(GetHostedZoneCommand)
      .resolves({
        HostedZone: {
          Id: undefined,
          Name: undefined,
          CallerReference: undefined,
        },
      })
      .on(ListResourceRecordSetsCommand)
      .resolves({
        ResourceRecordSets: [],
      });

    await handler({
      detail: {
        'instance-id': 'i-dummy',
        'state': 'terminated',
      },
    });

    expect(ec2).toHaveReceivedCommand(DescribeInstancesCommand);
    expect(route53).toHaveReceivedCommand(GetHostedZoneCommand);
    expect(route53).toHaveReceivedCommand(ListResourceRecordSetsCommand);
    expect(route53).not.toHaveReceivedCommand(ChangeResourceRecordSetsCommand);
  });
});

describe('register', () => {
  const instance: Instance = {
    NetworkInterfaces: [
      {
        PrivateIpAddresses: [
          {
            PrivateIpAddress: 'PrivateIpAddress',
            Association: {
              PublicIp: 'PublicIp',
            },
          },
        ],
        Ipv6Addresses: [
          {
            Ipv6Address: 'Ipv6Address',
          },
        ],
      },
    ],
    Tags: [
      {
        Key: 'Name',
        Value: 'dummy',
      },
    ],
  };

  const hostedZone: HostedZone = {
    Id: 'Id',
    Name: 'Name',
    CallerReference: 'CallerReference',
  };

  it('public zone', async () => {
    hostedZone.Config = { PrivateZone: false };

    const actual = await register(instance, hostedZone);

    expect(actual).toHaveLength(3);
    expect(actual?.[0].ResourceRecordSet?.Type).toBe('A');
    expect(actual?.[0].ResourceRecordSet?.ResourceRecords).toHaveLength(1);
    expect(actual?.[1].ResourceRecordSet?.Type).toBe('AAAA');
    expect(actual?.[1].ResourceRecordSet?.ResourceRecords).toHaveLength(1);
    expect(actual?.[2].ResourceRecordSet?.Type).toBe('CNAME');
    expect(actual?.[2].ResourceRecordSet?.ResourceRecords).toHaveLength(1);
  });

  it('private zone', async () => {
    hostedZone.Config = { PrivateZone: true };

    const actual = await register(instance, hostedZone);

    expect(actual).toHaveLength(2);
    expect(actual?.[0].ResourceRecordSet?.Type).toBe('A');
    expect(actual?.[0].ResourceRecordSet?.ResourceRecords).toHaveLength(1);
    expect(actual?.[1].ResourceRecordSet?.Type).toBe('CNAME');
    expect(actual?.[1].ResourceRecordSet?.ResourceRecords).toHaveLength(1);
  });
});

describe('unregister', () => {
  const instance: Instance = {
    InstanceId: 'i-dummy',
  };

  const hostedZone: HostedZone = {
    Id: 'Id',
    Name: 'example.org.',
    CallerReference: 'CallerReference',
  };

  it('dedicated records only', async () => {
    route53
      .on(ListResourceRecordSetsCommand)
      .resolves({
        ResourceRecordSets: [
          {
            Name: 'test.example.org.',
            Type: 'CNAME',
            ResourceRecords: [
              {
                Value: 'i-dummy.example.org',
              },
            ],
          },
          {
            Name: 'i-dummy.example.org.',
            Type: 'A',
            ResourceRecords: [],
          },
          {
            Name: 'example.org.',
            Type: 'SOA',
            ResourceRecords: [],
          },
        ],
        IsTruncated: false,
        MaxItems: 0,
      });

    const actual = await unregister(instance, hostedZone);

    expect(actual).toHaveLength(2);
    expect(actual?.[0].ResourceRecordSet?.Type).toBe('CNAME');
    expect(actual?.[1].ResourceRecordSet?.Type).toBe('A');
  });
});
