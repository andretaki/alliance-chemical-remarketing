# 🔐 Azure App Registration Setup for Microsoft Graph API

## 📋 **Quick Setup Steps**

### 1. **Create App Registration**
1. Go to **Azure Portal** → **Azure Active Directory** → **App registrations**
2. Click **New registration**
3. **Name**: `Alliance Chemical Remarketing`
4. **Account types**: `Accounts in this organizational directory only`
5. Click **Register**

### 2. **Get Application Details**
After creation, copy these values:
- **Application (client) ID**: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`
- **Directory (tenant) ID**: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`

### 3. **Create Client Secret**
1. Go to **Certificates & secrets** → **Client secrets**
2. Click **New client secret**
3. **Description**: `Remarketing Lambda Function`
4. **Expires**: `24 months`
5. **Copy the secret value** (you won't see it again!)

### 4. **Set API Permissions**
1. Go to **API permissions** → **Add a permission**
2. Select **Microsoft Graph** → **Application permissions**
3. Search and add: **`Mail.Send`**
4. Click **Grant admin consent** (important!)

---

## 🔧 **Environment Variables for Deployment**

Set these before running the deployment:

```bash
export AZURE_CLIENT_ID="your_application_id_here"
export AZURE_CLIENT_SECRET="your_client_secret_here" 
export AZURE_TENANT_ID="your_tenant_id_here"
export DATABASE_URL="postgres://default:Lm6cG2iOHprI@ep-blue-bar-a4hj4ojg-pooler.us-east-1.aws.neon.tech/verceldb?sslmode=require"
```

---

## 🚀 **Deploy the System**

```bash
chmod +x deploy-graph.sh
./deploy-graph.sh
```

---

## ✅ **Advantages of Microsoft Graph API**

### 📧 **Superior Email Delivery**
- **Microsoft's reputation**: Best-in-class deliverability
- **No spam concerns**: Emails come from your actual Outlook account
- **Professional appearance**: Rich HTML formatting, proper threading

### 💰 **Cost Effective**
- **Free with Office 365**: No per-email charges
- **Enterprise reliability**: Same infrastructure as Outlook.com

### 🔗 **Better Integration**
- **Outlook integration**: Emails appear in your Sent folder
- **Reply handling**: Customers can reply directly
- **Conversation threading**: Natural email experience

---

## 🧪 **Testing**

Once deployed, the system will:
1. **Capture abandoned carts** from Shopify
2. **Send professional HTML emails** via Microsoft Graph
3. **CC sales@alliancechemical.com** on every message
4. **Log all activity** in the database

**Emails will appear to come from your actual andre@alliancechemical.com Outlook account!**

---

**🎯 This gives you enterprise-grade email delivery with zero spam risk!**