# Synopsis

Automatically registers IP addresses of EC2 instances to a Route 53 hosted zone. The function is invoked via EventBridge and registers resource record sets according to tags of instances.

## Tags

Tags to be considered are:

| Tag        | Description                                                                                                                      |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------- |
| HostedZone | The ID of the Route 53 hosted zone to which resource records will be created.  Only the instances having this tag are processed. |
| Name       | The host name to be used for CNAME records.  IDN is supported.                                                                   |
| HostName   | Same as `Name` but takes precedence.                                                                                             |

`A` and/or `AAAA` records will be created for each instances and `CNAME` record will be created if either `Name` or `HostName` tag is defined.  Public addresses are used for public hosted zones and private addresses for private hosted zones.

# Deployment

```
yarn cdk deploy
```

See [AWS CDK Developer Guide](https://docs.aws.amazon.com/cdk/latest/guide/cli.html#cli-deploy) for details.
