import * as cdk from "aws-cdk-lib";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as logs from "aws-cdk-lib/aws-logs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as wafv2 from "aws-cdk-lib/aws-wafv2";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { Construct } from "constructs";

// Base VPC Stack
export class VpcStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create IAM role for VPC operations
    const vpcRole = new iam.Role(this, "VpcRole", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
    });

    // Add necessary permissions
    vpcRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "ec2:AuthorizeSecurityGroupIngress",
          "ec2:RevokeSecurityGroupIngress",
          "ec2:AuthorizeSecurityGroupEgress",
          "ec2:RevokeSecurityGroupEgress",
          "ec2:CreateSecurityGroup",
          "ec2:DeleteSecurityGroup",
          "ec2:DescribeSecurityGroups",
        ],
        resources: ["*"],
      })
    );

    this.vpc = new ec2.Vpc(this, "AppVpc", {
      maxAzs: 2,
      natGateways: 1,
      vpcName: "AppVpc",
      ipAddresses: ec2.IpAddresses.cidr("172.16.0.0/16"),
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: "Public",
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: "Private",
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      ],
    });
  }
}

// ECR Stack
export class EcrStack extends cdk.Stack {
  public readonly repository: ecr.Repository;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.repository = new ecr.Repository(this, "AppRepository", {
      repositoryName: "aws-observability-app",
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          maxImageCount: 5,
          tagStatus: ecr.TagStatus.ANY,
        },
      ],
    });
  }
}

// DynamoDB Stack
export class DynamoDBStack extends cdk.Stack {
  public readonly table: dynamodb.Table;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.table = new dynamodb.Table(this, "AppTable", {
      tableName: "aws-observability-crypto-table",
      partitionKey: { name: "id", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "timestamp", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      timeToLiveAttribute: "ttl",
    });

    this.table.addGlobalSecondaryIndex({
      indexName: "timestamp-index",
      partitionKey: { name: "type", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "timestamp", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    new cloudwatch.Alarm(this, "ReadCapacityAlarm", {
      metric: this.table.metricConsumedReadCapacityUnits(),
      threshold: 1000,
      evaluationPeriods: 3,
      alarmDescription: "Alarm if read capacity exceeds 1000 units",
    });

    new cloudwatch.Alarm(this, "WriteCapacityAlarm", {
      metric: this.table.metricConsumedWriteCapacityUnits(),
      threshold: 1000,
      evaluationPeriods: 3,
      alarmDescription: "Alarm if write capacity exceeds 1000 units",
    });
  }
}

export class EcsStack extends cdk.Stack {
  constructor(
    scope: Construct,
    id: string,
    vpc: ec2.Vpc,
    repository: ecr.Repository,
    table: dynamodb.Table,
    props?: cdk.StackProps
  ) {
    super(scope, id, props);

    // Log Group for container logs
    const logGroup = new logs.LogGroup(this, "AppLogGroup", {
      logGroupName: "/ecs/aws-observability-app",
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ECS Cluster
    const cluster = new ecs.Cluster(this, "AppCluster", {
      vpc,
      clusterName: "AppCluster",
      containerInsights: true,
    });

    // Execution role: Required for ECS agent to pull images and send logs
    const executionRole = new iam.Role(this, "AppExecutionRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AmazonECSTaskExecutionRolePolicy"
        ),
      ],
    });

    // Task role: Role your container assumes, e.g., for DynamoDB access
    const taskRole = new iam.Role(this, "AppTaskRole", {
      roleName: "AppTaskRole",
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      description: "IAM role assumed by ECS tasks",
    });

    // Grant DynamoDB read/write to the task role
    table.grantReadWriteData(taskRole);

    // Fargate Task Definition with executionRole and taskRole
    const taskDefinition = new ecs.FargateTaskDefinition(this, "AppTaskDef", {
      taskRole,
      executionRole,
      memoryLimitMiB: 512,
      cpu: 256,
    });

    // Container definition
    const container = taskDefinition.addContainer("AppContainer", {
      image: ecs.ContainerImage.fromEcrRepository(repository, "latest"),
      logging: ecs.LogDrivers.awsLogs({
        logGroup,
        streamPrefix: "app",
      }),
      portMappings: [{ containerPort: 3000 }],
    });

    // Create WAF Web ACL
    const webAcl = new wafv2.CfnWebACL(this, "AppWebACL", {
      defaultAction: { allow: {} },
      scope: "REGIONAL",
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: "AppWebACLMetric",
        sampledRequestsEnabled: true,
      },
      rules: [
        {
          name: "RateLimit",
          priority: 1,
          statement: {
            rateBasedStatement: {
              limit: 500,
              aggregateKeyType: "IP",
            },
          },
          action: { block: {} },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: "RateLimitMetric",
            sampledRequestsEnabled: true,
          },
        },
        {
          name: "AWSManagedRulesCommonRuleSet",
          priority: 2,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: "AWS",
              name: "AWSManagedRulesCommonRuleSet",
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: "AWSManagedRulesCommonRuleSetMetric",
            sampledRequestsEnabled: true,
          },
        },
      ],
    });

