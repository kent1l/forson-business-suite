/**
 * Expense term lexicon — the deterministic half of AI-assisted expense entry.
 *
 * The LLM is good at reading a sentence but has no durable memory of THIS store's
 * vocabulary: "kuryente" meaning electricity, "FIBECO" being the power co-op,
 * vendor nicknames only the staff would recognise. This service records those
 * mappings as plain rows so they can be inspected, corrected and applied without
 * an LLM call at all.
 *
 * Learning is proposal-only: terms observed in real, saved expenses are written
 * as 'pending' and take effect solely after an admin approves them, so a repeated
 * mistake can never quietly become the system's opinion.
 */
const db = require('./../db');

// Words that carry no classification signal. Cebuano/Bisaya first (the primary
// entry language here), then English, then time words which would otherwise get
// mapped to whatever category happened to be used that day.
const STOPWORDS = new Set([
    // Cebuano / Bisaya function words
    'sa', 'ug', 'ang', 'og', 'kay', 'nga', 'para', 'ni', 'si', 'mga', 'ako',
    'imo', 'iya', 'among', 'atong', 'gikan', 'kada', 'pud', 'pod', 'na', 'ka',
    'ko', 'gi', 'mo', 'ra', 'lang', 'unya', 'kani', 'kana', 'diri', 'didto',
    'bayad', 'gibayad', 'palit', 'gipalit', 'kwarta', 'pesos', 'piso',
    // Cebuano time words
    'gahapon', 'karon', 'gabii', 'ugma', 'buntag', 'hapon', 'adlaw', 'bulan',
    // English function + generic expense words
    'the', 'for', 'to', 'from', 'and', 'of', 'a', 'an', 'in', 'on', 'at', 'with',
    'paid', 'pay', 'payment', 'bought', 'buy', 'purchase', 'expense', 'expenses',
    'cost', 'spent', 'php', 'peso', 'amount', 'total', 'via', 'thru', 'through',
    // English time words
    'yesterday', 'today', 'tomorrow', 'last', 'this', 'next', 'week', 'month',
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'
]);

// Terms shorter than this are too ambiguous to be worth learning.
const MIN_TERM_LENGTH = 3;
// Guards against one rambling entry flooding the review queue.
const MAX_PROPOSALS_PER_PARSE = 4;

/**
 * Canonical matching form: lowercase, punctuation-stripped, whitespace-collapsed.
 * Applied identically at write and read time so lookups always line up.
 */
