-- Migration: 20260806_create_customer_wallet.sql
-- Description: Create Customer Wallet & Liability Engine tables, types, triggers, and helper function

BEGIN;

-- 1. Create customer_wallet table
CREATE TABLE IF NOT EXISTS customer_wallet (
    wallet_id SERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL UNIQUE REFERENCES customer(customer_id) ON DELETE CASCADE,
    balance NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (balance >= 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_customer_wallet_customer ON customer_wallet(customer_id);

-- 2. Create customer_wallet_transaction type & audit ledger table
DO $$ BEGIN
    CREATE TYPE wallet_transaction_type AS ENUM (
        'OVERPAYMENT_CREDIT',
        'ADVANCE_DEPOSIT',
        'STORE_CREDIT_REFUND',
        'INVOICE_PAYMENT_DRAWDOWN',
        'MANUAL_ADJUSTMENT'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS customer_wallet_transaction (
    transaction_id SERIAL PRIMARY KEY,
    wallet_id INTEGER NOT NULL REFERENCES customer_wallet(wallet_id) ON DELETE CASCADE,
    customer_id INTEGER NOT NULL REFERENCES customer(customer_id),
    transaction_type wallet_transaction_type NOT NULL,
    amount NUMERIC(12, 2) NOT NULL,
    balance_after NUMERIC(12, 2) NOT NULL CHECK (balance_after >= 0),
    reference_type VARCHAR(50),
    reference_id INTEGER,
    notes TEXT,
    created_by INTEGER REFERENCES employee(employee_id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_wallet_tx_wallet ON customer_wallet_transaction(wallet_id);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_customer ON customer_wallet_transaction(customer_id);

-- 3. Atomic helper function for append transaction & balance update with row locking
CREATE OR REPLACE FUNCTION append_wallet_transaction(
    p_customer_id INTEGER,
    p_transaction_type wallet_transaction_type,
    p_amount NUMERIC,
    p_reference_type VARCHAR DEFAULT NULL,
    p_reference_id INTEGER DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_created_by INTEGER DEFAULT NULL
) RETURNS INTEGER AS $$
DECLARE
    v_wallet_id INTEGER;
    v_curr_balance NUMERIC(12, 2);
    v_new_balance NUMERIC(12, 2);
    v_tx_id INTEGER;
BEGIN
    -- Ensure customer wallet exists
    INSERT INTO customer_wallet (customer_id, balance)
    VALUES (p_customer_id, 0.00)
    ON CONFLICT (customer_id) DO NOTHING;

    -- Lock row FOR UPDATE to ensure concurrency protection
    SELECT wallet_id, balance INTO v_wallet_id, v_curr_balance
    FROM customer_wallet
    WHERE customer_id = p_customer_id
    FOR UPDATE;

    v_new_balance := v_curr_balance + p_amount;

    IF v_new_balance < 0 THEN
        RAISE EXCEPTION 'Insufficient wallet balance for customer %. Current balance: %, requested deduction: %',
            p_customer_id, v_curr_balance, ABS(p_amount);
    END IF;

    -- Update wallet balance
    UPDATE customer_wallet
    SET balance = v_new_balance,
        updated_at = CURRENT_TIMESTAMP
    WHERE wallet_id = v_wallet_id;

    -- Append audit transaction
    INSERT INTO customer_wallet_transaction (
        wallet_id, customer_id, transaction_type, amount, balance_after,
        reference_type, reference_id, notes, created_by
    ) VALUES (
        v_wallet_id, p_customer_id, p_transaction_type, p_amount, v_new_balance,
        p_reference_type, p_reference_id, p_notes, p_created_by
    ) RETURNING transaction_id INTO v_tx_id;

    RETURN v_tx_id;
END;
$$ LANGUAGE plpgsql;

-- 4. Seed 'store_wallet' payment method into payment_methods
INSERT INTO payment_methods (code, name, type, settlement_type, enabled, sort_order)
VALUES ('store_wallet', 'Store Wallet / Account Credit', 'credit', 'on_account', true, 8)
ON CONFLICT (code) DO NOTHING;

COMMIT;
