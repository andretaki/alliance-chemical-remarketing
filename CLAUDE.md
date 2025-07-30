# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an Alliance Chemical remarketing system that captures abandoned Shopify carts and sends professional recovery emails using Microsoft Graph API. The system includes:

1. **Real-time webhook handler** - Processes Shopify cart abandonment webhooks immediately
2. **Scheduled cart checker** - Runs every 2 hours to find and recover missed abandoned carts with AI-generated emails

## Core Architecture

**Webhook Handler**: `webhook-handler-graph.js` processes real-time cart abandonments
- Receives Shopify cart abandonment webhooks via API Gateway
- Implements anti-fraud fingerprinting using SHA-256 hash of address + email domain + phone
- Processes tier-based cart values (LOW ≤$1k, MEDIUM $1k-10k, HIGH >$10k)
- Sends HTML emails via Microsoft Graph API with automatic sales CC
- Logs all activity to PostgreSQL database

**Scheduled Cart Checker**: `scheduled-cart-checker.js` runs every 2 hours
- Queries database for abandoned carts not yet emailed or needing follow-up
- Uses OpenAI GPT-4 to generate personalized email content with cart details
- Creates unique Shopify discount codes via Admin API
- Sends recovery emails through Microsoft Graph with sales team CC
- Tracks all email activity in database to prevent duplicates

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

### Deploy the Webhook Handler
```bash
# Set required environment variables
export AZURE_CLIENT_ID="your_app_registration_id"
export AZURE_CLIENT_SECRET="your_client_secret"
export AZURE_TENANT_ID="your_tenant_id"
export DATABASE_URL="your_postgres_connection_string"

# Deploy webhook handler
./deploy-graph.sh
```

### Deploy the Scheduled Cart Checker
```bash
# Set required environment variables (same as above plus OpenAI)
export OPENAI_API_KEY="your_openai_api_key"
export SHOPIFY_ACCESS_TOKEN="your_shopify_admin_api_token"  # Optional
export SHOPIFY_SHOP_DOMAIN="alliance-chemical-store.myshopify.com"

# Deploy scheduled Lambda
./deploy-scheduled.sh
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
# View webhook handler logs
aws logs tail /aws/lambda/alliance-remarketing-graph --follow --region us-east-2

# View scheduled cart checker logs
aws logs tail /aws/lambda/alliance-scheduled-cart-checker --follow --region us-east-2

# Check API Gateway status
aws apigatewayv2 get-apis --region us-east-2 --query 'Items[?Name==`alliance-remarketing-graph-api`]'

# Test scheduled cart checker manually
aws lambda invoke --function-name alliance-scheduled-cart-checker --region us-east-2 output.json
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

**AI Integration (Scheduled Checker)**:
- OPENAI_API_KEY: OpenAI API key for GPT-4 email generation

**Optional Shopify Integration**:
- SHOPIFY_ACCESS_TOKEN: Admin API token for creating discount codes
- SHOPIFY_SHOP_DOMAIN: Your Shopify store domain

**Database Connection**:
- DATABASE_URL: PostgreSQL connection string with SSL required
- Uses Neon.tech hosted PostgreSQL service

## Deployment Architecture

**AWS Lambda Functions**:
1. `alliance-remarketing-graph` - Webhook handler
   - Runtime: Node.js 18.x
   - Memory: 256MB, Timeout: 30 seconds
   - Triggered by API Gateway webhook calls

2. `alliance-scheduled-cart-checker` - Scheduled task
   - Runtime: Node.js 18.x
   - Memory: 256MB, Timeout: 60 seconds
   - Triggered by EventBridge rule every 2 hours

**API Gateway**: HTTP API with single POST route
- Path: `/webhook/cart/abandoned`
- Configured for Shopify webhook format
- CORS enabled for cross-origin requests

**EventBridge Rule**: Scheduled execution
- Rule: `alliance-scheduled-cart-checker-rule`
- Schedule: Every 2 hours (`rate(2 hours)`)
- Target: `alliance-scheduled-cart-checker` Lambda

The system is designed for high deliverability using Microsoft's email infrastructure and AI-powered personalization, providing enterprise-grade reliability with zero spam risk.

## Current System Status (2025-07-30)

**✅ DEPLOYED AND WORKING:**
- `alliance-remarketing-graph` - Real-time webhook handler Lambda
- `alliance-scheduled-cart-checker` - Scheduled cart recovery Lambda (every 30 minutes)
- API Gateway endpoints for webhook processing
- EventBridge rule for scheduled execution
- PostgreSQL database with existing schema

**❌ ISSUES TO FIX:**
1. **Customer table schema mismatch** - `cust.first_name` column doesn't exist in database
2. **Webhook handler 500 errors** - Internal server errors on API Gateway calls
3. **Database query incompatibility** - Lambda queries don't match existing database schema
4. **Missing test data** - No abandoned carts in database to test scheduled recovery

**🔧 NEXT STEPS:**
1. Check actual customer table schema: `\d alliance_remarketing_customers`
2. Update scheduled-cart-checker.js queries to match existing column names
3. Debug webhook handler by checking CloudWatch logs
4. Add test data to database for end-to-end testing
5. Verify Microsoft Graph email integration works
6. Test Shopify discount code creation

**📋 CHECKLIST TO COMPLETE SYSTEM:**
- [ ] Fix customer table column references in scheduled cart checker
- [ ] Debug and fix webhook handler 500 errors  
- [ ] Test complete cart abandonment → email recovery flow
- [ ] Verify EventBridge triggering every 30 minutes
- [ ] Test AI email generation with OpenAI
- [ ] Test Microsoft Graph email sending
- [ ] Test Shopify discount code creation
- [ ] Add monitoring and alerting for failed emails
- [ ] Document final deployment and testing procedures