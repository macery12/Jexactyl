<?php

namespace Everest\Services\AI\Tools;

/**
 * Finds tools by name or by what someone is trying to do.
 *
 * Deliberately dumb. No embeddings, no vector store, no database — a normalised
 * in-memory index over fifty-odd tools that changes only when the panel is
 * deployed. The catalogue is small enough that the interesting failure is never
 * recall, it is a *wrong* first result, and an exact name losing to a semantic
 * near-miss is the specific wrongness that would matter most: a model that asked
 * for `startup_list` by name and got `startup_set` would go on to change the
 * thing it was asked to read.
 *
 * So the ranking is tiered rather than blended. An exact name beats an exact
 * alias, which beats a prefix, which beats every lexical score there is, and no
 * amount of accumulated token overlap can climb a tier. Ties break on the tool
 * name, so the same query asked twice returns the same answer in the same order.
 *
 * This class knows nothing about users, surfaces, sessions or permissions. It
 * ranks the candidates it is handed. Deciding *which* tools are candidates is
 * `ToolDiscoveryService`'s job, and keeping that out of here is what stops a
 * search index from quietly becoming a second, weaker authorization path.
 */
class ToolCatalogue
{
    /** Tier floors. A match in a higher tier outranks every match below it. */
    private const SCORE_EXACT_NAME = 1000;
    private const SCORE_EXACT_ALIAS = 900;
    private const SCORE_PREFIX = 700;
    private const SCORE_LEXICAL_MAX = 600;

    /**
     * What a query token is worth where it is found.
     *
     * A name and an alias are what somebody wrote down on purpose; a tag is a
     * facet shared with a dozen other tools, and a parameter name is barely
     * evidence at all — `file` appears in six schemas. Weighted accordingly, so
     * that "backup" reaches `backups_list` rather than the four tools that merely
     * take a `backup` argument.
     */
    private const WEIGHT_NAME = 60;
    private const WEIGHT_ALIAS = 45;
    private const WEIGHT_TAG = 25;
    private const WEIGHT_SUMMARY = 14;
    private const WEIGHT_PARAM = 8;

    /**
     * Words carrying no discriminating power at this catalogue size.
     *
     * Kept short on purpose. An aggressive stop list is how "how do I stop the
     * server" loses the word that mattered — so only true function words are
     * here, and anything that could name a capability stays.
     */
    private const STOP_WORDS = [
        'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'do', 'does', 'for', 'from',
        'has', 'have', 'how', 'i', 'in', 'is', 'it', 'its', 'me', 'my', 'of', 'on', 'or',
        'please', 'that', 'the', 'their', 'them', 'there', 'this', 'to', 'want', 'was',
        'what', 'when', 'where', 'which', 'who', 'why', 'with', 'you', 'your',
    ];

    /**
     * Index rows, keyed by tool name.
     *
     * @var array<string, array{aliases: string[], tokens: array<string, int>}>|null
     */
    private ?array $index = null;

    /**
     * How many tools each token appears in, for rarity weighting.
     *
     * @var array<string, int>
     */
    private array $frequency = [];

    public function __construct(private ToolRegistry $registry)
    {
    }

