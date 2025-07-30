# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an Alliance Chemical remarketing system that captures abandoned Shopify carts and sends professional recovery emails using Microsoft Graph API. The system is deployed as an AWS Lambda function with API Gateway webhook endpoint.

## Core Architecture

**Single-file Lambda Handler**: `webhook-handler-graph.js` contains the complete webhook processing logic
- Receives Shopify cart abandonment webhooks via API Gateway
- Implements anti-fraud fingerprinting using SHA-256 hash of address + email domain + phone
- Processes tier-based cart values (LOW ≤$1k, MEDIUM $1k-10k, HIGH >$10k)
- Sends HTML emails via Microsoft Graph API with automatic sales CC
- Logs all activity to PostgreSQL database

**Email Integration**: Uses Microsoft Graph API instead of traditional email services
- Authenticates using Azure App Registration with client credentials flow
- Sends emails from actual andre@alliancechemical.com Outlook account
- Automatically CCs sales@alliancechemical.com on every customer email
- Uses rich HTML templates with tier-specific messaging

**Database Schema**: PostgreSQL with alliance_remarketing_* prefixed tables
- `alliance_remarketing_customers`: Customer data with unique fingerprint constraint
- `alliance_remarketing_carts`: Cart abandonment records linked to customers
- `alliance_remarketing_emails`: Email activity log with provider message tracking

## Essential Commands

### Deploy the System
```bash
# Set required environment variables
export AZURE_CLIENT_ID="your_app_registration_id"
export AZURE_CLIENT_SECRET="your_client_secret"
export AZURE_TENANT_ID="your_tenant_id"
export DATABASE_URL="your_postgres_connection_string"

# Deploy to AWS Lambda
./deploy-graph.sh
```

### Test the Webhook
```bash
# Test with sample cart data
curl -X POST https://[api-id].execute-api.us-east-2.amazonaws.com/prod/webhook/cart/abandoned \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "test@example.com",
    "total_price": "5000.00",
    "id": "test-cart-123",
    "phone": "+1-555-0123",
    "shipping_address": {"address1": "123 Main St"}
  }'
```

### Monitor System
```bash
# View Lambda logs
aws logs tail /aws/lambda/alliance-remarketing-graph --follow --region us-east-2

# Check API Gateway status
aws apigatewayv2 get-apis --region us-east-2 --query 'Items[?Name==`alliance-remarketing-graph-api`]'
```

## Key Business Logic

**Tier Classification Logic** (lines 213-218 in webhook-handler-graph.js):
- LOW: ≤$1,000 → 10% discount code SAVE10, 4-hour delay
- MEDIUM: $1,001-$10,000 → 5% discount, 6-hour sales follow-up  
- HIGH: >$10,000 → No discount, 1-hour urgent sales contact

**Anti-Fraud Fingerprinting** (lines 169-172):
- Combines normalized street address + email domain + phone last 4 digits
- SHA-256 hash prevents duplicate discount abuse
- Database enforces unique constraint on fingerprint field

**Email Template Strategy**:
- HTML-formatted emails with professional Alliance Chemical branding
- Tier-specific messaging and call-to-action based on cart value
- Automatic sales team visibility via CC field
- Conversation threading preserved in Outlook

## Environment Dependencies

**Required Azure Credentials**:
- AZURE_CLIENT_ID: App registration client ID from Azure Portal
- AZURE_CLIENT_SECRET: Client secret value (expires in 24 months)
- AZURE_TENANT_ID: Directory tenant ID from Azure AD

**Required API Permissions**:
- Microsoft Graph `Mail.Send` application permission with admin consent

**Database Connection**:
- DATABASE_URL: PostgreSQL connection string with SSL required
- Uses Neon.tech hosted PostgreSQL service

## Deployment Architecture

**AWS Lambda Function**: `alliance-remarketing-graph`
- Runtime: Node.js 18.x
- Memory: 256MB, Timeout: 30 seconds
- IAM Role: Basic execution permissions only (no SES/SNS needed)

**API Gateway**: HTTP API with single POST route
- Path: `/webhook/cart/abandoned`
- Configured for Shopify webhook format
- CORS enabled for cross-origin requests

The system is designed for high deliverability using Microsoft's email infrastructure rather than traditional email services, providing enterprise-grade reliability with zero spam risk.