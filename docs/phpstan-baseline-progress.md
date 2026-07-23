# PHPStan Baseline Audit — Progress

**Date:** 2026-07-23 · **Branch:** `audit/phpstan-baseline` · **PHPStan:** 2.2.1 (larastan), level 4

## Result

| | Before | After |
|---|---|---|
| Suppressed errors | **399** (276 entries) | **63** (45 entries) |
| Files with suppressions | 89 | 20 |

Every entry in the old baseline was treated as unverified: the file/line behind each
suppression was read and the entry classified as *safe to fix*, *security concern*,
*needs refactor*, or *acceptable / false positive*. Nothing was removed from the
baseline without the underlying issue being fixed or verified as no longer present.
`vendor/bin/phpstan analyse` and `vendor/bin/php-cs-fixer fix --dry-run` are both
clean after the changes.

## Real bugs found and fixed (previously hidden by the baseline)

Security / authorization:

- **Coupon admin endpoints referenced a nonexistent permission constant.**
  `AdminRole::BILLING_WRITE` does not exist, so `permission()` on the coupon
  store/update/delete requests threw a fatal `Error` (HTTP 500) for any role-based
  admin. Root admins bypassed the check. Fixed to `AdminRole::BILLING_UPDATE`,
  the generic billing-write permission used by sibling requests. *Behavior note:
  role admins holding `billing.update` can now manage coupons instead of getting a 500.*
- **`InvoiceEncryptionService` read `INVOICE_ENCRYPTION_KEY` via `env()`.** With a
  cached config (any production install running `config:cache`), `env()` returns
  `null`, so the service silently fell back to `APP_KEY` — a configured dedicated
  invoice key was ignored. Routed through `config('modules.billing.invoice_encryption_key')`
  (new key in `config/modules/billing.php`).
- **`AssetComposer` read `APP_DEBUG` via `env()`** — always `false` under cached
  config. Now `config('app.debug')`.
- **`PlanChangeService` read `$server->billingProductId`** (camelCase — not a real
  attribute, always `null`), so the *cannot change to a plan in a different category*
  guard never fired. Fixed to `$server->billing_product_id`.
- **Google OAuth login controller** used an undeclared dynamic `$this->config`
  property (deprecated in PHP 8.2+) and had unreachable code after the login
  redirect; `AbstractLoginController` assigned `$this->creation` without declaring
  it. All declared/cleaned; Socialite user email now read via the `getEmail()`
  contract method.

Billing / money path:

- **`PayPalCheckoutController` called `ServerFulfillmentService::dispatchPaymentFailedEmail()`,
  which had been commented out.** A failed PayPal capture would fatal
  (`Call to undefined method`) *before* recording the billing exception. The method
  was the only dispatcher of the `PaymentFailed` email event, so payment-failed
  emails never fired anywhere. Restored (with `$order->amount` corrected to
  `$order->total` — `amount` is not an Order attribute).
- **`OrderProcessorService` was missing `use Everest\Models\Billing\Product`**, so
  `processRenewal(Server, Product, …)` type-hinted a nonexistent
  `Everest\Services\Billing\Product` class → guaranteed `TypeError` on the renewal
  fulfillment path (called from `CheckoutController` and `ServerFulfillmentService`).
- The `calculatePriceWithCoupon()` `@return` docblocks omitted `subtotal` /
  `billingDays` / `multiplier` / `nodeMultiplier`, which the checkout controllers
  read — PHPStan flagged those reads as missing offsets. Docblocks corrected
  (the values were always returned; the annotation was wrong).

Other runtime bugs:

- **`SubuserController`** threw `DisplayException` without importing it — hitting the
  subuser limit produced a 500 (class-not-found) instead of the friendly error. Import added.
- **`PlayerManagerController`**: `$uuid` leaked across loop iterations, so a player
  whose Mojang lookup failed could be listed with the *previous* player's UUID.
  Also removed the unused `lookupUser()` and switched `getBody()->getContents()`
  to the HTTP client's `body()`.
- **`ExtensionsController::deleteRepository()`** declared `Illuminate\Http\Response`
  but returned a `JsonResponse` on the official-repo guard → runtime `TypeError`
  instead of the intended 422. Return type widened.
- **`StartupController::update()`** dereferenced `$variable->server_value` *before*
  the null check — an unknown variable key caused a 500 instead of the intended 400.
- **`Hashids::decodeFirst()`** called `array_first($result, null, $default)` — the
  Laravel-5-era 3-arg helper. At runtime this resolves to symfony's php85 polyfill
  (1 arg), silently ignoring `$default`. Replaced with `$result[0] ?? $default`.
