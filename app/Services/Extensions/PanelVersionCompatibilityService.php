<?php

namespace Everest\Services\Extensions;

use Composer\Semver\Semver;

/**
 * Matches an extension package's declared `compatiblePanelVersions` against
 * the running panel version.
 *
 * Each entry may be either an exact panel version string ("Alpha 3.0" — the
 * only form Stage 1 supported, kept working for already-published packages)
 * or a semver-range constraint (">=Alpha 3.0 <Alpha 4.0", "^3.1", "3.x"), so
 * packages no longer need republishing for every panel point release.
 *
 * Panel versions use the "<Stage> <major>.<minor>" scheme, which is not valid
 * semver, so both sides are normalized before matching: "Alpha 3.0" becomes
 * "3.0-alpha", letting composer/semver order release stages correctly
 * (3.0-alpha < 3.0-beta < 3.0-RC < 3.0 stable < 4.0-alpha).
 */
class PanelVersionCompatibilityService
{
    private const STAGE_WORDS = 'alpha|beta|rc';

    /**
     * @param array<int, string> $entries
     */
    public function satisfiedBy(string $panelVersion, array $entries): bool
    {
        $entries = array_values(array_filter($entries, 'is_string'));
        if ($entries === []) {
            return true;
        }

        // Exact match first — the original Stage 1 contract and the fast path.
        if (in_array(trim($panelVersion), array_map('trim', $entries), true)) {
            return true;
        }

        $normalizedPanel = $this->normalizeVersion($panelVersion);
        if ($normalizedPanel === null) {
            return false;
        }

        foreach ($entries as $entry) {
            $constraint = $this->normalizeConstraint($entry);
            if ($constraint === '') {
                continue;
            }

            try {
                if (Semver::satisfies($normalizedPanel, $constraint)) {
                    return true;
                }
            } catch (\UnexpectedValueException) {
                // Not a parseable constraint — exact matching above already had
                // its chance, so this entry simply doesn't match.
                continue;
            }
        }

        return false;
    }

    /**
     * Normalizes a concrete panel version to a semver string: "Alpha 3.0"
     * becomes "3.0-alpha", plain "3.0" passes through. Returns null when the
     * version cannot be interpreted, in which case only exact matching applies.
     */
    private function normalizeVersion(string $version): ?string
    {
        $version = trim($version);

        if (preg_match('/^(?<stage>' . self::STAGE_WORDS . ')[\s._-]+(?<number>\d+(?:\.\d+){0,3})$/i', $version, $matches) === 1) {
            return $matches['number'] . '-' . strtolower($matches['stage']);
        }

        if (preg_match('/^\d+(?:\.\d+){0,3}$/', $version) === 1) {
            return $version;
        }

        return null;
    }

    /**
     * Rewrites "<Stage> <number>" tokens inside a constraint expression so
     * composer/semver can parse it: ">=Alpha 3.0 <Alpha 4.0" becomes
     * ">=3.0-alpha <4.0-alpha".
     */
    private function normalizeConstraint(string $constraint): string
    {
        return (string) preg_replace_callback(
            '/(?<stage>' . self::STAGE_WORDS . ')[\s._-]*(?<number>\d+(?:\.\d+){0,3})/i',
            fn (array $matches): string => $matches['number'] . '-' . strtolower($matches['stage']),
            trim($constraint)
        );
    }
}
