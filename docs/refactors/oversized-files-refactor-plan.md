# Refactor Plan: Oversized Files

> Status: proposed / not started. Pre-existing tech debt flagged during the
> `rework/marketplace` review. **Do as its own branch off `develop`** — unrelated
> to marketplace work. Target: behavior-preserving full restructure.

Two files were flagged as the only hard code signal from the review:

- `app/Http/Controllers/Api/Client/Extensions/PlayerManagerController.php` — **1,599 LOC**
- `resources/scripts/components/admin/modules/email/ResendSettings.tsx` — **1,343 LOC**

Neither is touched by `rework/marketplace` (`git diff develop...HEAD` is empty for
both; last touched by the Extension/billing merges). They are pre-existing tech
debt, not introduced by that branch.

---

## 1. PlayerManagerController.php (1,599 LOC → target ~250 LOC controller)

### Why
Classic "fat controller": 20 API endpoints + 24 private helpers, only 2 deps
injected (`DaemonFileRepository`, `DaemonCommandRepository`). Cache/Http/Activity
facades, the Mojang API, `MinecraftPing`/`MinecraftQuery`/`NbtParser`, and raw
JSON file editing are all inlined. Eight code patterns repeat throughout.

### Target pattern (already in this codebase, follow it)
- Thin reference controllers: `BackupController` (~224 LOC, delegates to 4 services
  + repositories + a Transformer), `ServerGroupController` (~100 LOC).
- Existing domain services live in
  `app/Services/Extensions/MinecraftPlayerManager/` (`MinecraftPing`,
  `MinecraftQuery`, `NbtParser` already extracted).
- Transformers: `app/Transformers/Api/Client/*` (fractal). Controller currently
  uses none — returns raw arrays/`JsonResponse`.

### Extract these services (new, under `app/Services/Extensions/MinecraftPlayerManager/`)
1. **PlayerLookupService** — `lookupUser()` (170-206), `lookupUserName()` (208-252),
   `formatUuid()` (164-168). UUID↔name resolution, usercache + Mojang API, offline mode, caching.
2. **ServerPropertiesService** — `getServerProperties()` (263-285),
   `isQueryEnabled()` (287-296), `isOfflineMode()` (298-307),
   `isBukkitBased()` (309-319), `getWorldDirectory()` (1222-1247).
3. **ServerQueryService** — `queryApi()` (90-150), `getServerVersion()` (1045-1096).
   Orchestrates `MinecraftPing`/`MinecraftQuery`, caching, version capability detection.
4. **PlayerListService** — JSON file CRUD for ops.json / whitelist.json /
   banned-players.json / banned-ips.json. Owns the repeated
   load→decode→dedupe-check→write→sync-command flow (see patterns below). Backs
   `op/deop/setWhitelist/addWhitelist/removeWhitelist/ban/unban/banIp/unbanIp`.
5. **PlayerCommandService** — `kick()` (948), `whisper()` (980), `kill()` (1012)
   command bodies + the Bukkit-prefix command-send helper used everywhere.
6. **PlayerDataService** — `getPlayerData()` NBT body (1101-1217), wrapping `NbtParser`.
7. **PlayerAttributeService** — `getAttribute/setAttribute/resetAttribute/getAttributes`
   bodies + `sanitizeAttributeName()` (1450-1485), `getAttributeDefault()` (1490-1522),
   `getAttributeList()` (1527-1598), and the version-capability gate.

### Extract to Form Requests (`app/Http/Requests/Api/Client/Servers/PlayerManager/`)
- Move `sanitizePlayerName` (42-53), `sanitizeIpAddress` (58-66),
  `sanitizeMessage` (71-76) into request validation rules / a shared `Rule` or
  cast, replacing the 13× repeated "sanitize → JsonResponse(400)" block.
- Move the per-endpoint `checkExtensionEnabled()` (81-88) gate into a Form Request
  `authorize()` or a route middleware (it currently runs in every action).

### Extract a Transformer
- `PlayerDataTransformer` (`app/Transformers/Api/Client/`) for the NBT
  inventory/armor/location/stats response shape from `getPlayerData()`.

### The 8 repeated patterns to kill (collapse into the services above)
1. load file → `json_decode` → array-guard (8+ sites) → `PlayerListService::load()`.
2. duplicate-exists check before add (4 sites) → `PlayerListService::existsBy()`.
3. write JSON → `usleep(500000)` → send (bukkit-prefixed) command (8+ sites) →
   `PlayerListService::persistAndSync()`.
4. sanitize name → `lookupUserName` → null-guard (13+ sites) → Form Request + service.
5. command-send with bukkit check (12 sites) → `PlayerCommandService::send()`.
6. `Activity::event(...)->property(...)->log()` (10+ sites) → a small loggable
   helper or per-service logging.
7. attribute version gate (4 sites) → `ServerQueryService::assertSupportsAttributes()`.
8. `JsonResponse(['success' => true])` (11 sites) → standard response helper.

