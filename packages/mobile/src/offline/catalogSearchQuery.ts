/**
 * Query-string handling for the local catalogue search, kept free of any
 * database dependency so it can be tested directly -- the same split as
 * queueLogic against outbox.
 */

/**
 * Turns whatever someone typed into a safe FTS5 MATCH expression.
 *
 * FTS5 reads bare punctuation as query syntax, and part numbers are made
 * almost entirely of punctuation: "9-09924-415-0" would otherwise parse as a
 * chain of NOT operators and either raise or return nonsense. Each run of
 * alphanumerics is therefore quoted as a literal token, which strips every
 * operator a user could type -- deliberately or otherwise -- and given a
 * trailing wildcard so results appear while typing.
 *
 * Tokens are ANDed: a second word should narrow the list, since staff type
 * more words when the first attempt returned too much.
 *
 * Returns null when there is nothing searchable, which callers treat as an
 * empty result rather than running an unbounded query.
 */
export const buildMatchExpression = (keyword: string): string | null => {
    const tokens = (keyword ?? '')
        .toLowerCase()
        .split(/[^a-z0-9]+/i)
        .filter(Boolean);

    if (tokens.length === 0) return null;
    return tokens.map((t) => `"${t}"*`).join(' AND ');
};

export default buildMatchExpression;
