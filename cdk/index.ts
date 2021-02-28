import { App, Duration, RemovalPolicy, Stack } from '@aws-cdk/core';
import { NodejsFunction } from '@aws-cdk/aws-lambda-nodejs';
import { Runtime } from '@aws-cdk/aws-lambda';
import { PolicyStatement } from '@aws-cdk/aws-iam';
import { LogGroup, RetentionDays } from '@aws-cdk/aws-logs';
import { Rule } from '@aws-cdk/aws-events';
import { LambdaFunction } from '@aws-cdk/aws-events-targets';

const app = new App();

const stack = new Stack(app, 'Stack', {
  stackName: 'ec2-register-route53',
});

const handler = new NodejsFunction(stack, 'Handler', {
  entry: 'src/index.ts',
  runtime: Runtime.NODEJS_14_X,
  bundling: {
    minify: true,
    sourceMap: true,
  },
  timeout: Duration.minutes(1),
  environment: {
    NODE_OPTIONS: '--enable-source-maps',
  },
});

handler.configureAsyncInvoke({
  maxEventAge: Duration.minutes(1),
  retryAttempts: 0,
});

handler.addToRolePolicy(new PolicyStatement({
  actions: [
    'ec2:DescribeInstances',
  ],
  resources: [
    '*',
  ],
}));

handler.addToRolePolicy(new PolicyStatement({
  actions: [
    'route53:GetHostedZone',
    'route53:ChangeResourceRecordSets',
    'route53:ListResourceRecordSets',
  ],
  resources: [
    stack.formatArn({
      service: 'route53',
      region: '',
      account: '',
      resource: 'hostedzone',
      resourceName: '*',
    }),
  ],
}));

new LogGroup(handler, 'LogGroup', {
  logGroupName: `/aws/lambda/${handler.functionName}`,
  retention: RetentionDays.ONE_DAY,
  removalPolicy: RemovalPolicy.DESTROY,
});

new Rule(stack, 'Rule', {
  eventPattern: {
    source: [
      'aws.ec2',
    ],
    detailType: [
      'EC2 Instance State-change Notification',
    ],
    detail: {
      state: [
        'running',
        'stopped',
        'terminated',
      ],
    },
  },
  targets: [
    new LambdaFunction(handler),
  ],
});
