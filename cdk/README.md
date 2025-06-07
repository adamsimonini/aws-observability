# AWS Observability CDK Project

This project contains the CDK infrastructure code for AWS Observability.

## Stack Descriptions

### VpcStack

```bash
# Deploy
cdk deploy VpcStack

# Destroy
cdk destroy VpcStack
```

- Creates the networking foundation for your application
- Sets up a VPC (Virtual Private Cloud) with:
  - 1 Availability Zones for cost savings
  - 1 NAT Gateway for cost optimization
  - Public and private subnets
  - Internet Gateway for public internet access
- This is the most stable stack and rarely needs updates
- Other stacks depend on this for networking

### EcrStack

```bash
# Deploy
cdk deploy EcrStack

# Destroy
cdk destroy EcrStack
```

- Creates the Elastic Container Registry (ECR) repository
- Stores your Docker images
- Configured with:
  - Lifecycle rules to keep only the 5 most recent images
  - RETAIN removal policy to prevent accidental deletion
  - Repository name: "aws-observability-app"
- This stack is relatively stable and only needs updates if you change repository settings

### Image build

The image is build via a github action. The secrets on the repo provide github to a user with ECR permissions. It's builds the image within github and pushes the finished product to ECR.

### EcsStack

```bash
# Deploy
cdk deploy EcsStack

# Destroy
cdk destroy EcsStack
```

- Sets up your container orchestration environment
- Creates:
  - ECS Cluster with Container Insights enabled
  - Task Definition with proper IAM roles
  - Fargate Service with:
    - Automatic rollback on failures
    - Health check configurations
    - Security groups
    - Public IP assignment
- This is the most frequently updated stack as it contains your application configuration

## Deployment Strategy

1. Deploy in order from top to bottom due to dependencies
2. If you need to update your application:
   - Most changes will only require `cdk deploy EcsStack`
   - Rarely need to update VpcStack or EcrStack
3. CI/CD is handled by GitHub Actions:
   - Builds Docker images on push to main
   - Pushes images to ECR
   - Tags images with semantic versioning

## Best Practices

- Always deploy VpcStack first as other stacks depend on it
- Use `cdk diff` before deploying to see what changes will be made
- If a deployment fails, you can fix and redeploy just that stack
- Keep your ECR images clean using the lifecycle rules

## Destruction Strategy

1. Destroy in reverse order of deployment due to dependencies:
   ```bash
   cdk destroy EcsStack
   cdk destroy EcrStack
   cdk destroy VpcStack
   ```
2. Note: ECR repository has RETAIN policy, so you'll need to manually delete it if desired
3. Always use `cdk diff` before destroying to understand what will be removed
4. Consider backing up any important data before destruction
