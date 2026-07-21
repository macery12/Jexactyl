#!/usr/bin/env node
// Merge installed extensions' Paraglide message fragments into the panel's
// compile input.
//
// Extensions cannot write to the panel's core `messages/{locale}.json` (that path
// is outside the install allowlist). Instead each extension may ship a fragment at
//   frontend/src/extensions/packages/<id>/messages/<locale>.json
// which rides inside the already-allowed `frontend/src/extensions/packages/<id>/`
// prefix. This script collects those fragments and writes the union to
//   frontend/messages/extensions/<locale>.json
// which project.inlang/settings.json lists as a second `pathPattern`, so
// `paraglide-js compile` reads and merges it alongside the core catalog. The core
// files are never touched.
//
// Runs before every compile (see `build` / `predev` in package.json), so
// install / uninstall / enable / disable — all of which trigger a panel rebuild —
// automatically re-merge. Scope is every INSTALLED extension (a pure filesystem
// scan; no DB coupling). Keys are namespaced `ext.<id>.`, so a disabled
// extension's keys are inert dead weight rather than a collision risk.
//
// Contract enforced here (and, earlier, by the packaging tool):
//   - every key in a fragment must be prefixed `ext.<pkgId>.` (pkgId = owning dir)
//   - no two extensions may define the same key
// A violation exits non-zero so a bad fragment fails the build loudly.

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const MESSAGE_SCHEMA = 'https://inlang.com/schema/inlang-message-format';

const uiRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const settingsPath = join(uiRoot, 'project.inlang', 'settings.json');
const packagesDir = join(uiRoot, 'src', 'extensions', 'packages');
const outDir = join(uiRoot, 'messages', 'extensions');

const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
const locales = Array.isArray(settings.locales) ? settings.locales : ['en'];

function fail(message) {
    console.error(`merge-extension-messages: ${message}`);
    process.exit(1);
}

// Every installed extension package directory (each is a namespace `<id>`).
const packageIds = existsSync(packagesDir)
    ? readdirSync(packagesDir, { withFileTypes: true })
          .filter(e => e.isDirectory())
          .map(e => e.name)
          .sort()
    : [];

// locale -> { key: value }, plus a key -> owning extension map for collision detection.
const merged = Object.fromEntries(locales.map(l => [l, {}]));
const keyOwner = new Map();

for (const id of packageIds) {
    const prefix = `ext.${id}.`;
    const msgDir = join(packagesDir, id, 'messages');
    if (!existsSync(msgDir)) continue;

    for (const locale of locales) {
        const file = join(msgDir, `${locale}.json`);
        if (!existsSync(file)) continue;

        let doc;
        try {
            doc = JSON.parse(readFileSync(file, 'utf8'));
        } catch (err) {
            fail(`${id}/messages/${locale}.json is not valid JSON: ${err.message}`);
        }
        if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
            fail(`${id}/messages/${locale}.json must be a JSON object`);
        }

        for (const [key, value] of Object.entries(doc)) {
            if (key === '$schema') continue;
            if (!key.startsWith(prefix)) {
                fail(`${id}/messages/${locale}.json key "${key}" must be prefixed "${prefix}"`);
            }
            const owner = keyOwner.get(key);
            if (owner && owner !== id) {
                fail(`key "${key}" is defined by both "${owner}" and "${id}"`);
            }
            keyOwner.set(key, id);
            merged[locale][key] = value;
        }
    }
}

// Always write one file per locale — even an empty (schema-only) stub — so the
// inlang pathPattern target always exists and compile never fails on a missing
// file (e.g. fresh clone with no extensions installed).
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

let totalKeys = 0;
for (const locale of locales) {
    const entries = merged[locale];
    const count = Object.keys(entries).length;
    totalKeys += count;
    const ordered = { $schema: MESSAGE_SCHEMA };
    for (const key of Object.keys(entries).sort()) ordered[key] = entries[key];
    writeFileSync(join(outDir, `${locale}.json`), JSON.stringify(ordered, null, 4) + '\n');
}

const contributors = packageIds.filter(id => existsSync(join(packagesDir, id, 'messages')));
console.log(
    `merge-extension-messages: ${totalKeys} key(s) from ${contributors.length} extension(s) `
    + `across ${locales.length} locale(s) -> messages/extensions/`
);
