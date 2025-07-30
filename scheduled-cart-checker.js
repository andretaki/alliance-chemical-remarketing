const { Client } = require('pg');
const OpenAI = require('openai');
const axios = require('axios');

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

exports.handler = async (event) => {
    console.log('Scheduled cart checker started:', new Date());
    
    const client = new Client({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    try {
        await client.connect();
        console.log('Connected to database');

        // Find abandoned carts that haven't been emailed or need follow-up
        const query = `
            SELECT 
                c.shopify_checkout_id as cart_id,
                c.total,
                c.abandoned_at,
                c.created_at,
                cust.email,
                cust.first_name,
                cust.last_name,
                cust.phone,
                cust.address_line1,
                cust.city,
                cust.province,
                cust.country,
                cust.zip,
                CASE 
                    WHEN c.total <= 1000 THEN 'LOW'
                    WHEN c.total <= 10000 THEN 'MEDIUM'
                    ELSE 'HIGH'
                END as tier,
                COUNT(e.id) as email_count,
                MAX(e.sent_at) as last_email_sent
            FROM alliance_remarketing_carts c
            JOIN alliance_remarketing_customers cust ON c.customer_id = cust.id
            LEFT JOIN alliance_remarketing_emails e ON c.id = e.cart_id
            WHERE c.abandoned_at > NOW() - INTERVAL '7 days'
                AND c.recovered_at IS NULL
                AND (
                    COUNT(e.id) = 0 
                    OR (COUNT(e.id) = 1 AND MAX(e.sent_at) < NOW() - INTERVAL '24 hours')
                    OR (COUNT(e.id) = 2 AND MAX(e.sent_at) < NOW() - INTERVAL '3 days')
                )
            GROUP BY c.id, c.shopify_checkout_id, c.total, c.abandoned_at, c.created_at, 
                     cust.email, cust.first_name, cust.last_name, cust.phone,
                     cust.address_line1, cust.city, cust.province, cust.country, cust.zip
            ORDER BY c.abandoned_at DESC
            LIMIT 50
        `;

        const result = await client.query(query);
        console.log(`Found ${result.rows.length} carts to process`);

        for (const cart of result.rows) {
            await processCart(cart, client);
        }

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: `Processed ${result.rows.length} abandoned carts`,
                timestamp: new Date().toISOString()
            })
        };

    } catch (error) {
        console.error('Error in scheduled cart checker:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({
                error: error.message,
                timestamp: new Date().toISOString()
            })
        };
    } finally {
        await client.end();
    }
};

async function processCart(cart, client) {
    try {
        console.log(`Processing cart ${cart.cart_id} for ${cart.email}`);

        // Generate personalized email content with AI
        const emailContent = await generateEmailContent(cart);
        
        // Create discount code if needed
        let discountCode = null;
        if (cart.tier === 'LOW' || cart.tier === 'MEDIUM') {
            discountCode = await createDiscountCode(cart);
        }

        // Send email via Microsoft Graph
        const emailSent = await sendEmailViaGraph(cart, emailContent, discountCode);

        if (emailSent) {
            // Log email activity using existing schema
            await client.query(`
                INSERT INTO alliance_remarketing_emails (cart_id, recipient_email, subject, body, provider_message_id, status, sent_at)
                VALUES (
                    (SELECT id FROM alliance_remarketing_carts WHERE shopify_checkout_id = $1),
                    $2, $3, $4, $5, 'sent', NOW()
                )
            `, [
                cart.cart_id,
                cart.email,
                emailContent.subject,
                emailContent.body,
                emailSent.messageId
            ]);

            console.log(`Email sent successfully to ${cart.email}`);
        }

    } catch (error) {
        console.error(`Error processing cart ${cart.cart_id}:`, error);
    }
}

async function generateEmailContent(cart) {
    // Since we don't have cart_data in existing schema, generate generic content
    const prompt = `Generate a professional cart recovery email for Alliance Chemical. Customer details:
    
Name: ${cart.first_name} ${cart.last_name}
Email: ${cart.email}  
Cart Value: $${cart.total}
Cart Tier: ${cart.tier}
Location: ${cart.city}, ${cart.province} ${cart.country}

Requirements:
- Professional tone appropriate for B2B chemical industry
- Mention specific products they were interested in
- ${cart.tier === 'HIGH' ? 'Emphasize urgent personal consultation - high value cart' : ''}
- ${cart.tier === 'MEDIUM' ? 'Offer to connect with technical specialist' : ''}
- ${cart.tier === 'LOW' ? 'Focus on product benefits and ease of ordering' : ''}
- Include clear call to action
- Keep under 200 words
- Return JSON with "subject" and "body" fields
- Body should be HTML formatted`;

    const completion = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: 500
    });

    return JSON.parse(completion.choices[0].message.content);
}

