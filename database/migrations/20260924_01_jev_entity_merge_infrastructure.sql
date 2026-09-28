-- Jev AI integration, phase 0: merge state and duplicate-suggestion storage.
-- Suggestions are advisory only; all entity merges remain human-confirmed.

ALTER TABLE public.customer
    ADD COLUMN IF NOT EXISTS merged_into_customer_id INTEGER REFERENCES public.customer(customer_id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS is_merged BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.supplier
    ADD COLUMN IF NOT EXISTS merged_into_supplier_id INTEGER REFERENCES public.supplier(supplier_id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS is_merged BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.brand
    ADD COLUMN IF NOT EXISTS merged_into_brand_id INTEGER REFERENCES public.brand(brand_id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS is_merged BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public."group"
    ADD COLUMN IF NOT EXISTS merged_into_group_id INTEGER REFERENCES public."group"(group_id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS is_merged BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_customer_merge_state') THEN ALTER TABLE public.customer ADD CONSTRAINT chk_customer_merge_state CHECK ((is_merged AND merged_into_customer_id IS NOT NULL) OR (NOT is_merged AND merged_into_customer_id IS NULL)); END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_supplier_merge_state') THEN ALTER TABLE public.supplier ADD CONSTRAINT chk_supplier_merge_state CHECK ((is_merged AND merged_into_supplier_id IS NOT NULL) OR (NOT is_merged AND merged_into_supplier_id IS NULL)); END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_brand_merge_state') THEN ALTER TABLE public.brand ADD CONSTRAINT chk_brand_merge_state CHECK ((is_merged AND merged_into_brand_id IS NOT NULL) OR (NOT is_merged AND merged_into_brand_id IS NULL)); END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_group_merge_state') THEN ALTER TABLE public."group" ADD CONSTRAINT chk_group_merge_state CHECK ((is_merged AND merged_into_group_id IS NOT NULL) OR (NOT is_merged AND merged_into_group_id IS NULL)); END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.customer_duplicate_suggestion (
    suggestion_id BIGSERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES public.customer(customer_id) ON DELETE RESTRICT,
    duplicate_customer_id INTEGER NOT NULL REFERENCES public.customer(customer_id) ON DELETE RESTRICT,
    confidence_score NUMERIC(5,4) NOT NULL CHECK (confidence_score BETWEEN 0 AND 1), detection_method TEXT NOT NULL, ai_reason TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'dismissed', 'merged')),
    dismissed_at TIMESTAMPTZ, dismissed_by INTEGER REFERENCES public.employee(employee_id) ON DELETE SET NULL,
    merged_at TIMESTAMPTZ, merged_by INTEGER REFERENCES public.employee(employee_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_customer_duplicate_suggestion_distinct CHECK (customer_id <> duplicate_customer_id)
);
CREATE TABLE IF NOT EXISTS public.supplier_duplicate_suggestion (
    suggestion_id BIGSERIAL PRIMARY KEY,
    supplier_id INTEGER NOT NULL REFERENCES public.supplier(supplier_id) ON DELETE RESTRICT,
    duplicate_supplier_id INTEGER NOT NULL REFERENCES public.supplier(supplier_id) ON DELETE RESTRICT,
    confidence_score NUMERIC(5,4) NOT NULL CHECK (confidence_score BETWEEN 0 AND 1), detection_method TEXT NOT NULL, ai_reason TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'dismissed', 'merged')),
    dismissed_at TIMESTAMPTZ, dismissed_by INTEGER REFERENCES public.employee(employee_id) ON DELETE SET NULL,
    merged_at TIMESTAMPTZ, merged_by INTEGER REFERENCES public.employee(employee_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_supplier_duplicate_suggestion_distinct CHECK (supplier_id <> duplicate_supplier_id)
);
CREATE TABLE IF NOT EXISTS public.brand_duplicate_suggestion (
    suggestion_id BIGSERIAL PRIMARY KEY,
    brand_id INTEGER NOT NULL REFERENCES public.brand(brand_id) ON DELETE RESTRICT,
    duplicate_brand_id INTEGER NOT NULL REFERENCES public.brand(brand_id) ON DELETE RESTRICT,
    confidence_score NUMERIC(5,4) NOT NULL CHECK (confidence_score BETWEEN 0 AND 1), detection_method TEXT NOT NULL, ai_reason TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'dismissed', 'merged')),
    dismissed_at TIMESTAMPTZ, dismissed_by INTEGER REFERENCES public.employee(employee_id) ON DELETE SET NULL,
    merged_at TIMESTAMPTZ, merged_by INTEGER REFERENCES public.employee(employee_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_brand_duplicate_suggestion_distinct CHECK (brand_id <> duplicate_brand_id)
);
CREATE TABLE IF NOT EXISTS public.group_duplicate_suggestion (
    suggestion_id BIGSERIAL PRIMARY KEY,
    group_id INTEGER NOT NULL REFERENCES public."group"(group_id) ON DELETE RESTRICT,
    duplicate_group_id INTEGER NOT NULL REFERENCES public."group"(group_id) ON DELETE RESTRICT,
    confidence_score NUMERIC(5,4) NOT NULL CHECK (confidence_score BETWEEN 0 AND 1), detection_method TEXT NOT NULL, ai_reason TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'dismissed', 'merged')),
    dismissed_at TIMESTAMPTZ, dismissed_by INTEGER REFERENCES public.employee(employee_id) ON DELETE SET NULL,
    merged_at TIMESTAMPTZ, merged_by INTEGER REFERENCES public.employee(employee_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_group_duplicate_suggestion_distinct CHECK (group_id <> duplicate_group_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_merged_into_customer_id ON public.customer (merged_into_customer_id) WHERE merged_into_customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_supplier_merged_into_supplier_id ON public.supplier (merged_into_supplier_id) WHERE merged_into_supplier_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_brand_merged_into_brand_id ON public.brand (merged_into_brand_id) WHERE merged_into_brand_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_group_merged_into_group_id ON public."group" (merged_into_group_id) WHERE merged_into_group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customer_duplicate_suggestion_pending ON public.customer_duplicate_suggestion (status, confidence_score DESC) WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_duplicate_suggestion_pair ON public.customer_duplicate_suggestion (LEAST(customer_id, duplicate_customer_id), GREATEST(customer_id, duplicate_customer_id));
CREATE INDEX IF NOT EXISTS idx_supplier_duplicate_suggestion_pending ON public.supplier_duplicate_suggestion (status, confidence_score DESC) WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_duplicate_suggestion_pair ON public.supplier_duplicate_suggestion (LEAST(supplier_id, duplicate_supplier_id), GREATEST(supplier_id, duplicate_supplier_id));
CREATE INDEX IF NOT EXISTS idx_brand_duplicate_suggestion_pending ON public.brand_duplicate_suggestion (status, confidence_score DESC) WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS uq_brand_duplicate_suggestion_pair ON public.brand_duplicate_suggestion (LEAST(brand_id, duplicate_brand_id), GREATEST(brand_id, duplicate_brand_id));
CREATE INDEX IF NOT EXISTS idx_group_duplicate_suggestion_pending ON public.group_duplicate_suggestion (status, confidence_score DESC) WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS uq_group_duplicate_suggestion_pair ON public.group_duplicate_suggestion (LEAST(group_id, duplicate_group_id), GREATEST(group_id, duplicate_group_id));
