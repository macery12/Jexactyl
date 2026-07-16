#!/usr/bin/env node
// Enable/disable which languages get compiled into the bundle.
//
// The set of locales Paraglide compiles is driven by the `locales` array in
// project.inlang/settings.json. Trimming it means fewer per-message branches
// get generated into src/paraglide, which shrinks the build. This is a
// BUILD-TIME switch: run it, then rebuild (`pnpm build`) for the change to take
// effect. A runtime/panel toggle can only hide languages from the picker; it
// cannot shrink an already-built bundle.
//
// Usage:
//   node scripts/locales.mjs                 # list known + currently enabled
//   node scripts/locales.mjs en de fr        # enable only these (baseLocale is
//                                            #   always kept)
//   node scripts/locales.mjs --all           # enable every known locale
//
// "Known" locales are those with a messages/<locale>.json catalog.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const uiRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const settingsPath = join(uiRoot, 'project.inlang', 'settings.json');
const messagesDir = join(uiRoot, 'messages');

const raw = readFileSync(settingsPath, 'utf8');
const settings = JSON.parse(raw);
const baseLocale = settings.baseLocale ?? 'en';

// Discover every locale that actually has a catalog, so the "known" set can
// never drift from what's on disk.
const known = readdirSync(messagesDir)
    .filter(f => f.endsWith('.json'))
    .map(f => f.slice(0, -'.json'.length))
    .sort();

const current = Array.isArray(settings.locales) ? settings.locales : [];
const args = process.argv.slice(2);

// No args: report and exit without touching anything.
if (args.length === 0) {
    console.log(`base locale : ${baseLocale}`);
    console.log(`known       : ${known.join(', ')}`);
    console.log(`enabled     : ${current.join(', ')}`);
    console.log('\nUsage: node scripts/locales.mjs <locale...> | --all');
    process.exit(0);
}

const requested = args.includes('--all') ? known : args;

const unknown = requested.filter(l => l !== '--all' && !known.includes(l));
for (const l of unknown) {
    console.warn(`warning: "${l}" has no messages/${l}.json catalog — skipping`);
}

// Always keep the base locale first so the app can never boot into a missing
// catalog (mirrors the resolveLocale guard in src/i18n/index.ts). De-duplicate
// while preserving order.
const enabled = [baseLocale, ...requested.filter(l => l !== '--all' && known.includes(l))]
    .filter((l, i, a) => a.indexOf(l) === i);

// Targeted replace of just the locales array so the rest of the file's
// formatting (indentation, single-line array) is left untouched.
const nextArray = `[${enabled.map(l => `"${l}"`).join(', ')}]`;
const next = raw.replace(/("locales"\s*:\s*)\[[^\]]*\]/, `$1${nextArray}`);

if (next === raw) {
    console.error('error: could not find a "locales" array to update in settings.json');
    process.exit(1);
}

writeFileSync(settingsPath, next);
console.log(`enabled locales -> ${enabled.join(', ')}`);
console.log('run `pnpm build` to recompile with this locale set.');