async function createDiscountCode(cart) {
    if (!process.env.SHOPIFY_ACCESS_TOKEN || !process.env.SHOPIFY_SHOP_DOMAIN) {
        console.log('Shopify credentials not configured, skipping discount code creation');
        return null;
    }

    try {
        const discountPercentage = cart.tier === 'LOW' ? 10 : 5;
        const codePrefix = cart.tier === 'LOW' ? 'SAVE10' : 'SAVE5';
        const uniqueCode = `${codePrefix}-${cart.cart_id.slice(-6).toUpperCase()}`;

        const discountData = {
            price_rule: {
                title: `Cart Recovery ${uniqueCode}`,
                target_type: 'line_item',
                target_selection: 'all',
                allocation_method: 'across',
                value_type: 'percentage',
                value: `-${discountPercentage}.0`,
                customer_selection: 'all',
                once_per_customer: true,
                usage_limit: 1,
                starts_at: new Date().toISOString(),
                ends_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days
            }
        };

        const priceRuleResponse = await axios.post(
            `https://${process.env.SHOPIFY_SHOP_DOMAIN}/admin/api/2023-10/price_rules.json`,
            discountData,
            {
                headers: {
                    'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
                    'Content-Type': 'application/json'
                }
            }
        );

        const priceRuleId = priceRuleResponse.data.price_rule.id;

        const discountCodeData = {
            discount_code: {
                code: uniqueCode
            }
        };

        await axios.post(
            `https://${process.env.SHOPIFY_SHOP_DOMAIN}/admin/api/2023-10/price_rules/${priceRuleId}/discount_codes.json`,
            discountCodeData,
            {
                headers: {
                    'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
                    'Content-Type': 'application/json'
                }
            }
        );

        console.log(`Created discount code: ${uniqueCode}`);
        return uniqueCode;

    } catch (error) {
        console.error('Error creating discount code:', error.response?.data || error.message);
        return null;
    }
}

async function sendEmailViaGraph(cart, emailContent, discountCode) {
    try {
        // Get access token
        const tokenResponse = await axios.post(
            `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/oauth2/v2.0/token`,
            new URLSearchParams({
                client_id: process.env.AZURE_CLIENT_ID,
                client_secret: process.env.AZURE_CLIENT_SECRET,
                scope: 'https://graph.microsoft.com/.default',
                grant_type: 'client_credentials'
            }),
            {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            }
        );

        const accessToken = tokenResponse.data.access_token;

        // Enhance email body with discount code if available
        let finalBody = emailContent.body;
        if (discountCode) {
            finalBody += `<p><strong>Special Offer:</strong> Use discount code <code>${discountCode}</code> to save on your order!</p>`;
        }

        finalBody += `
            <hr>
            <p style="font-size: 12px; color: #666;">
                Alliance Chemical - Professional Chemical Solutions<br>
                This email was sent regarding items in your shopping cart. 
                <a href="https://alliance-chemical-store.myshopify.com/cart">Complete your order</a>
            </p>
        `;

        const emailData = {
            message: {
                subject: emailContent.subject,
                body: {
                    contentType: 'HTML',
                    content: finalBody
                },
                toRecipients: [{
                    emailAddress: {
                        address: cart.email,
                        name: `${cart.first_name} ${cart.last_name}`.trim()
                    }
                }],
                ccRecipients: [{
                    emailAddress: {
                        address: 'sales@alliancechemical.com',
                        name: 'Alliance Chemical Sales'
                    }
                }],
                importance: cart.tier === 'HIGH' ? 'high' : 'normal'
            },
            saveToSentItems: true
        };

        const response = await axios.post(
            'https://graph.microsoft.com/v1.0/users/andre@alliancechemical.com/sendMail',
            emailData,
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        console.log('Email sent via Microsoft Graph');
        return { messageId: response.headers['x-ms-ags-diagnostic'] || 'graph-sent' };

    } catch (error) {
        console.error('Error sending email via Graph:', error.response?.data || error.message);
        throw error;
    }
}