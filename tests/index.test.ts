import { Instance } from 'aws-sdk/clients/ec2';
import { HostedZone, ListResourceRecordSetsResponse } from 'aws-sdk/clients/route53';
import { ec2, handler, register, route53, unregister } from '../src';

jest.mock('aws-sdk');

describe('Lambda handler', () => {
  it('register', async () => {
    ec2.describeInstances = jest.fn().mockReturnValue({
      promise: () => Promise.resolve({
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
      }),
    });
    route53.getHostedZone = jest.fn().mockReturnValue({
      promise: () => Promise.resolve({
        HostedZone: {},
      }),
    });
    route53.changeResourceRecordSets = jest.fn().mockReturnValue({
      promise: () => Promise.resolve({}),
    });

    await handler({
      detail: {
        'instance-id': 'i-dummy',
        state: 'running',
      },
    });

    expect(route53.changeResourceRecordSets).toBeCalled();
  });

  it('unregister', async () => {
    ec2.describeInstances = jest.fn().mockReturnValue({
      promise: () => Promise.resolve({
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
      }),
    });
    route53.getHostedZone = jest.fn().mockReturnValue({
      promise: () => Promise.resolve({
        HostedZone: {
          Name: 'example.org.',
        },
      }),
    });
    route53.listResourceRecordSets = jest.fn().mockReturnValue({
      promise: () => Promise.resolve({
        ResourceRecordSets: [
          {
            Name: 'i-dummy.example.org.',
            ResourceRecords: [],
          },
        ],
      }),
    });
    route53.changeResourceRecordSets = jest.fn().mockReturnValue({
      promise: () => Promise.resolve({}),
    });

    await handler({
      detail: {
        'instance-id': 'i-dummy',
        state: 'stopped',
      },
    });

    expect(ec2.describeInstances).toBeCalled();
    expect(route53.getHostedZone).toBeCalled();
    expect(route53.listResourceRecordSets).toBeCalled();
    expect(route53.changeResourceRecordSets).toBeCalled();
  });

  it('event to be ignored', async () => {
    ec2.describeInstances = jest.fn();
    route53.changeResourceRecordSets = jest.fn();

    await handler({
      detail: {
        state: 'pending',
      },
    });

    expect(ec2.describeInstances).not.toBeCalled();
    expect(route53.changeResourceRecordSets).not.toBeCalled();
  });

  it('No maching instance', async () => {
    ec2.describeInstances = jest.fn().mockReturnValue({
      promise: () => Promise.resolve({}),
    });
    route53.changeResourceRecordSets = jest.fn();

    await handler({
      detail: {
        'instance-id': 'i-dummy',
        state: 'running',
      },
    });

    expect(ec2.describeInstances).toBeCalled();
    expect(route53.changeResourceRecordSets).not.toBeCalled();
  });

  it('No hosted zone assigned', async () => {
    ec2.describeInstances = jest.fn().mockReturnValue({
      promise: () => Promise.resolve({
        Reservations: [
          {
            Instances: [
              {
                Tags: [],
              },
            ],
          },
        ],
      }),
    });
    route53.changeResourceRecordSets = jest.fn();

    await handler({
      detail: {
        'instance-id': 'i-dummy',
        state: 'stopped',
      },
    });

    expect(ec2.describeInstances).toBeCalled();
    expect(route53.changeResourceRecordSets).not.toBeCalled();
  });

  it('No changes', async () => {
    ec2.describeInstances = jest.fn().mockReturnValue({
      promise: () => Promise.resolve({
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
      }),
    });
    route53.getHostedZone = jest.fn().mockReturnValue({
      promise: () => Promise.resolve({
        HostedZone: {},
      }),
    });
    route53.listResourceRecordSets = jest.fn().mockReturnValue({
      promise: () => Promise.resolve({
        ResourceRecordSets: [],
      }),
    });
    route53.changeResourceRecordSets = jest.fn();

    await handler({
      detail: {
        'instance-id': 'i-dummy',
        state: 'terminated',
      },
    });

    expect(ec2.describeInstances).toBeCalled();
    expect(route53.getHostedZone).toBeCalled();
    expect(route53.listResourceRecordSets).toBeCalled();
    expect(route53.changeResourceRecordSets).not.toBeCalled();
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
    expect(actual[0].ResourceRecordSet.Type).toBe('A');
    expect(actual[0].ResourceRecordSet.ResourceRecords).toHaveLength(1);
    expect(actual[1].ResourceRecordSet.Type).toBe('AAAA');
    expect(actual[1].ResourceRecordSet.ResourceRecords).toHaveLength(1);
    expect(actual[2].ResourceRecordSet.Type).toBe('CNAME');
    expect(actual[2].ResourceRecordSet.ResourceRecords).toHaveLength(1);
  });

  it('private zone', async () => {
    hostedZone.Config = { PrivateZone: true };

    const actual = await register(instance, hostedZone);

    expect(actual).toHaveLength(2);
    expect(actual[0].ResourceRecordSet.Type).toBe('A');
    expect(actual[0].ResourceRecordSet.ResourceRecords).toHaveLength(1);
    expect(actual[1].ResourceRecordSet.Type).toBe('CNAME');
    expect(actual[1].ResourceRecordSet.ResourceRecords).toHaveLength(1);
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

  const response: ListResourceRecordSetsResponse = {
    ResourceRecordSets: [
      {
        Name: 'test.example.org.',
        Type: 'CNAME',
        ResourceRecords: [
          {
            Value: 'i-dummy.example.org.',
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
    MaxItems: '',
  };

  it('dedicated records only', async () => {
    route53.listResourceRecordSets = jest.fn().mockReturnValue({
      promise: () => Promise.resolve(response),
    });

    const actual = await unregister(instance, hostedZone);

    expect(actual).toHaveLength(2);
    expect(actual[0].ResourceRecordSet.Type).toBe('CNAME');
    expect(actual[1].ResourceRecordSet.Type).toBe('A');
  });
});
