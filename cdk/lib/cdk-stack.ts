import * as cdk from "aws-cdk-lib";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as logs from "aws-cdk-lib/aws-logs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";

// Base VPC Stack
export class VpcStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.vpc = new ec2.Vpc(this, "AppVpc", {
      maxAzs: 1,
      natGateways: 0,
      vpcName: "AppVpc",
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

    // Security Group for the Fargate service
    const securityGroup = new ec2.SecurityGroup(this, "AppServiceSG", {
      vpc,
      description: "Security group for the app service",
      allowAllOutbound: true,
    });

    // Only allow HTTP traffic from specific IP
    securityGroup.addIngressRule(
      ec2.Peer.ipv4("216.25.243.88/32"),
      ec2.Port.tcp(3000),
      "Allow inbound HTTP traffic from specific IP"
    );

    // Fargate Service with assignPublicIp enabled on public subnets
    const service = new ecs.FargateService(this, "AppService", {
      cluster,
      taskDefinition,
      desiredCount: 1,
      assignPublicIp: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroups: [securityGroup],
      circuitBreaker: { rollback: true },
      maxHealthyPercent: 200,
      minHealthyPercent: 50,
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
