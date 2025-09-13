-- Create payment_methods table for configurable payment methods
-- This allows users to define custom payment methods in the Settings page

CREATE TABLE IF NOT EXISTS public.payment_methods (
    method_id serial PRIMARY KEY,
    code character varying(50) NOT NULL UNIQUE,
    name character varying(100) NOT NULL,
    type character varying(20) NOT NULL DEFAULT 'other',
    enabled boolean NOT NULL DEFAULT true,
    sort_order integer NOT NULL DEFAULT 0,
    config jsonb NOT NULL DEFAULT '{}',
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    created_by integer REFERENCES public.employee(employee_id) ON DELETE SET NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_by integer REFERENCES public.employee(employee_id) ON DELETE SET NULL,
    
    -- Ensure at least one cash-equivalent method exists
    CONSTRAINT chk_payment_method_type CHECK (
        type IN ('cash', 'card', 'bank', 'mobile', 'credit', 'voucher', 'other')
    )
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_payment_methods_enabled_sort ON public.payment_methods(enabled, sort_order);
CREATE INDEX IF NOT EXISTS idx_payment_methods_type ON public.payment_methods(type);

-- Seed default payment methods from common PAYMENT_METHODS setting values
INSERT INTO public.payment_methods (code, name, type, enabled, sort_order, config) VALUES
('cash', 'Cash', 'cash', true, 1, '{
    "requires_reference": false,
    "requires_receipt_no": false,
    "change_allowed": true,
    "settlement_type": "instant",
    "max_split_count": null
}'),
('credit_card', 'Credit Card', 'card', true, 2, '{
    "requires_reference": true,
    "reference_label": "Auth Code",
    "requires_receipt_no": true,
    "change_allowed": false,
    "settlement_type": "instant",
    "max_split_count": 1
}'),
('debit_card', 'Debit Card', 'card', true, 3, '{
    "requires_reference": true,
    "reference_label": "Auth Code",
    "requires_receipt_no": true,
    "change_allowed": false,
    "settlement_type": "instant",
    "max_split_count": 1
}'),
('bank_transfer', 'Bank Transfer', 'bank', true, 4, '{
    "requires_reference": true,
    "reference_label": "Transfer Reference",
    "requires_receipt_no": false,
    "change_allowed": false,
    "settlement_type": "delayed",
    "max_split_count": null
}'),
('cheque', 'Cheque', 'bank', true, 5, '{
    "requires_reference": true,
    "reference_label": "Cheque Number",
    "requires_receipt_no": false,
    "change_allowed": false,
    "settlement_type": "delayed",
    "max_split_count": null
}'),
('gcash', 'GCash', 'mobile', true, 6, '{
    "requires_reference": true,
    "reference_label": "Transaction ID",
    "requires_receipt_no": false,
    "change_allowed": false,
    "settlement_type": "instant",
    "max_split_count": null
}'),
('paymaya', 'PayMaya', 'mobile', true, 7, '{
    "requires_reference": true,
    "reference_label": "Transaction ID",
    "requires_receipt_no": false,
    "change_allowed": false,
    "settlement_type": "instant",
    "max_split_count": null
}')
ON CONFLICT (code) DO NOTHING;

-- Add feature flag for split payments
INSERT INTO public.settings (setting_key, setting_value, description) VALUES
('ENABLE_SPLIT_PAYMENTS', 'false', 'Enable split payment functionality and payment methods management')
ON CONFLICT (setting_key) DO NOTHING;

-- Add help text for payment methods
INSERT INTO public.settings (setting_key, setting_value, description) VALUES
('PAYMENT_METHODS_HELP_TEXT', 'Configure available payment methods and their validation rules', 'Help text shown in Payment Methods settings')
ON CONFLICT (setting_key) DO NOTHING;