### Resulting controller
~250 LOC, injecting the 7 services above; each action: validate (Form Request) →
delegate to one service call → return transformer/standard response.

### Risk / verification
- Behavior-preserving. No route or response-shape changes (frontend `mods.ts`/
  player-manager API consumers must see identical JSON).
- Verify: exercise each endpoint (op/deop, whitelist add/remove/toggle, ban/unban,
  banIp/unbanIp, kick/whisper/kill, getPlayerData, attributes get/set/reset,
  index, version) against a live MC server and diff responses before/after.
- Watch the cache keys (`minecraftserver:version:{id}`, usercache TTLs) — keep keys
  identical so cached state survives deploy.

---

## 2. ResendSettings.tsx (1,343 LOC → target ~300 LOC shell + extracted files)

### Why
Monolithic component: 25 `useState`, 8 `useMemo`, 2 `useEffect`, 4 tabs
(overview / smtp / resend / testing), 8 inline sub-components, `updateSettings`
called from 5 near-identical handlers, form-field/credential JSX repeated 7+ times.

### House-style caveat (read before doing this)
No other admin module splits into hooks/sub-files — local convention is single-file
components (`AISettings`/`SettingsContainer.tsx` uses **Formik**; `ExtensionsContainer.tsx`
keeps sub-components inline). A full hooks-extraction **diverges** from local style.
Two acceptable directions — pick one with the team:
- **(A) Hooks + files split** (below) — cleaner separation, diverges from convention.
- **(B) Formik migration** — collapses the 25 `useState` + `hasChanges` `useMemo`
  (16 deps) into Formik form state, matching `AISettings`. Bigger conceptual change
  but consistent with the codebase. **Recommended if the team values consistency.**

### Full-restructure target (direction A) — proposed file layout
Under `resources/scripts/components/admin/modules/email/`:

- `ResendSettings.tsx` — shell only: tab state + layout + `<Footer/>` (~300 LOC).
- `types.ts` — `TabKey` (line 38), `TestResult` (40-46); or move into
  `@/api/routes/admin/email`.
- `helpers.ts` — `resolveEmailResponseStatus`, `getFlashType`, `pickWithFallback`,
  `extractErrorMessage` (currently inline at 53-68, 112, 1294-1302).
- `hooks/useEmailSettings.ts` — initial load `useEffect` (115-172) + the 8 `useMemo`
  derived values (174-293): `resolvedReplyTo`, `initialSender`, `activePlan`,
  `activeUsage`, `hasChanges`, `smtpConfigured`, `resendConfigured`, `currentStatus`.
- `hooks/useEmailActions.ts` — the 6 handlers (299-607): `handleSave`,
  `handleToggleEnabled`, `handleClearResendApiKey`, `handleClearSmtpPassword`,
  `handleResetSmtp`, `handleConnectionCheck`, `handleSendTestEmail`. Collapse the
  5 duplicate `updateSettings(...)` calls into one internal `persist(payload)`.
- `components/` — promote inline sub-components to files and add the missing ones:
  - existing inline → files: `TabList` (1110), `Card` (1154), `ProviderPill` (1166),
    `InputField` (1193), `StatusBadge` (1212), `StatusCard` (1225),
    `ResultBanner` (1271), `UsageStat` (1304).
  - new reusable: `EncryptionSelect` (currently hardcoded `<select>` 833-843),
    `CredentialSection` (clear/reset + input duplicated at 801-830 SMTP & 900-923 Resend).
- tab bodies → `tabs/OverviewTab.tsx` (624-757), `tabs/SmtpTab.tsx` (759-874),
  `tabs/ResendTab.tsx` (876-1045), `tabs/TestingTab.tsx` (1047-1089).

### Duplication to collapse
- 5× `updateSettings` handlers → single `persist()` in `useEmailActions`.
- 7× `Label + Input + space-y-1` → `InputField` everywhere (already exists, underused).
- 2× SMTP/Resend credential blocks → `CredentialSection`.
- 2× transport config headers → shared header component.

### Risk / verification
- Pure frontend restructure, behavior-preserving. No API route changes.
- `eslint` + `tsc` clean; the repo already runs eslint (see `package updates + eslint`
  commit). Run the project lint/build.
- Manual: load the email settings page, switch all 4 tabs, toggle enabled, save,
  clear API key, clear/reset SMTP password, run SMTP + Resend connection tests, send
  a test email — confirm identical behavior and flash messages.

---

## 3. Sequencing & effort

| Item | Order | Notes |
|---|---|---|
| Controller services + Form Requests + Transformer | 1st | Higher value, clear local pattern, lower UI risk |
| ResendSettings split (pick A or B) | 2nd | Decide Formik-vs-hooks with team first |

Each is its **own branch/PR off `develop`**, kept independent of `rework/marketplace`.
