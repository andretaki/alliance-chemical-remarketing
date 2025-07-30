#!/bin/bash

# Deploy Alliance Chemical Scheduled Cart Checker to AWS Lambda
echo "Deploying Alliance Chemical Scheduled Cart Checker..."

# Set AWS region
export AWS_DEFAULT_REGION=us-east-2

# Create deployment package
echo "Creating deployment package..."
zip -r scheduled-cart-checker.zip scheduled-cart-checker.js package.json node_modules/

# Create IAM role if it doesn't exist
ROLE_NAME="alliance-scheduled-cart-checker-role"
ROLE_ARN=$(aws iam get-role --role-name $ROLE_NAME --query 'Role.Arn' --output text 2>/dev/null)

if [ "$ROLE_ARN" = "" ]; then
    echo "Creating IAM role..."
    
    # Create trust policy
    cat > trust-policy.json << EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Principal": {
                "Service": "lambda.amazonaws.com"
            },
            "Action": "sts:AssumeRole"
        }
    ]
}
EOF

    aws iam create-role \
        --role-name $ROLE_NAME \
        --assume-role-policy-document file://trust-policy.json

    # Attach basic Lambda execution policy
    aws iam attach-role-policy \
        --role-name $ROLE_NAME \
        --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

    # Wait for role to be available
    echo "Waiting for IAM role to be ready..."
    sleep 10
    
    ROLE_ARN=$(aws iam get-role --role-name $ROLE_NAME --query 'Role.Arn' --output text)
    rm trust-policy.json
fi

echo "Using IAM Role: $ROLE_ARN"

# Check if Lambda function exists
FUNCTION_EXISTS=$(aws lambda get-function --function-name alliance-scheduled-cart-checker 2>/dev/null)

if [ "$FUNCTION_EXISTS" = "" ]; then
    echo "Creating Lambda function..."
    aws lambda create-function \
        --function-name alliance-scheduled-cart-checker \
        --runtime nodejs18.x \
        --role $ROLE_ARN \
        --handler scheduled-cart-checker.handler \
        --zip-file fileb://scheduled-cart-checker.zip \
        --description "Alliance Chemical scheduled cart recovery checker" \
        --timeout 60 \
        --memory-size 256 \
        --environment Variables="{
            AZURE_CLIENT_ID=$AZURE_CLIENT_ID,
            AZURE_CLIENT_SECRET=$AZURE_CLIENT_SECRET,
            AZURE_TENANT_ID=$AZURE_TENANT_ID,
            DATABASE_URL=$DATABASE_URL,
            OPENAI_API_KEY=$OPENAI_API_KEY,
            SHOPIFY_ACCESS_TOKEN=$SHOPIFY_ACCESS_TOKEN,
            SHOPIFY_SHOP_DOMAIN=$SHOPIFY_SHOP_DOMAIN
        }"
else
    echo "Updating existing Lambda function..."
    aws lambda update-function-code \
        --function-name alliance-scheduled-cart-checker \
        --zip-file fileb://scheduled-cart-checker.zip

    aws lambda update-function-configuration \
        --function-name alliance-scheduled-cart-checker \
        --environment Variables="{
            AZURE_CLIENT_ID=$AZURE_CLIENT_ID,
            AZURE_CLIENT_SECRET=$AZURE_CLIENT_SECRET,
            AZURE_TENANT_ID=$AZURE_TENANT_ID,
            DATABASE_URL=$DATABASE_URL,
            OPENAI_API_KEY=$OPENAI_API_KEY,
            SHOPIFY_ACCESS_TOKEN=$SHOPIFY_ACCESS_TOKEN,
            SHOPIFY_SHOP_DOMAIN=$SHOPIFY_SHOP_DOMAIN
        }"
fi

# Create EventBridge rule for scheduling
RULE_NAME="alliance-scheduled-cart-checker-rule"
echo "Setting up EventBridge rule for 30-minute scheduling..."

aws events put-rule \
    --name $RULE_NAME \
    --schedule-expression "rate(30 minutes)" \
    --description "Trigger Alliance Chemical cart checker every 30 minutes" \
    --state ENABLED

# Add permission for EventBridge to invoke Lambda
aws lambda add-permission \
    --function-name alliance-scheduled-cart-checker \
    --statement-id allow-eventbridge \
    --action lambda:InvokeFunction \
    --principal events.amazonaws.com \
    --source-arn arn:aws:events:us-east-2:$(aws sts get-caller-identity --query Account --output text):rule/$RULE_NAME \
    2>/dev/null || echo "Permission already exists"

# Add Lambda function as target to EventBridge rule
aws events put-targets \
    --rule $RULE_NAME \
    --targets "Id"="1","Arn"="arn:aws:lambda:us-east-2:$(aws sts get-caller-identity --query Account --output text):function:alliance-scheduled-cart-checker"

echo "Deployment complete!"
echo "Lambda Function: alliance-scheduled-cart-checker"
echo "EventBridge Rule: $RULE_NAME (runs every 30 minutes)"
echo "Region: us-east-2"

# Clean up
rm scheduled-cart-checker.zip

# Test the function
echo "Testing function..."
aws lambda invoke \
    --function-name alliance-scheduled-cart-checker \
    --payload '{}' \
    test-output.json

echo "Test result:"
cat test-output.json
rm test-output.json

echo "Scheduled cart checker deployment complete!"