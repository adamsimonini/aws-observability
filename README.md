# aws-observability

local-aws-deployment-observability

### Confirm identity in AWS - required if credentials are off

```
aws sts get-caller-identity
aws configure list
aws configure list-profiles
export AWS_PROFILE=adam-aws
```

### Get authorization to ECR and push built image

```
# Get ECR login token and login
aws ecr get-login-password --region <your-region> | docker login --username AWS --password-stdin <your-account-id>.dkr.ecr.<your-region>.amazonaws.com

# Build the Docker image
docker build -t aws-observability-app .

# Tag the image for ECR
docker tag aws-observability-app:latest <your-account-id>.dkr.ecr.<your-region>.amazonaws.com/aws-observability-app:latest

# Push to ECR
docker push <your-account-id>.dkr.ecr.<your-region>.amazonaws.com/aws-observability-app:latest
```

### Use CDK to deploy infrastructure

```
# Navigate to the CDK directory
cd cdk

# Synthesize the CloudFormation template
npx cdk synth

# Deploy the stack
npx cdk deploy
```

```
cdk synth
cdk deploy
```

## Accessing the Application

After deployment, you can access your application through the public IP assigned to your Fargate task. Here's how to find the URL:

### Finding the URL in AWS Console

#### Method 1: Through ECS Console

1. Go to the AWS Console
2. Navigate to ECS (Elastic Container Service)
3. Click on your cluster "AppCluster"
4. Click on the "Tasks" tab
5. Click on your running task
6. In the task details, look for the "Network" section
7. You'll see the "Public IP" listed there

#### Method 2: Through EC2 Console

1. Go to EC2 in the AWS Console
2. Click on "Network Interfaces" in the left sidebar
3. Look for the ENI (Elastic Network Interface) that's attached to your ECS task
4. The public IP will be listed in the "Public IPv4 address" column

### Accessing the Application

Once you have the public IP, you can access the application by adding the port number `:3000` to the IP address. For example:

- Main page: `http://<public-ip>:3000/`
- Health check: `http://<public-ip>:3000/health`
- Metrics: `http://<public-ip>:3000/metrics`

Note: The public IP may change if the task is restarted, as it's dynamically assigned.

## Deployment

### Deploy All Stacks

```bash
cdk deploy --all
```

### Deploy Individual Stacks

```bash
# Deploy VPC Stack (must be deployed first)
cdk deploy VpcStack

# Deploy ECR Stack
cdk deploy EcrStack

# Deploy ECS Stack
cdk deploy EcsStack
```

### Destroy Stacks

```bash
# Destroy all stacks
cdk destroy --all

# Or destroy individual stacks (in reverse order)
cdk destroy EcsStack
cdk destroy EcrStack
cdk destroy VpcStack
```

Note: The ECR repository has a RETAIN policy to prevent accidental deletion. You'll need to manually delete it if desired.
