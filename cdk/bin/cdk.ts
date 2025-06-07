#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { VpcStack } from "../lib/cdk-stack";
import { EcrStack } from "../lib/cdk-stack";
import { EcsStack } from "../lib/cdk-stack";

const app = new cdk.App();

// Create the VPC stack first
const vpcStack = new VpcStack(app, "VpcStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});

// Create the ECR stack
const ecrStack = new EcrStack(app, "EcrStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});

// Create the ECS stack, which depends on VPC and ECR
const ecsStack = new EcsStack(
  app,
  "EcsStack",
  vpcStack.vpc,
  ecrStack.repository,
  {
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT,
      region: process.env.CDK_DEFAULT_REGION,
    },
  }
);

// Add dependencies
ecsStack.addDependency(vpcStack);
ecsStack.addDependency(ecrStack);

app.synth();
