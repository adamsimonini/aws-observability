#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { VpcStack } from "../lib/cdk-stack";
import { EcrStack } from "../lib/cdk-stack";
import { EcsStack } from "../lib/cdk-stack";
import { DynamoDBStack } from "../lib/cdk-stack";

const app = new cdk.App();

// Define environment using environment variables
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

// Create stacks
const vpcStack = new VpcStack(app, "VpcStack", { env });
const ecrStack = new EcrStack(app, "EcrStack", { env });
const dynamoDBStack = new DynamoDBStack(app, "DynamoDBStack", { env });
const ecsStack = new EcsStack(
  app,
  "EcsStack",
  vpcStack.vpc,
  ecrStack.repository,
  dynamoDBStack.table,
  { env }
);

// Add dependencies
ecsStack.addDependency(vpcStack);
ecsStack.addDependency(ecrStack);
ecsStack.addDependency(dynamoDBStack);

app.synth();
