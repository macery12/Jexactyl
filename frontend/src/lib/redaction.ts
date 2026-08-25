/**
 * Putting the real values back into something the model wrote.
 *
 * A file of its own, and deliberately dependency-free. This is one half of a
 * seam: the panel mints tokens in PHP (`RedactionMap::mint()`) and only the
 * browser ever resolves them, so the two implementations have to agree on a
 * format that nothing type-checks across. The guard for that agreement is
 * `RedactionSeamTest`, which generates a fixture with the real PHP redactor and
 * feeds it through *this* module under Node — which it can only do if the code
 * imports nothing a browser bundle would drag in. Keep it that way.
 */

/**
 * Applied at render time rather than to the stored entry, for two reasons. A
 * token can arrive after the prose that mentions it — the redaction event and
 * the text deltas are independent — so rewriting on arrival would miss it. And
 * keeping the entries as the model saw them means the transcript we hold and the
 * transcript the model read are the same thing, which is what makes the tool
 * payload panel worth opening.
 *
 * Cheap enough to do per render: the map is bounded at 250 entries and only
 * non-empty when redaction actually fired.
 */
export function restoreRedactions(text: string, map: Record<string, string>): string {
    if (text === '' || Object.keys(map).length === 0) return text;

    // Tokens are `[kind_hex]` — the hex being a slice of an HMAC of the value.
    // Models sometimes protect Markdown punctuation and return
    // `[kind\_hex]` or `\[kind\_hex\]`. Normalise only those reversible escapes
    // on a token-shaped candidate, then require an exact entry in the map. An
    // invented or unknown token is deliberately left byte-for-byte unchanged:
    // deriving a value from its suffix would risk showing the wrong person's
    // data. The single pass also cannot re-enter a restored value that happens
    // to contain another token.
    return text.replace(/\\?\[[a-z]+\\?_[0-9a-f]+\\?\]/g, candidate => {
        const token = candidate.replace(/\\(?=[[\]_])/g, '');

        return map[token] ?? candidate;
    });
}

/**
 * The same, over a decoded JSON payload.
 */
export function restoreRedactionsDeep(value: unknown, map: Record<string, string>): unknown {
    if (Object.keys(map).length === 0) return value;

    if (typeof value === 'string') return restoreRedactions(value, map);
    if (Array.isArray(value)) return value.map(item => restoreRedactionsDeep(item, map));

    if (value !== null && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [key, item] of Object.entries(value)) out[key] = restoreRedactionsDeep(item, map);
        return out;
    }

    return value;
}
