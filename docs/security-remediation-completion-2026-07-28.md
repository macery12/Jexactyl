# Security audit remediation completion — 2026-07-28

This is the final engineering handoff for the 2026-07-26 M12Labs Panel
security audit. It supplements the original audit and the earlier remediation
status document; it does not rewrite the audit's historical evidence.

## Outcome

All confirmed application findings have a code remediation and regression
coverage on this branch. Two items still require deployment evidence rather
than additional speculative Panel code:

- M12-SEC-017 needs the exact Wings/Wings-RS binary, revision, configuration,
  redirect/DNS behavior, and network egress policy from each deployed node.
- M12-SEC-018 is restricted at the Panel boundary so only an active root
  administrator can request a Wings-RS executable upgrade. The exact deployed
  daemon's installation behavior still needs staging validation.

M12-SEC-019 remains rejected because deferred charging for plan changes is an
explicit business policy. The audit's H-01 through H-06 observations remain
hardening or deployment-policy items, not confirmed vulnerabilities.

## Final finding disposition

| Finding | Final branch disposition |
| --- | --- |
| M12-SEC-001 | Remediated: immutable checkout snapshots, unique provider identities, mandatory create nonce, and provider/local integrity checks prevent PaymentIntent reuse across logical purchases. |
| M12-SEC-002 | Remediated: PayPal creation, capture, and fulfillment use one immutable server-side order snapshot. |
| M12-SEC-003 | Remediated: PayPal redirect and webhook paths share the same idempotent capture and fulfillment state machine. |
| M12-SEC-004 | Remediated: fulfillment is claimed before provisioning, stale captured claims are recoverable, and correlated verified PayPal evidence is retained. |
| M12-SEC-005 | Remediated: Application API authorization is fail-closed and explicitly permissioned. |
| M12-SEC-006 | Remediated in the Panel: daemon resources and activity actors are scoped to the authenticated node and server relationship. |
| M12-SEC-007 | Remediated for new and read data: secret-bearing activity data is recursively redacted at persistence and presentation boundaries. |
| M12-SEC-008 | Remediated: explicit idempotent suspend/unsuspend endpoints replace toggle semantics; pending jGuard state cannot be bypassed; suspension revokes every session and API key. |
| M12-SEC-009 | Remediated: every password-recovery path transactionally revokes browser sessions plus Account and Application API keys. |
| M12-SEC-010 | Remediated: root, self, final-root, ownership, and quota deletion invariants are enforced under locks. |
| M12-SEC-011 | Remediated: checkout reservations are atomic, and plan, owner, product, and paid-to-free transitions preserve the free-product entitlement invariant. |
| M12-SEC-012 | Remediated with the recommended compatibility tradeoff: every daemon operation that can overwrite a path requires both `file.create` and `file.update`; destructive modpack wipes also require `file.delete`. |
| M12-SEC-013 | Remediated: a global pre-parser body cap, bounded validation/diff work, bounded output, and a dedicated rate limit protect the endpoint. |
| M12-SEC-014 | Remediated for the audited signing-loop and completed-object risks: requested work is bounded, multipart uploads are size-bound, and completion uses the provider's authoritative paginated part list and exact byte total. Provider lifecycle caveats remain below. |
| M12-SEC-015 | Remediated: database, backup, allocation, and subuser quota decisions use locking or atomic collision handling. |
| M12-SEC-016 | Remediated: checkout secrets and console history no longer persist across sensitive browser lifecycle boundaries. |
| M12-SEC-017 | Deployment validation remains open; no vulnerability is claimed without the exact running daemon evidence. |
| M12-SEC-018 | Panel policy resolved: executable upgrades are active-root-only. Exact daemon installation behavior still needs deployment validation. |
| M12-SEC-019 | Rejected as an explicit deferred-charging business policy; no billing-model change was made. |
| M12-SEC-020 | Remediated: free-renewal duration is server-authoritative. |

## Decisions resolved during the final batch

1. Overwrite-capable writes, uploads, pulls, extraction, and marketplace
   downloads now require both create and update permission. This is the safe
   immediate control until a daemon supports atomic exclusive-create.
2. Suspension is no longer a toggle. Suspend and unsuspend are separate,
   retry-safe operations, and neither can replace pending-account approval.
3. Password recovery revokes all Account and Application API keys, as well as
   all tracked browser sessions.
4. A checkout nonce is now mandatory on Stripe and PayPal provider-create
   requests. It is a client-generated UUID identifying one logical checkout,
   not a payment secret. A client must reuse the same UUID when retrying a lost
   response, and use a new UUID for a new purchase. This prevents one retry from
   creating a second provider/local order.
5. Price, currency, product, coupon, node, billing period, and other commercial
   checkout facts remain frozen. CPU, RAM, disk, and similar administrator-owned
   product specifications intentionally follow the current product definition
   at fulfillment. They are not client-controlled, and freezing them would
   preserve stale administrator configuration. Plan changes reject a product
   definition that changes while downgrade validation is in progress.
6. Cached Wings-RS source at revision
   `8c9f49c4858287a5b0cbda5302413addeca3c9d6` was inspected and contains
   blocked-CIDR DNS resolution, redirect checks, literal-IP checks, private and
   link-local default blocks, and download concurrency controls. That source
   snapshot does not prove which binary or configuration is running on a node.
