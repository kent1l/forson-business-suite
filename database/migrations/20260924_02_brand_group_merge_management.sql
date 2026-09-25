-- Jev AI integration, phase 1: brand/group merge audit aliases and access.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS public.brand_alias (
    brand_alias_id BIGSERIAL PRIMARY KEY,
    brand_id INTEGER NOT NULL REFERENCES public.brand(brand_id) ON DELETE RESTRICT,
    alias_name VARCHAR(100) NOT NULL,
    alias_code VARCHAR(10),
    source_brand_id INTEGER REFERENCES public.brand(brand_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (brand_id, alias_name)
);

CREATE TABLE IF NOT EXISTS public.group_alias (
    group_alias_id BIGSERIAL PRIMARY KEY,
    group_id INTEGER NOT NULL REFERENCES public."group"(group_id) ON DELETE RESTRICT,
    alias_name VARCHAR(100) NOT NULL,
    alias_code VARCHAR(10),
    source_group_id INTEGER REFERENCES public."group"(group_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (group_id, alias_name)
);

CREATE INDEX IF NOT EXISTS idx_brand_alias_name ON public.brand_alias (LOWER(alias_name));
CREATE INDEX IF NOT EXISTS idx_group_alias_name ON public.group_alias (LOWER(alias_name));

INSERT INTO public.permission (permission_key, description, category) VALUES
    ('brands:manage', 'Manage brands and merge duplicate brands', 'Data Management'),
    ('groups:manage', 'Manage groups and merge duplicate groups', 'Data Management')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO public.role_permission (permission_level_id, permission_id)
SELECT pl.permission_level_id, p.permission_id
FROM public.permission_level pl
CROSS JOIN public.permission p
WHERE pl.level_name IN ('Admin', 'Manager')
  AND p.permission_key IN ('brands:manage', 'groups:manage')
ON CONFLICT DO NOTHING;
