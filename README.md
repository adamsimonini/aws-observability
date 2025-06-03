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
