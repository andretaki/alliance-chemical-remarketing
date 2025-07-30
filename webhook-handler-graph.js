const crypto = require('crypto');
const { Client } = require('pg');
const { Client: GraphClient } = require('@azure/msal-node');
const axios = require('axios');

// Microsoft Graph API configuration
const msalConfig = {
  auth: {
    clientId: process.env.AZURE_CLIENT_ID,
    clientSecret: process.env.AZURE_CLIENT_SECRET,
    authority: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}`
  }
};

const msalClient = new GraphClient(msalConfig);

// Get access token for Microsoft Graph
async function getGraphAccessToken() {
  const clientCredentialRequest = {
    scopes: ['https://graph.microsoft.com/.default'],
  };

  try {
    const response = await msalClient.acquireTokenByClientCredential(clientCredentialRequest);
    return response.accessToken;
  } catch (error) {
    console.error('Error getting Graph access token:', error);
    throw error;
  }
}

// Email template for customer with sales CC using Microsoft Graph
function createCustomerEmail(cartData) {
  const subject = `Complete your Alliance Chemical order - ${cartData.tier === 'HIGH' ? 'Special pricing available' : 'Limited time offer'}`;
  
  const emailBody = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px;">
        <h2 style="color: #2c3e50; margin-bottom: 20px;">Complete Your Alliance Chemical Order</h2>
        
        <p>Dear Valued Customer,</p>
        
        <p>We noticed you left some items in your cart at Alliance Chemical. We'd love to help you complete your order!</p>
        
        <div style="background-color: white; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <h3 style="color: #34495e; margin-top: 0;">Your Cart Summary:</h3>
          <ul style="list-style: none; padding: 0;">
            <li><strong>Order Value:</strong> $${cartData.total} USD</li>
            <li><strong>Items:</strong> Industrial chemicals and supplies</li>
            ${cartData.tier !== 'LOW' ? '<li><strong>Special pricing may be available</strong></li>' : '<li><strong>10% discount available with code SAVE10</strong></li>'}
          </ul>
        </div>
        
        <div style="background-color: #e3f2fd; padding: 15px; border-radius: 5px; margin: 20px 0;">
          ${cartData.tier === 'HIGH' 
            ? '<p><strong>For orders over $10,000, our sales team can provide personalized pricing and support. We\'ll have someone contact you within the next hour.</strong></p>'
            : cartData.tier === 'MEDIUM'
            ? '<p><strong>For your order size, we can offer specialized pricing and expedited shipping. Our sales team will follow up within 6 hours.</strong></p>'
            : '<p><strong>Complete your order now and save 10% with code SAVE10 (valid for 48 hours).</strong></p>'
          }
        </div>
        
        <div style="margin: 30px 0;">
          <p><strong>Questions? Contact our sales team directly:</strong></p>
          <p>📧 <a href="mailto:sales@alliancechemical.com">sales@alliancechemical.com</a><br>
          📞 [Your phone number]</p>
        </div>
        
        <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; color: #666; font-size: 12px;">
          <p>Best regards,<br>Alliance Chemical Sales Team</p>
          <p>This email was sent to: ${cartData.email}<br>
          Order ID: ${cartData.cartId}</p>
        </div>
      </div>
    </div>
  `;

  return {
    subject,
    body: emailBody,
    to: cartData.email,
    cc: 'sales@alliancechemical.com'
  };
}