- **`SendServerRenewalNoticesCommand`** logged `$server->user_id` — no such column
  (it's `owner_id`), so log context was always null.
- **`RepositoryServiceProvider`** bound `LocationRepositoryInterface` to
  `LocationRepository` — both classes were deleted in the DB rebuild. Binding removed.
- **`InitiateBackupService::$ignoredFiles`** was an uninitialized typed property;
  calling `handle()` without `setIgnoredFiles()` would throw. Now `array $ignoredFiles = []`.
- **`HandlesExtensionPackages` trait** read options (`--yes`, `--path`, `--release`, …)
  that the uninstall command doesn't define — a latent `InvalidArgumentException` if
  those helpers were ever reached from that command. Reads now go through a
  `hasOption()`-guarded `packageOption()` helper.
- **`EmailDeliveryAttempt::calculateDuration()`** assigned Carbon's float
  `diffInMilliseconds()` to an `int` column; now cast.

## Root-cause typing fixes (cleared ~200 errors)

Most of the old baseline was `property.notFound` on `Illuminate\Database\Eloquent\Model`
— untyped Eloquent relations collapsing everything to the base `Model`. Fixed at the
model layer (docblock/generics only, zero runtime impact):

- `@property` relation annotations: `PaymentTransaction::$order` (cleared ~90 errors
  across the PayPal/Stripe checkout + webhook controllers alone), `Invoice::$order/$user`,
  `JGuardEntry::$user`, `Server::$user`, `EmailDelivery::$user/$deliveryAttempts`,
  `AiUsageLog::$user/$server/$requests`, `CustomDomain::$apiKey`,
  `ExtensionFileSnapshot::$actor`, `ExtensionPackage::$repository/$files`,
  `ServerCustomDomain` (full docblock), `Node` aggregate aliases.
- `@return HasMany<X, $this>` generics: `User::servers()/serverGroups()/tickets()/sshKeys()/sessions()`,
  `Server::variables()/customDomains()/allocations()`, `Schedule::tasks()`,
  `Product::billingCycles()`.
- `User` gained `@method ApiKey|TransientToken|null currentAccessToken()` — Sanctum's
  token model is swapped to `ApiKey` at runtime (`Sanctum::usePersonalAccessTokenModel`),
  which PHPStan cannot see; this properly types the API-key-type middleware
  (`TrackAPIKey`, `RequireClientApiKey`, `AuthenticateApplicationUser`) whose
  `instanceof ApiKey` checks PHPStan wrongly reported as always-false.
- `Alert::users()` gained its missing `BelongsToMany` return type (larastan could not
  see the relation, flagging `with('users:…')`).
- `phpstan.neon`: the spatie query-builder ignore now also matches generic
  `Builder<Model>` receivers, replacing six per-file baseline entries.

## Stale entries removed (19)

Verified against a baseline-free run before removal — none of these errors are
produced anymore:

- `app/Http/Controllers/Api/Client/AccountModpacksController.php` (4) and
  `app/Models/CurseForgeRequestLog.php` (2) — files deleted from the codebase.
- `app/Extensions/Packages/*` (4) — path excluded from analysis in `phpstan.neon`;
  entries were dead weight.
- 9 entries whose code had already been fixed since the baseline was generated
  (`NewAccessToken`, `EmailController::getSettings`, `EmailTemplateController`
  variables offset, `ApiKeyController::$identifier`, `BillingProfileController`,
  `ServerGroup` relation types, `AppServiceProvider` encrypter stub,
  `InvoiceGenerationService::$billingProfile`).

## What remains in the baseline (63 errors, all annotated in-file)

Every remaining entry carries a `#` comment in `phpstan-baseline.neon` explaining
why it stays. Categories:

1. **Defensive guards larastan says are redundant (~40).** Larastan types `BelongsTo`
   relation properties (e.g. `$server->user`) and `$request->user()` as non-null;
   runtime can still hand back null (orphaned FKs, unauthenticated edge). Replacing
   `?->` with `->` or deleting the guards would trade safe null-propagation for
   potential fatals — deliberately kept, mostly in billing/PII/DNS paths.
2. **Join-select hydration (4).** `ActivityLog` queries `join(users)->select(users.uuid, users.username)`;
   the attributes exist at runtime but don't belong on the model docblock.
3. **SDK stub gaps (2).** Stripe's magic `metadata` setter accepts arrays;
   `Collection::get()` typed non-null by larastan though genuinely nullable.
4. **Belt-and-braces in the payment/parsing paths (~17).** Stripe intent re-checks,
   version-manifest parsing guards (`StartupVariableVersionService`), diff-hunk
   normalization (`FileDiffService`).

## Follow-ups (needs refactor — not done here)

- `Server::$user` / relation nullability: larastan's relation extension overrides
  `@property X|null` docblocks and reports the property non-null, which keeps the
  ~10 "always true/false" defensive-guard entries alive. Fixing properly means
  relation generics plus a sweep of every dereference site.
- `ModsController` lost its unused `IGNORED_DIRECTORIES` constant; if
  `.paper-remapped` directories should be filtered from the addon scan, that
  filtering was never wired up and would be a small feature fix.
- PHPStan is still level 4 and remains a local-only gate (not in CI).

## Reproducing

```bash
vendor/bin/phpstan analyse --memory-limit=1G           # clean
vendor/bin/php-cs-fixer fix --dry-run                  # clean
```
