-- Alliance Chemical Remarketing Database Schema
-- PostgreSQL database schema for cart abandonment and email tracking

-- Create customers table
CREATE TABLE IF NOT EXISTS alliance_remarketing_customers (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    phone VARCHAR(50),
    address_line1 VARCHAR(255),
    address_line2 VARCHAR(255),
    city VARCHAR(100),
    province VARCHAR(100),
    country VARCHAR(100),
    zip VARCHAR(20),
    fingerprint VARCHAR(64) UNIQUE NOT NULL, -- SHA-256 hash for fraud prevention
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create carts table
CREATE TABLE IF NOT EXISTS alliance_remarketing_carts (
    id SERIAL PRIMARY KEY,
    cart_id VARCHAR(100) UNIQUE NOT NULL, -- Shopify cart ID
    customer_id INTEGER REFERENCES alliance_remarketing_customers(id),
    total_price DECIMAL(10,2) NOT NULL,
    cart_data JSONB NOT NULL, -- Full Shopify cart data
    tier VARCHAR(10) NOT NULL CHECK (tier IN ('LOW', 'MEDIUM', 'HIGH')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create emails table
CREATE TABLE IF NOT EXISTS alliance_remarketing_emails (
    id SERIAL PRIMARY KEY,
    cart_id VARCHAR(100) NOT NULL, -- References carts.cart_id (not carts.id)
    email_address VARCHAR(255) NOT NULL,
    email_type VARCHAR(50) NOT NULL, -- 'webhook_recovery', 'scheduled_recovery', 'followup'
    subject VARCHAR(500),
    provider VARCHAR(50) NOT NULL, -- 'microsoft_graph', 'ses', etc.
    provider_message_id VARCHAR(255),
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Add foreign key constraint
    CONSTRAINT fk_cart_id FOREIGN KEY (cart_id) REFERENCES alliance_remarketing_carts(cart_id)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_customers_email ON alliance_remarketing_customers(email);
CREATE INDEX IF NOT EXISTS idx_customers_fingerprint ON alliance_remarketing_customers(fingerprint);
CREATE INDEX IF NOT EXISTS idx_carts_cart_id ON alliance_remarketing_carts(cart_id);
CREATE INDEX IF NOT EXISTS idx_carts_customer_id ON alliance_remarketing_carts(customer_id);
CREATE INDEX IF NOT EXISTS idx_carts_created_at ON alliance_remarketing_carts(created_at);
CREATE INDEX IF NOT EXISTS idx_carts_tier ON alliance_remarketing_carts(tier);
CREATE INDEX IF NOT EXISTS idx_emails_cart_id ON alliance_remarketing_emails(cart_id);
CREATE INDEX IF NOT EXISTS idx_emails_sent_at ON alliance_remarketing_emails(sent_at);
CREATE INDEX IF NOT EXISTS idx_emails_email_address ON alliance_remarketing_emails(email_address);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at
CREATE TRIGGER update_customers_updated_at BEFORE UPDATE ON alliance_remarketing_customers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_carts_updated_at BEFORE UPDATE ON alliance_remarketing_carts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert sample data for testing (optional)
-- Uncomment if you want test data
/*
INSERT INTO alliance_remarketing_customers (email, first_name, last_name, phone, address_line1, city, province, country, zip, fingerprint) 
VALUES ('test@example.com', 'John', 'Doe', '+1-555-0123', '123 Test Street', 'Test City', 'OH', 'United States', '12345', 'test-fingerprint-hash-123') 
ON CONFLICT (fingerprint) DO NOTHING;

INSERT INTO alliance_remarketing_carts (cart_id, customer_id, total_price, cart_data, tier) 
VALUES ('test-cart-12345', 1, 750.00, '{"line_items": [{"title": "Industrial Cleaner XYZ", "quantity": 2, "price": "375.00"}]}', 'LOW')
ON CONFLICT (cart_id) DO NOTHING;
*/