// Send email using Microsoft Graph API
async function sendEmailViaGraph(emailData) {
  try {
    const accessToken = await getGraphAccessToken();
    
    const emailPayload = {
      message: {
        subject: emailData.subject,
        body: {
          contentType: 'HTML',
          content: emailData.body
        },
        toRecipients: [
          {
            emailAddress: {
              address: emailData.to
            }
          }
        ],
        ccRecipients: [
          {
            emailAddress: {
              address: emailData.cc
            }
          }
        ],
        from: {
          emailAddress: {
            address: 'andre@alliancechemical.com',
            name: 'Andre - Alliance Chemical'
          }
        }
      }
    };

    const response = await axios.post(
      'https://graph.microsoft.com/v1.0/users/andre@alliancechemical.com/sendMail',
      emailPayload,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('✅ Email sent via Microsoft Graph API');
    return { success: true, messageId: response.headers['request-id'] || 'graph-sent' };
  } catch (error) {
    console.error('❌ Graph API Email failed:', error.response?.data || error.message);
    return { success: false, error: error.message };
  }
}

exports.handler = async (event, context) => {
  console.log('Received webhook:', JSON.stringify(event, null, 2));
  
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  
  try {
    await client.connect();
    
    const body = JSON.parse(event.body || '{}');
    
    if (!body.email) {
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'No email provided, skipping' })
      };
    }
    
    // Generate fingerprint for anti-fraud
    const email = body.email || '';
    const phone = body.phone || '';
    const address = body.shipping_address?.address1 || '';
    
    const emailDomain = email.toLowerCase().split('@')[1] || '';
    const phoneLast4 = phone.replace(/\D/g, '').slice(-4);
    const normalizedAddress = address.toLowerCase().trim();
    
    const fingerprint = crypto
      .createHash('sha256')
      .update([normalizedAddress, emailDomain, phoneLast4].join(':'))
      .digest('hex');
    
    // Insert customer
    const customerQuery = `
      INSERT INTO alliance_remarketing_customers (email, phone, street_address, fingerprint)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (fingerprint) DO UPDATE SET
        email = EXCLUDED.email,
        phone = EXCLUDED.phone,
        street_address = EXCLUDED.street_address,
        updated_at = NOW()
      RETURNING id
    `;
    
    const customerResult = await client.query(customerQuery, [
      email,
      phone || null,
      address || null,
      fingerprint
    ]);
    
    const customerId = customerResult.rows[0].id;
    
    // Insert cart
    const cartTotal = parseFloat(body.total_price || '0');
    const cartQuery = `
      INSERT INTO alliance_remarketing_carts (shopify_checkout_id, customer_id, total, currency, abandoned_at)
      VALUES ($1, $2, $3, $4, NOW())
      RETURNING id
    `;
    
    const cartResult = await client.query(cartQuery, [
      body.id?.toString(),
      customerId,
      cartTotal,
      body.currency || 'USD'
    ]);
    
    const cartId = cartResult.rows[0].id;
    
    // Determine tier
    let tier = 'LOW';
    if (cartTotal > 10000) {
      tier = 'HIGH';
    } else if (cartTotal > 1000) {
      tier = 'MEDIUM';  
    }
    
    // Create email for customer with sales CC
    const emailData = createCustomerEmail({
      email,
      phone,
      total: cartTotal.toFixed(2),
      tier,
      cartId
    });
    
    // Send email via Microsoft Graph API
    const emailResult = await sendEmailViaGraph(emailData);
    
    // Log email activity to database
    const emailLogQuery = `
      INSERT INTO alliance_remarketing_emails (cart_id, recipient_email, subject, body, status, provider_message_id, sent_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
    `;
    
    await client.query(emailLogQuery, [
      cartId,
      email,
      emailData.subject,
      emailData.body,
      emailResult.success ? 'sent' : 'failed',
      emailResult.messageId || null
    ]);
    
    await client.end();
    
    console.log('Cart abandonment processed:', {
      cartId,
      customerId,
      email,
      total: cartTotal,
      tier,
      salesCCed: true,
      emailSent: emailResult.success
    });
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: true,
        cartId,
        customerId,
        total: cartTotal,
        tier,
        salesCCed: true,
        emailSent: emailResult.success,
        messageId: emailResult.messageId,
        provider: 'Microsoft Graph API',
        message: `Cart abandonment recorded - Customer emailed with sales CC via Outlook!`
      })
    };
    
  } catch (error) {
    console.error('Error processing webhook:', error);
    if (client._connected) await client.end();
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        error: 'Internal server error',
        message: error.message
      })
    };
  }
};