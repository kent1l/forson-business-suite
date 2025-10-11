-- Cheque printing infrastructure: templates and print records
-- Includes related permissions for template management and printing

CREATE TABLE IF NOT EXISTS public.cheque_templates (
    template_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    template_name character varying(160) NOT NULL,
    description text,
    paper_width_mm numeric(10,2) NOT NULL DEFAULT 203.20,
    paper_height_mm numeric(10,2) NOT NULL DEFAULT 92.08,
    dpi integer NOT NULL DEFAULT 300,
    margin_top_mm numeric(10,2) NOT NULL DEFAULT 0,
    margin_left_mm numeric(10,2) NOT NULL DEFAULT 0,
    settings jsonb NOT NULL DEFAULT '{}'::jsonb,
    elements jsonb NOT NULL DEFAULT '[]'::jsonb,
    is_default boolean NOT NULL DEFAULT false,
    is_archived boolean NOT NULL DEFAULT false,
    version integer NOT NULL DEFAULT 1,
    created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by integer REFERENCES public.employee(employee_id) ON DELETE SET NULL,
    updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by integer REFERENCES public.employee(employee_id) ON DELETE SET NULL,
    CONSTRAINT chk_cheque_templates_dimensions CHECK (paper_width_mm > 0 AND paper_height_mm > 0 AND dpi > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cheque_templates_name_unique
    ON public.cheque_templates (lower(template_name))
    WHERE is_archived = false;

CREATE TABLE IF NOT EXISTS public.cheque_prints (
    cheque_print_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id uuid NOT NULL REFERENCES public.cheque_templates(template_id) ON DELETE RESTRICT,
    cheque_number character varying(50),
    payee_name text NOT NULL,
    cheque_date date NOT NULL,
    amount_numeric numeric(16,2) NOT NULL,
    amount_in_words text NOT NULL,
    memo text,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    status character varying(16) NOT NULL DEFAULT 'printed',
    pdf_checksum character varying(64),
    printed_by integer REFERENCES public.employee(employee_id) ON DELETE SET NULL,
    printed_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    voided_by integer REFERENCES public.employee(employee_id) ON DELETE SET NULL,
    voided_at timestamp with time zone,
    void_reason text,
    created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_cheque_prints_amount_positive CHECK (amount_numeric >= 0),
    CONSTRAINT chk_cheque_prints_status CHECK (status IN ('draft', 'printed', 'voided', 'failed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cheque_prints_unique_number
    ON public.cheque_prints (cheque_number)
    WHERE cheque_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cheque_prints_template_date
    ON public.cheque_prints (template_id, cheque_date DESC);

CREATE INDEX IF NOT EXISTS idx_cheque_prints_payee_name
    ON public.cheque_prints USING gin (to_tsvector('simple', payee_name));

-- Permissions for cheque templates and printing
INSERT INTO public.permission (permission_key, description, category) VALUES
    ('cheque:template_manage', 'Create and manage cheque templates', 'Payments & Cheques'),
    ('cheque:print', 'Generate and print cheques', 'Payments & Cheques'),
    ('cheque:records_view', 'View cheque printing history', 'Payments & Cheques')
ON CONFLICT (permission_key) DO NOTHING;

-- Assign default roles (Admin, Manager, Cashier, Secretary) these permissions
INSERT INTO public.role_permission (permission_level_id, permission_id)
SELECT pl.permission_level_id, p.permission_id
FROM public.permission_level pl
CROSS JOIN public.permission p
WHERE pl.level_name IN ('Admin', 'Manager', 'Cashier', 'Secretary')
  AND p.permission_key IN ('cheque:template_manage', 'cheque:print', 'cheque:records_view')
  AND NOT EXISTS (
    SELECT 1 FROM public.role_permission rp
    WHERE rp.permission_level_id = pl.permission_level_id
      AND rp.permission_id = p.permission_id
  )
ON CONFLICT DO NOTHING;