function normalizeTerm(text) {
    if (text === null || text === undefined) return '';
    return String(text)
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Pulls candidate vocabulary out of a raw entry, dropping stopwords, numbers and
 * anything too short to be meaningful.
 */
function extractCandidateTerms(rawInput) {
    const normalized = normalizeTerm(rawInput);
    if (!normalized) return [];

    const seen = new Set();
    const terms = [];

    for (const token of normalized.split(' ')) {
        if (token.length < MIN_TERM_LENGTH) continue;
        if (STOPWORDS.has(token)) continue;
        // Pure numbers (amounts, dates, reference digits) classify nothing.
        if (/^\d+$/.test(token)) continue;
        if (seen.has(token)) continue;
        seen.add(token);
        terms.push(token);
    }

    return terms;
}

/**
 * Approved aliases only — pending/rejected rows must never influence parsing.
 */
async function getApprovedAliases() {
    const { rows } = await db.query(`
        SELECT a.alias_id, a.term, a.term_normalized, a.target_type,
               a.category_id, a.payee, a.payment_method_id,
               c.category_name
        FROM expense_term_alias a
        LEFT JOIN expense_category c
               ON a.category_id = c.category_id AND c.is_active = true
        WHERE a.status = 'approved'
        ORDER BY a.confirm_count DESC, a.term_normalized ASC
    `);
    return rows;
}

/**
 * Finds the approved aliases whose term appears in the given text.
 * Word-boundary matched so "gas" doesn't fire inside "gasket".
 */
function matchAliases(rawInput, aliases = []) {
    const normalized = normalizeTerm(rawInput);
    if (!normalized) return [];
    const tokens = new Set(normalized.split(' '));

    return aliases.filter((alias) => {
        const term = alias.term_normalized;
        if (!term) return false;
        // Multi-word aliases match as a phrase; single words match as whole tokens.
        return term.includes(' ') ? normalized.includes(term) : tokens.has(term);
    });
}

/**
 * Fills gaps the LLM left, using approved aliases only.
 *
 * Deliberately non-destructive: an alias never overrides a value the model
 * resolved confidently against the real category/payment-method lists. It only
 * supplies what is missing, so the lexicon can help without being able to
 * silently rewrite a correct parse.
 */
function applyAliasesToParsed(rawInput, parsed, aliases = []) {
    const matched = matchAliases(rawInput, aliases);
    if (matched.length === 0) return { parsed, appliedAliases: [] };

    const result = { ...parsed };
    const applied = [];

    for (const alias of matched) {
        if (alias.target_type === 'category' && !result.category_id && alias.category_id) {
            result.category_id = alias.category_id;
            result.category_name = alias.category_name || result.category_name;
            applied.push(alias);
        } else if (alias.target_type === 'payee' && !result.payee && alias.payee) {
            result.payee = alias.payee;
            applied.push(alias);
        } else if (alias.target_type === 'payment_method' && !result.payment_method_id && alias.payment_method_id) {
            result.payment_method_id = alias.payment_method_id;
            applied.push(alias);
        }
    }

    return { parsed: result, appliedAliases: applied };
}

/**
 * Records the vocabulary of a saved expense as pending alias proposals.
 *
 * Re-observing a term bumps confirm_count, which is what surfaces genuinely
 * recurring vocabulary above one-off noise in the review queue. Already-approved
 * or explicitly rejected rows keep their status — a rejection is permanent
 * unless an admin changes it.
 */
async function proposeAliasesFromExpense({ rawInput, categoryId, payee, employeeId }) {
    if (!rawInput || !String(rawInput).trim()) return [];

    const terms = extractCandidateTerms(rawInput).slice(0, MAX_PROPOSALS_PER_PARSE);
    if (terms.length === 0) return [];

    const proposals = [];
    const normalizedPayee = normalizeTerm(payee);

    for (const term of terms) {
        // Skip terms that already ARE the canonical payee text — an alias from a
        // word to itself teaches nothing.
        const isRedundantPayeeTerm = normalizedPayee && normalizedPayee === term;

        if (categoryId) {
            proposals.push({
                term,
                target_type: 'category',
                category_id: categoryId,
                payee: null
            });
        }

        if (
            payee && normalizedPayee && !isRedundantPayeeTerm
            && !normalizedPayee.includes(term)
            && looksLikeVariantOf(term, normalizedPayee)
        ) {
            // Only spelling variants of the saved payee become payee aliases
            // (e.g. "gracecash" -> "Grace"). Without this check every unrelated word
            // in the sentence would be proposed as a nickname for the vendor —
            // "kuryente" (electricity) would become an alias for the power co-op.
            proposals.push({
                term,
                target_type: 'payee',
                category_id: null,
                payee: String(payee).trim().substring(0, 200)
            });
        }
    }

    const inserted = [];
    for (const p of proposals) {
        try {
            const { rows } = await db.query(
                `INSERT INTO expense_term_alias
                    (term, term_normalized, target_type, category_id, payee,
                     language_hint, example_input, created_by, status)
                 VALUES ($1, $1, $2, $3, $4, $5, $6, $7, 'pending')
                 ON CONFLICT (term_normalized, target_type) DO UPDATE
                    SET confirm_count = expense_term_alias.confirm_count + 1,
                        updated_at = NOW()
                 RETURNING alias_id, term, target_type, status, confirm_count`,
                [
                    p.term,
                    p.target_type,
                    p.category_id,
                    p.payee,
                    detectLanguageHint(rawInput),
                    String(rawInput).substring(0, 500),
                    employeeId || null
                ]
            );
            if (rows[0]) inserted.push(rows[0]);
        } catch (err) {
            // Learning is best-effort and must never break expense recording.
            console.warn('[ExpenseLexicon] Failed to record alias proposal:', err.message);
        }
    }

    return inserted;
}

// Shared-prefix length at which two spellings are treated as the same name.
const VARIANT_PREFIX_LENGTH = 4;

/**
 * Whether a token is plausibly another spelling of a payee name, rather than an
 * unrelated word that merely appeared in the same sentence.
 */
function looksLikeVariantOf(term, normalizedPayee) {
    if (!term || !normalizedPayee) return false;
    if (term.length < VARIANT_PREFIX_LENGTH || normalizedPayee.length < VARIANT_PREFIX_LENGTH) return false;
    const termPrefix = term.slice(0, VARIANT_PREFIX_LENGTH);
    const payeePrefix = normalizedPayee.slice(0, VARIANT_PREFIX_LENGTH);
    return term.startsWith(payeePrefix) || normalizedPayee.startsWith(termPrefix);
}

/**
 * Coarse language tag so the review screen can show what kind of vocabulary this
 * is. Cebuano markers are checked before falling back to English.
 */
function detectLanguageHint(text) {
    const normalized = normalizeTerm(text);
    if (!normalized) return null;
    const cebuanoMarkers = [
        'sa', 'ug', 'kay', 'nga', 'gahapon', 'karon', 'bayad', 'gibayad',
        'palit', 'gipalit', 'ako', 'imo', 'pud', 'pod', 'lang', 'gikan'
    ];
    const tokens = new Set(normalized.split(' '));
    const hits = cebuanoMarkers.filter((m) => tokens.has(m)).length;
    return hits >= 2 ? 'ceb' : 'en';
}

module.exports = {
    normalizeTerm,
    extractCandidateTerms,
    getApprovedAliases,
    matchAliases,
    applyAliasesToParsed,
    proposeAliasesFromExpense,
    detectLanguageHint,
    looksLikeVariantOf,
    STOPWORDS,
    MIN_TERM_LENGTH,
    MAX_PROPOSALS_PER_PARSE
};