    /**
     * Rank candidates against a query.
     *
     * `$exactName` wins outright when it resolves to a candidate, per the doc's
     * rule that semantic search must never outrank an exact tool-name match. It
     * is not treated as a filter, though: an exact name that is *not* among the
     * candidates falls through to the query rather than returning nothing, so a
     * model naming a tool it cannot reach still gets told what it should have
     * asked for.
     *
     * @param ToolDefinition[] $candidates already reduced to what this user could
     *                                     reach on this surface, directly or after
     *                                     a declared transition
     *
     * @return CatalogueMatch[] highest first, at most $limit
     */
    public function search(array $candidates, string $query, ?string $exactName, int $limit): array
    {
        $byName = [];
        foreach ($candidates as $definition) {
            $byName[$definition->name] = $definition;
        }

        $scores = [];

        if ($exactName !== null && $exactName !== '') {
            $resolved = $this->resolveExact($exactName, $byName);

            if ($resolved !== null) {
                $scores[$resolved] = self::SCORE_EXACT_NAME;
            }
        }

        $tokens = $this->tokenise($query);
        $normalisedQuery = implode(' ', $this->tokenise($query, false));

        foreach ($byName as $name => $definition) {
            if (isset($scores[$name])) {
                continue;
            }

            $score = $this->score($name, $normalisedQuery, $tokens);

            if ($score > 0) {
                $scores[$name] = $score;
            }
        }

        // Score, then reads, then name.
        //
        // Reads come first among equals because an ambiguous query should surface
        // the recoverable tool. "Do I have any backups" ties `backups_list`
        // against `backup_create` on tokens alone, and offering the model the
        // create first is how a question becomes an action.
        //
        // The name is the final tie-break so the ordering is total: without it
        // two tools tying on everything come back in whatever order the
        // catalogue happened to build, and an identical query stops being
        // answerable identically.
        uksort($scores, function (string $a, string $b) use ($scores, $byName) {
            return $scores[$b] <=> $scores[$a]
                ?: ($byName[$b]->isRead() <=> $byName[$a]->isRead())
                ?: strcmp($a, $b);
        });

        $matches = [];
        foreach (array_slice($scores, 0, max(1, $limit), true) as $name => $score) {
            $matches[] = new CatalogueMatch($byName[$name], $score);
        }

        return $matches;
    }

    /**
     * Resolve a name the model supplied to a candidate.
     *
     * Tolerant of the two things models actually get wrong — case, and hyphens
     * for underscores — and nothing else. It will not guess at a near-miss:
     * `startup_lst` returns null and becomes a query, because silently resolving
     * a typo to a neighbouring tool is how a read turns into a write.
     *
     * @param array<string, ToolDefinition> $byName
     */
    private function resolveExact(string $exactName, array $byName): ?string
    {
        if (isset($byName[$exactName])) {
            return $exactName;
        }

        $wanted = strtolower(str_replace('-', '_', trim($exactName)));

        foreach ($byName as $name => $_) {
            if (strtolower($name) === $wanted) {
                return $name;
            }
        }

        return null;
    }

    /**
     * @param string[] $tokens
     */
    private function score(string $name, string $normalisedQuery, array $tokens): int
    {
        $row = $this->index()[$name] ?? null;

        if ($row === null || $normalisedQuery === '') {
            return 0;
        }

        // Tier 2: the query *is* one of the phrases an operator wrote down.
        if (in_array($normalisedQuery, $row['aliases'], true)) {
            return self::SCORE_EXACT_ALIAS;
        }

        // Tier 3: the query names the tool, or the tool's name opens the query.
        $flatName = str_replace('_', ' ', $name);
        if ($normalisedQuery === $flatName
            || str_starts_with($flatName, $normalisedQuery)
            || str_starts_with($normalisedQuery, $flatName)) {
            return self::SCORE_PREFIX;
        }

        if ($tokens === []) {
            return 0;
        }

        // Tier 4: weighted overlap, normalised by query length so a long question
        // is not scored more highly than a short one merely for containing more
        // words, and capped so it can never reach the tier above.
        $total = 0.0;
        foreach ($tokens as $token) {
            $total += ($row['tokens'][$token] ?? 0) * $this->rarity($token);
        }

        // Compared as a float, not against the integer zero. Rarity weighting
        // made this a float, and `0.0 === 0` is false — which meant a query
        // matching nothing at all fell through to the `max(1, …)` below and
        // scored every tool in the catalogue at 1. "Reticulate the splines"
        // returned five tools in alphabetical order.
        if ($total <= 0.0) {
            return 0;
        }

        $normalised = (int) round($total / max(1, count($tokens)) * 3);

        return min(self::SCORE_LEXICAL_MAX, max(1, $normalised));
    }

    /**
     * How much a token is worth, given how many tools carry it.
     *
     * A word that half the catalogue uses is barely evidence — "panel" tags six
     * admin tools and tells you nothing about which — while a word only one tool
     * claims is nearly conclusive. Without this, "panel revenue" ranked
     * `admin_activity` above `admin_billing_analytics`, because a common token
     * matched at full weight scored the same as the rare token that was the
     * entire point of the query.
     *
     * Scaled to 1.0 for a token unique to one tool, so the weights above keep
     * meaning what they say and rarity only ever discounts.
     */
    private function rarity(string $token): float
    {
        $total = max(1, count($this->index()));
        $seen = max(1, $this->frequency[$token] ?? 1);

        return log($total / $seen + 1) / log($total + 1);
    }

