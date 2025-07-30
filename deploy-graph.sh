#!/bin/bash
set -e

echo "🚀 Alliance Chemical Remarketing - Microsoft Graph API Deployment"
echo "=============================================================="

# Environment setup
export AWS_REGION="us-east-2" 
export DATABASE_URL="${DATABASE_URL:-your_database_url}"

# Check required Azure credentials
if [ -z "$AZURE_CLIENT_ID" ] || [ -z "$AZURE_CLIENT_SECRET" ] || [ -z "$AZURE_TENANT_ID" ]; then
    echo "❌ Please set Azure credentials:"
    echo "   export AZURE_CLIENT_ID='your_app_registration_id'"
    echo "   export AZURE_CLIENT_SECRET='your_client_secret'"
    echo "   export AZURE_TENANT_ID='your_tenant_id'"
    exit 1
fi

# Get AWS account ID
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "AWS Account: $ACCOUNT_ID"

# Create Lambda execution role
echo "🔐 Creating Lambda execution role..."
ROLE_ARN=$(aws iam create-role \
  --role-name alliance-remarketing-graph-role \
  --assume-role-policy-document '{
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
  }' \
  --query 'Role.Arn' \
  --output text 2>/dev/null || echo "arn:aws:iam::$ACCOUNT_ID:role/alliance-remarketing-graph-role")

# Attach basic execution policy
aws iam attach-role-policy \
  --role-name alliance-remarketing-graph-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole \
  2>/dev/null || echo "Basic policy already attached"

# Wait for role to be ready
echo "⏳ Waiting for IAM role to propagate..."
sleep 15

# Create Lambda function code
mkdir -p lambda-functions-graph
cd lambda-functions-graph

# Copy the Graph webhook handler
cp ../webhook-handler-graph.js webhook-handler.js

# Package.json for Lambda with Graph API
cat > package.json << 'EOF'
{
  "name": "alliance-remarketing-graph",
  "version": "1.0.0",
  "main": "webhook-handler.js",
  "dependencies": {
    "pg": "^8.11.0",
    "@azure/msal-node": "^2.5.1",
    "axios": "^1.6.0"
  }
}
EOF

# Install dependencies
npm install --production

# Create deployment package
zip -r ../alliance-remarketing-graph.zip .

cd ..

# Deploy Lambda function
echo "📦 Creating Lambda function with Microsoft Graph API support..."

aws lambda create-function \
  --function-name alliance-remarketing-graph \
  --runtime nodejs18.x \
  --role "$ROLE_ARN" \
  --handler webhook-handler.handler \
  --zip-file fileb://alliance-remarketing-graph.zip \
  --timeout 30 \
  --memory-size 256 \
  --environment Variables="{DATABASE_URL=$DATABASE_URL,AZURE_CLIENT_ID=$AZURE_CLIENT_ID,AZURE_CLIENT_SECRET=$AZURE_CLIENT_SECRET,AZURE_TENANT_ID=$AZURE_TENANT_ID}" \
  --region $AWS_REGION \
  --query 'FunctionArn' \
  --output text 2>/dev/null || {
    echo "Function exists, updating code..."
    aws lambda update-function-code \
      --function-name alliance-remarketing-graph \
      --zip-file fileb://alliance-remarketing-graph.zip \
      --region $AWS_REGION
    
    # Update environment variables
    aws lambda update-function-configuration \
      --function-name alliance-remarketing-graph \
      --environment Variables="{DATABASE_URL=$DATABASE_URL,AZURE_CLIENT_ID=$AZURE_CLIENT_ID,AZURE_CLIENT_SECRET=$AZURE_CLIENT_SECRET,AZURE_TENANT_ID=$AZURE_TENANT_ID}" \
      --region $AWS_REGION
  }

# Create API Gateway
echo "🌐 Setting up API Gateway..."

API_ID=$(aws apigatewayv2 create-api \
  --name alliance-remarketing-graph-api \
  --protocol-type HTTP \
  --region $AWS_REGION \
  --query 'ApiId' \
  --output text 2>/dev/null || {
    # Get existing API ID
    aws apigatewayv2 get-apis \
      --region $AWS_REGION \
      --query 'Items[?Name==`alliance-remarketing-graph-api`].ApiId' \
      --output text
  })

echo "API Gateway ID: $API_ID"

# Create integration
INTEGRATION_ID=$(aws apigatewayv2 create-integration \
  --api-id $API_ID \
  --integration-type AWS_PROXY \
  --integration-uri arn:aws:lambda:$AWS_REGION:$ACCOUNT_ID:function:alliance-remarketing-graph \
  --payload-format-version "2.0" \
  --region $AWS_REGION \
  --query 'IntegrationId' \
  --output text 2>/dev/null || echo "integration-exists")

# Create route if integration was created
if [ "$INTEGRATION_ID" != "integration-exists" ]; then
  aws apigatewayv2 create-route \
    --api-id $API_ID \
    --route-key "POST /webhook/cart/abandoned" \
    --target integrations/$INTEGRATION_ID \
    --region $AWS_REGION || echo "Route may exist"
fi

# Create stage
aws apigatewayv2 create-stage \
  --api-id $API_ID \
  --stage-name prod \
  --auto-deploy \
  --region $AWS_REGION 2>/dev/null || echo "Stage exists"

# Add Lambda permission
aws lambda add-permission \
  --function-name alliance-remarketing-graph \
  --statement-id allow-api-gateway-graph \
  --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:$AWS_REGION:$ACCOUNT_ID:$API_ID/*/*" \
  --region $AWS_REGION 2>/dev/null || echo "Permission exists"

WEBHOOK_URL="https://$API_ID.execute-api.$AWS_REGION.amazonaws.com/prod/webhook/cart/abandoned"

echo ""
echo "🎉 MICROSOFT GRAPH API DEPLOYMENT COMPLETE!"
echo "==========================================="
echo ""
echo "📍 Your webhook URL:"
echo "   $WEBHOOK_URL"
echo ""
echo "📧 Email Configuration:"
echo "   ✅ Emails sent from: andre@alliancechemical.com (via Outlook)"
echo "   ✅ Sales team CC'd: sales@alliancechemical.com"
echo "   ✅ Professional HTML formatting"
echo "   ✅ Superior deliverability via Microsoft"
echo ""
echo "🛍️  Configure in Shopify:"
echo "   1. Go to Settings → Notifications → Webhooks"
echo "   2. Event: 'Checkout abandoned'"
echo "   3. URL: $WEBHOOK_URL"
echo "   4. Format: JSON"
echo ""
echo "🧪 Test the webhook:"
echo "   curl -X POST $WEBHOOK_URL -H 'Content-Type: application/json' -d '{\"email\":\"test@example.com\",\"total_price\":\"100.00\",\"id\":\"12345\"}'"
echo ""
echo "📊 Monitor at:"
echo "   - CloudWatch Logs: /aws/lambda/alliance-remarketing-graph"
echo "   - API Gateway: https://console.aws.amazon.com/apigateway/main/apis/$API_ID"
echo ""
echo "✅ Alliance Chemical remarketing system with Microsoft Graph API is LIVE!"

# Cleanup
rm -rf lambda-functions-graph alliance-remarketing-graph.zip