7. No in-repository caller uses legacy state-changing GET transfer callbacks.
   Those GET routes were removed; POST remains.

## Additional final hardening

- Remote activity ingestion is capped before Laravel JSON transformation,
  limited to 250 events, bounded by metadata bytes/depth/items, rate-limited per
  authenticated node, and cannot attribute an event to an unrelated user.
- A delegated `nodes.update` administrator can still inspect or edit ordinary
  node configuration but cannot install an administrator-selected executable.
- Free-product guards are moved, claimed, or released in the same transaction
  as server owner/product changes. Product conversion and checkout creation
  share product row locks so a paid-to-free race cannot bypass the guard.
- Verified PayPal ledger rows store sanitized event type and provider order
  correlation. Cleanup retains failed or processing correlated evidence.
- Billing integration settings expose server-generated Stripe and PayPal
  webhook URLs, the exact handled event subscriptions, accessible copy
  feedback, Stripe signing-secret status, and PayPal Sandbox/Live guidance.
- Multipart completion ignores caller ETags/part numbers, lists every provider
  part with bounded pagination, verifies the exact authorized size, and safely
  supports uploads started before the new size column existed.

## Compatibility changes

- Third-party Stripe/PayPal provider-create API clients must send
  `checkout_nonce` as a UUID and reuse it only for retries of the same logical
  request. The bundled frontend already does this with `crypto.randomUUID()`.
- A subuser with only `file.create` can no longer invoke a daemon operation
  that might overwrite an existing path. Grant `file.update` as well when that
  behavior is intended.
- Deployed daemons must use POST for transfer success/failure callbacks.
- Wings-RS executable upgrades now require an active root administrator.
- Existing in-flight multipart backups with no stored expected size are
  reconciled against the provider's authoritative part total at completion.

## Migrations

The branch contains five security migrations:

1. `2026_07_26_000001_harden_payment_fulfillment.php`
2. `2026_07_26_000002_create_paypal_webhook_events_table.php`
3. `2026_07_26_000003_add_atomic_billing_reservations.php`
4. `2026_07_28_000001_add_expected_size_to_backups.php`
5. `2026_07_28_000002_correlate_paypal_webhook_events.php`

They were run only on a fresh, isolated temporary SQLite database. No connected
development, test, staging, or production database was modified.

Deployment uses the normal Laravel maintenance flow:

```bash
php artisan down
php artisan migrate --force
php artisan up
```

No additional migration acknowledgement variable is required.

## Verification completed

- The complete unit suite passed with 451 tests and 1,043 assertions.
- 35 remote/backup/activity integration tests passed with 175 assertions on an
  isolated SQLite database.
- 3 suspension API integration tests passed with 16 assertions on the same
  isolated database.
- A fresh migration and seed completed with all five security migrations.
- PHPStan passed for every changed application, configuration, route, seeder,
  and migration PHP file.
- PHP-CS-Fixer dry-run passed for every changed PHP file.
- Frontend ESLint and TypeScript project checks passed.
- `git diff --check` passed.

During active parallel editing, one intermediate backup test exposed a mismatch
between orphan cleanup and retryable signing failures. The implementation now
distinguishes them: an upload that escaped failed database persistence is
aborted, while a durably persisted upload survives presign failure for a safe
retry. The final 35-test integration run passed.

The full pre-existing `UserControllerTest` still has one unrelated exact-JSON
assertion that omits the transformer's existing `email_verified` and
`stripe_id` fields. The three new suspension API regressions pass independently.

PHPUnit reports the repository's existing XML-schema deprecation. SQLite cannot
prove MySQL/InnoDB row-lock contention; that remains a staging validation.

## Remaining deployment and operational validation

These items cannot be completed truthfully from this repository alone:

1. Record the exact running Wings/Wings-RS version, binary hash, build
   provenance, downloader configuration, blocked CIDRs, redirect and DNS
   behavior, TLS settings, and outbound egress policy for every node.
2. Confirm the deployed daemon sends POST transfer callbacks before rollout.
3. Run payment-provider sandbox, object-storage, daemon, and two-connection
   MySQL contention tests in an isolated staging environment.
4. Register the canonical URLs and every event shown under Billing → Settings →
   Integrations in the matching Stripe and PayPal environments. Set the Stripe
   endpoint signing secret as `STRIPE_WEBHOOK_SECRET`.
5. Configure an object-storage `AbortIncompleteMultipartUpload` lifecycle.
   Presigned `UploadPart` URLs do not cryptographically bind `Content-Length`,
   so a compromised node can leave oversized incomplete parts until provider
   lifecycle cleanup removes them.
6. Reconcile the rare two-phase storage edge where
   `CompleteMultipartUpload` succeeds but the later local database commit
   fails. Use provider object metadata/`HeadObject` during manual or future
   automated reconciliation.
7. Review the original audit's H-01 through H-06 hardening observations:
   Cloudflare secret-view policy, remote AI images, production browser headers,
   invoice orphan cleanup, architectural secret-at-rest handling, and deployed
   daemon transport settings.

No provider, daemon, node, webhook, deployment target, or connected database was
contacted or mutated while completing this handoff.