    // Security Group for the Fargate service
    const securityGroup = new ec2.SecurityGroup(this, "AppServiceSG", {
      vpc,
      description: "Security group for the app service",
      allowAllOutbound: true,
    });

    // Allow HTTP traffic from anywhere (WAF will handle the security)
    securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(3000),
      "Allow inbound HTTP traffic (protected by WAF)"
    );

    // Create ALB Security Group
    const albSecurityGroup = new ec2.SecurityGroup(this, "AlbSecurityGroup", {
      vpc,
      description: "Security group for the ALB",
      allowAllOutbound: true,
    });

    // Allow inbound HTTP traffic to ALB
    albSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      "Allow inbound HTTP traffic to ALB"
    );

    // Create Application Load Balancer
    const alb = new elbv2.ApplicationLoadBalancer(this, "AppAlb", {
      vpc,
      internetFacing: true,
      securityGroup: albSecurityGroup,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    });

    // Attach WAF to ALB
    new wafv2.CfnWebACLAssociation(this, "WebACLAssociation", {
      resourceArn: alb.loadBalancerArn,
      webAclArn: webAcl.attrArn,
    });

    // Add HTTP listener
    const listener = alb.addListener("HttpListener", {
      port: 80,
      open: true,
    });

    // Modify Fargate Service to use ALB
    const service = new ecs.FargateService(this, "AppService", {
      cluster,
      taskDefinition,
      desiredCount: 1,
      assignPublicIp: false,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [securityGroup],
      circuitBreaker: { rollback: true },
      maxHealthyPercent: 200,
      minHealthyPercent: 50,
      enableECSManagedTags: true,
      propagateTags: ecs.PropagatedTagSource.SERVICE,
    });

    // Add target group
    const targetGroup = listener.addTargets("AppTargetGroup", {
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [service],
      healthCheck: {
        path: "/health",
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        healthyHttpCodes: "200",
      },
    });

    // Output the ALB DNS name
    new cdk.CfnOutput(this, "LoadBalancerDNS", {
      value: alb.loadBalancerDnsName,
      description: "The DNS name of the load balancer",
    });

    // CloudWatch Alarms
    new cloudwatch.Alarm(this, "HighCPUAlarm", {
      metric: service.metricCpuUtilization(),
      threshold: 80,
      evaluationPeriods: 3,
      alarmDescription: "Alarm if CPU exceeds 80%",
    });

    new cloudwatch.Alarm(this, "HighMemoryAlarm", {
      metric: service.metricMemoryUtilization(),
      threshold: 80,
      evaluationPeriods: 3,
      alarmDescription: "Alarm if memory exceeds 80%",
    });

    // CloudWatch Dashboard
    const dashboard = new cloudwatch.Dashboard(this, "AppDashboard", {
      dashboardName: "AppDashboard",
    });

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: "CPU Utilization",
        left: [service.metricCpuUtilization()],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: "Memory Utilization",
        left: [service.metricMemoryUtilization()],
        width: 12,
      }),
      new cloudwatch.LogQueryWidget({
        title: "Application Logs",
        logGroupNames: [logGroup.logGroupName],
        queryString:
          "SOURCE '/ecs/aws-observability-app' | fields @timestamp, @message\n| sort @timestamp desc\n| limit 20",
        width: 24,
        height: 6,
      })
    );
  }
}
