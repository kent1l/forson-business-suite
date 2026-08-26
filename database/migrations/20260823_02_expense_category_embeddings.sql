-- Migration: 20260823_02_expense_category_embeddings.sql
-- Description: gives every expense category a vector identity, so classification
--              can fall back on meaning instead of exact string equality.
--
-- WHY: the parser matched `category_name` by exact lowercase comparison, so a model
--   answering "Utility" or "Electricity" instead of "Utilities" matched nothing and
--   the entry arrived with no category at all. Two vectors fix this from different
--   directions:
--
--   `embedding`          — what the category IS: its name plus its description.
--                          Stable, regenerated only when the text changes.
--   `usage_centroid`     — what staff ACTUALLY file under it: the running mean of
--                          the raw text of saved entries. This is the learning half.
--                          "Food Expense" comes to know the store's own Cebuano
--                          wording without anyone approving a lexicon term.
--
-- Keeping them separate matters: a brand-new category has no usage yet and must
-- still be matchable, and a centroid dragged off by a few miskeyed entries can be
-- recomputed from scratch without losing the definition.

BEGIN;

CREATE EXTENSION IF NOT EXISTS vector;

-- Staff write in Cebuano/Bisaya, but the seeded descriptions are English, so an
-- entry like "bayad sa abang sa tindahan" (paying store rent) embeds nowhere near
-- the "Store and warehouse rental" text and Rent does not even place in the top
-- three. `local_terms` carries the local vocabulary into the embedded text while
-- leaving `description` as the clean English label people read in the UI. Admins
-- can extend it per category as the store's own wording surfaces.
ALTER TABLE expense_category
    ADD COLUMN IF NOT EXISTS local_terms        TEXT,
    ADD COLUMN IF NOT EXISTS embedding          vector(768),
    ADD COLUMN IF NOT EXISTS embedding_model    VARCHAR(100),
    ADD COLUMN IF NOT EXISTS embedding_source   TEXT,
    ADD COLUMN IF NOT EXISTS usage_centroid     vector(768),
    ADD COLUMN IF NOT EXISTS usage_sample_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS embedding_updated_at TIMESTAMPTZ;

-- Sixteen categories is far too few for an ANN index to beat a sequential scan,
-- and HNSW on a near-empty table just adds write cost. Plain scan is correct here.

-- Corrections are the highest-signal training data in the system — a human
-- explicitly overruling the AI — but nothing ever read them back. This index makes
-- them retrievable alongside the parse log.
CREATE INDEX IF NOT EXISTS idx_expense_correction_vector_model
    ON expense_ai_correction (embedding_model)
    WHERE embedding IS NOT NULL;

-- Seed the local vocabulary for the categories shipped with the module. Matched by
-- name and only filled when empty, so a store that renamed or already annotated a
-- category keeps its own wording.
UPDATE expense_category SET local_terms = v.terms
FROM (VALUES
    ('Rent',                      'abang, abangan, renta, bayad sa abang, gi-abangan nga tindahan ug bodega'),
    ('Utilities',                 'kuryente, koryente, tubig, ilaw, internet, load, telepono, bayad sa kuryente, metro'),
    ('Salaries & Wages',          'suweldo, sweldo, sahod, bayad sa trabahante, overtime, bonus, ikatrese nga bulan'),
    ('Transportation & Delivery', 'pamasahe, plete, gasolina, krudo, diesel, padala, hatod, deliber, habal-habal, taxi, tricycle'),
    ('Repairs & Maintenance',     'ayo, pag-ayo, giayo, repair, maintenance, pahid, limpyo sa makina, palit ug repuesto para sa tindahan'),
    ('Office Supplies',           'ballpen, papel, tinta, resibo, opisina, gamit sa opisina, folder, stapler'),
    ('Permits, Licenses & Taxes', 'permit, lisensya, buwis, tax, BIR, barangay clearance, mayors permit, bayad sa munisipyo'),
    ('Bank Charges & Fees',       'bayad sa bangko, charges, service fee, withdrawal fee, transfer fee, GCash fee'),
    ('Marketing & Advertising',   'anunsyo, karatula, tarpaulin, flyers, patik, pasiugda, ads'),
    ('Professional Fees',         'bayad sa abogado, accountant, konsultant, honorarium'),
    ('Insurance',                 'seguro, insurance, premium sa seguro'),
    ('Food Expense',              'pagkaon, paniudto, panihapon, lunch, merienda, meryenda, kape, tubig nga mainom, baon sa mga tawo, BBQ, bakery, karenderya'),
    ('Charity and Donations',     'donasyon, tabang, hinabang, limos, alms, gihatagan ug tabang, solicitation, ayuda'),
    ('Contracted Services',       'job order, kontrata, bayad sa gikontrata nga trabahante, piece work, pakyaw'),
    ('Employer Statutory Contributions', 'SSS, PhilHealth, Pag-IBIG, share sa kompanya, kontribusyon'),
    ('Miscellaneous',             'uban pa, lain-lain, dili masuta nga gasto')
) AS v(name, terms)
WHERE expense_category.category_name = v.name
  AND (expense_category.local_terms IS NULL OR TRIM(expense_category.local_terms) = '');

COMMIT;
