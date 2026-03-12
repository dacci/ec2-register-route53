import { awscdk } from 'projen';
import { JobPermission } from 'projen/lib/github/workflows-model';

const project = new awscdk.AwsCdkTypeScriptApp({
  name: 'ec2-register-route53',
  copyrightOwner: 'Shinya Tsuda',
  license: 'MIT',

  projenrcTs: true,
  buildWorkflow: false,
  release: false,
  defaultReleaseBranch: 'main',
  depsUpgrade: false,
  pullRequestTemplate: false,
  githubOptions: {
    pullRequestLint: false,
  },
  readme: {
    contents: `
    # Synopsis

    Automatically registers IP addresses of EC2 instances to a Route 53 hosted zone. The function is invoked via EventBridge and registers resource record sets according to tags of instances.

    ## Tags

    Tags to be considered are:

    | Tag        | Description                                                                                                                      |
    | ---------- | -------------------------------------------------------------------------------------------------------------------------------- |
    | HostedZone | The ID of the Route 53 hosted zone to which resource records will be created.  Only the instances having this tag are processed. |
    | Name       | The host name to be used for CNAME records.  IDN is supported.                                                                   |
    | HostName   | Same as \`Name\` but takes precedence.                                                                                             |

    \`A\` and/or \`AAAA\` records will be created for each instances and \`CNAME\` record will be created if either \`Name\` or \`HostName\` tag is defined.  Public addresses are used for public hosted zones and private addresses for private hosted zones.

    # Deployment

    \`\`\`
    yarn cdk deploy
    \`\`\`

    See [AWS CDK Developer Guide](https://docs.aws.amazon.com/cdk/latest/guide/cli.html#cli-deploy) for details.
    `,
  },

  cdkVersion: '2.233.0',
  deps: [
    '@aws-sdk/client-ec2',
    '@aws-sdk/client-route-53',
  ],
  devDeps: [
    'aws-sdk-client-mock',
    'aws-sdk-client-mock-jest',
  ],
});

const deploy = project.github?.addWorkflow('deploy');
deploy?.on({
  push: {
    branches: ['main'],
  },
});
deploy?.addJob('deploy', {
  permissions: {
    contents: JobPermission.WRITE,
    idToken: JobPermission.WRITE,
  },
  runsOn: ['ubuntu-latest'],
  steps: [
    {
      name: 'Checkout',
      uses: 'actions/checkout@v6'
    },
    {
      name: 'Setup Node.js',
      uses: 'actions/setup-node@v6',
      with: {
        'node-version': 24,
        cache: 'yarn'
      }
    },
    {
      name: 'Install dependencies',
      run: 'yarn install'
    },
    {
      name: 'Run tests',
      run: 'yarn test'
    },
    {
      name: 'Configure AWS credentials',
      uses: 'aws-actions/configure-aws-credentials@v6',
      with: {
        'role-to-assume': '${{ secrets.ACTIONS_ROLE_ARN }}',
        'aws-region': '${{ vars.AWS_REGION }}'
      }
    },
    {
      name: 'Deploy',
      run: 'yarn cdk deploy --ci --require-approval never'
    },
  ],
});

const mergeDependabotPr = project.github?.addWorkflow('merge-dependabot-pr');
mergeDependabotPr?.on({
  pullRequest: {},
});
mergeDependabotPr?.addJob('dependabot', {
  permissions: {
    pullRequests: JobPermission.WRITE,
    contents: JobPermission.WRITE,
  },
  if: "${{ github.actor == 'dependabot[bot]' }}",
  runsOn: ['ubuntu-latest'],
  steps: [
    {
      name: 'Merge Dependabot PR',
      env: {
        PR_URL: '${{ github.event.pull_request.html_url }}',
        GITHUB_TOKEN: '${{ secrets.GITHUB_TOKEN }}',
      },
      run: 'gh pr merge --auto --merge "$PR_URL"',
    },
  ],
});

project.synth();
