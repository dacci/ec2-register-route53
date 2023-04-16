import * as cdk from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as events_targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambda_nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export class Stack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: cdk.StackProps = {}) {
    super(scope, id, props);

    const handler = new lambda_nodejs.NodejsFunction(this, 'Handler', {
      entry: 'app/index.ts',
      runtime: lambda.Runtime.NODEJS_18_X,
      bundling: {
        minify: true,
        sourceMap: true,
      },
      timeout: cdk.Duration.minutes(1),
      environment: {
        NODE_OPTIONS: '--enable-source-maps',
      },
      architecture: lambda.Architecture.ARM_64,
      maxEventAge: cdk.Duration.minutes(1),
      retryAttempts: 0,
    });

    handler.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'ec2:DescribeInstances',
      ],
      resources: [
        '*',
      ],
    }));

    handler.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'route53:GetHostedZone',
        'route53:ChangeResourceRecordSets',
        'route53:ListResourceRecordSets',
      ],
      resources: [
        this.formatArn({
          service: 'route53',
          region: '',
          account: '',
          resource: 'hostedzone',
          resourceName: '*',
        }),
      ],
    }));

    new logs.LogGroup(handler, 'LogGroup', {
      logGroupName: `/aws/lambda/${handler.functionName}`,
      retention: logs.RetentionDays.ONE_DAY,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    new events.Rule(this, 'Rule', {
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
        new events_targets.LambdaFunction(handler),
      ],
    });
  }
}

const app = new cdk.App();

new Stack(app, 'Stack', {
  stackName: 'ec2-register-route53',
});

app.synth();