    /**
     * Build the searchable index once.
     *
     * Over the whole registry rather than over the candidates, because the index
     * is a property of the deployment and the candidate set changes with every
     * user, surface and session. Rebuilding it per query would make retrieval
     * cost more than the schemas it saves.
     *
     * @return array<string, array{aliases: string[], tokens: array<string, int>}>
     */
    private function index(): array
    {
        if ($this->index !== null) {
            return $this->index;
        }

        $index = [];

        foreach ($this->registry->all() as $definition) {
            $tokens = [];

            $add = function (string $text, int $weight) use (&$tokens): void {
                foreach ($this->tokenise($text) as $token) {
                    // Highest weight wins rather than accumulating: a word that
                    // is both the tool's name and one of its tags should not
                    // outscore a word that is only the name, which is what
                    // summing produced — `backups_list` beat `backup_create` on
                    // the query "create a backup".
                    $tokens[$token] = max($tokens[$token] ?? 0, $weight);
                }
            };

            $add(str_replace('_', ' ', $definition->name), self::WEIGHT_NAME);

            foreach ($definition->aliases() as $alias) {
                $add($alias, self::WEIGHT_ALIAS);
            }

            foreach ($definition->tags() as $tag) {
                $add($tag, self::WEIGHT_TAG);
            }

            $add($definition->category(), self::WEIGHT_TAG);
            $add($definition->summary(), self::WEIGHT_SUMMARY);

            // An empty schema is encoded as an stdClass so it serialises as `{}`
            // rather than `[]`, which some providers reject. Cast rather than
            // guard, so a tool that gains parameters later is indexed either way.
            foreach (array_keys((array) ($definition->parameters['properties'] ?? [])) as $parameter) {
                $add((string) $parameter, self::WEIGHT_PARAM);
            }

            $index[$definition->name] = [
                'aliases' => array_map(
                    fn (string $alias) => implode(' ', $this->tokenise($alias, false)),
                    $definition->aliases()
                ),
                'tokens' => $tokens,
            ];

            foreach (array_keys($tokens) as $token) {
                $this->frequency[$token] = ($this->frequency[$token] ?? 0) + 1;
            }
        }

        return $this->index = $index;
    }

    /**
     * Lowercase, split on anything that is not a letter or digit, fold plurals,
     * optionally drop function words.
     *
     * Stop words are kept when normalising an alias for exact comparison — "what
     * port am i on" has to match the alias somebody wrote as "what port am i on"
     * — and dropped when scoring, where they would match everything.
     *
     * @return string[]
     */
    private function tokenise(string $text, bool $dropStopWords = true): array
    {
        $parts = array_map(
            fn (string $part) => $this->singular($part),
            preg_split('/[^a-z0-9]+/', strtolower(trim($text)), -1, PREG_SPLIT_NO_EMPTY) ?: []
        );

        if (!$dropStopWords) {
            return $parts;
        }

        return array_values(array_unique(array_filter(
            $parts,
            fn (string $part) => !in_array($part, self::STOP_WORDS, true),
        )));
    }

    /**
     * Fold a trailing plural `s`, applied to index and query alike.
     *
     * Not a stemmer, and deliberately not: at this catalogue size a real one
     * costs more than it returns and introduces collisions nobody can predict.
     * What this fixes is the one gap that actually bit — an operator writing the
     * alias "discount codes" while a user types "discount code", which put the
     * *create* tool ahead of the *list* tool for a plainly read-shaped query.
     *
     * The exclusions matter more than the rule. `status`, `address` and
     * `analysis` all end in `s` and none of them is a plural, and folding them
     * would break the tools those words are the whole point of.
     */
    private function singular(string $word): string
    {
        if (strlen($word) < 4 || !str_ends_with($word, 's')) {
            return $word;
        }

        foreach (['ss', 'us', 'is'] as $ending) {
            if (str_ends_with($word, $ending)) {
                return $word;
            }
        }

        return substr($word, 0, -1);
    }
}
