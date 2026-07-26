# PR title

`security: harden billing, authorization, daemon boundaries, logs, and quotas`

# PR description

## Summary

This PR implements the independently verified portions of the 2026-07-26
M12Labs Panel security audit. It hardens payment and fulfillment integrity,
restores fail-closed Application API authorization, enforces account state,
scopes daemon resources, redacts secrets, bounds expensive file/backup work,
serializes quota allocation, and removes sensitive browser persistence.

It also adds a forward-only billing migration runbook and a candid remediation
status document. Conditional daemon findings, compatibility-breaking policy
choices, and concrete residual gaps are intentionally listed below rather than
being represented as complete.

No migration was applied, no deployment was performed, and no payment provider,
daemon, node, webhook, or other external service was contacted while preparing
this branch.

## Audit coverage

| Finding | PR state |
| --- | --- |
| M12-SEC-001 | Implemented: immutable checkout snapshots, signed integrity fields, stable provider idempotency, and provider/local amount, currency, metadata, and customer validation. |
| M12-SEC-002 | Implemented: PayPal order creation and fulfillment use durable immutable local state. |
| M12-SEC-003 | Implemented: capture/order uniqueness and locking unify redirect/webhook renewal processing. |
| M12-SEC-004 | Core path implemented: atomic pre-provision claim, fencing, compensation, and stale captured-order recovery. Long-outage PayPal evidence retention remains a follow-up. |
| M12-SEC-005 | Implemented: explicit fail-closed Application API permission resolver and middleware ordering. |
| M12-SEC-006 | Partially implemented: server, transfer, and backup resources are node-scoped. Remote activity actor scoping and bounds remain. |
| M12-SEC-007 | Implemented for new/read data: recursive write/read sanitization, contextual secret detection, URL redaction, and removal of raw session IDs from ordinary logs. Historical data requires an offline scrub and credential rotation. |
| M12-SEC-008 | Access boundary implemented: suspended users lose admin/API access, tracked sessions, and API keys. Toggle-to-idempotent endpoint semantics remain a product/API decision. |
| M12-SEC-009 | Browser-session revocation implemented and made database-first. API-key revocation on password reset remains a policy decision. |
| M12-SEC-010 | Implemented: root, self, final-active-root, ownership, and quota deletion guards under locks. |
| M12-SEC-011 | Partially implemented: atomic checkout reservations/uniqueness are in place. Plan/admin/product transitions still need entitlement synchronization. |
| M12-SEC-012 | Intentionally unchanged pending create-versus-overwrite authorization and daemon API decision. |
| M12-SEC-013 | Computation bounded: raw/field/line/cell/work/output/log budgets plus user rate limiting. A dedicated pre-JSON-parser body cap remains. |
| M12-SEC-014 | Partially implemented: canonical limits, bounded signing loops, node throttling, ownership checks, and locked multipart upload reuse. Enforceable provider-side byte limits remain. |
| M12-SEC-015 | Implemented: locked/atomic database, backup, allocation, and subuser quota decisions. MySQL multi-connection staging validation remains. |
| M12-SEC-016 | Implemented: checkout secrets and console history are memory-only, legacy storage is removed, and logout clears state on failure. |
| M12-SEC-017 | Conditional and not claimed; exact deployed daemon evidence is required. |
| M12-SEC-018 | Conditional and not claimed; `nodes.update` host-administrator policy and deployed daemon evidence are required. |
| M12-SEC-019 | Rejected as directed; no change. |
| M12-SEC-020 | Implemented: free-renewal duration is server-authoritative while paid/coupon cycles remain intact. |

See `docs/security-remediation-status-2026-07-26.md` for the detailed handoff.

## Important implementation changes

- Persist the local order and immutable payment snapshot before provider
  creation; store the exact provider-create payload for retry stability.
- Enforce unique provider transaction/capture/order identities and atomically
  claim fulfillment before provisioning.
- Verify Stripe and PayPal completion against the durable local snapshot, and
  route provider retries through idempotent capture/fulfillment services.
- Record verified PayPal webhook attempts and negative financial events; make
  Stripe webhook processing retryable on recovery failure.
- Recover stale captured `fulfilling` orders from the scheduler without
  overlapping cleanup processes.
- Add explicit per-action Application API permission declarations and fail
  closed for undeclared actions, including correct auth-before-binding order.
- Recheck active user state while issuing keys/sessions; revoke sessions
  database-first so backing-store failure cannot leave later rows authorized.
- Add centralized daemon server/backup authorization for current-node and
  transfer-state relationships.
- Recursively sanitize activity payloads and URLs at both persistence and
  transformation boundaries.
- Add bounded file-diff algorithms and output/log budgets, plus request and
  per-user work limits.
- Bound multipart presigning and safely reuse a persisted upload ID on retries.
- Serialize quota allocation and handle allocation collisions atomically.
- Remove sensitive checkout/console state from persistent browser storage.

## Database migrations — maintenance window required

This PR adds:

1. `2026_07_26_000001_harden_payment_fulfillment.php`
2. `2026_07_26_000002_create_paypal_webhook_events_table.php`
3. `2026_07_26_000003_add_atomic_billing_reservations.php`

They were **not applied** during development. Follow
`docs/security-payment-migration-runbook-2026-07-26.md`:

1. Drain HTTP traffic, workers, scheduler, webhooks, and old replicas.
2. Take and verify a restorable database snapshot.
3. Set `M12_BILLING_MIGRATION_MAINTENANCE=confirmed` only for the controlled
   migration process.
4. Apply all three migrations and validate their postconditions.
5. Start only the new revision.

Once billing rows are written, rollback is snapshot restoration rather than
`migrate:rollback`.

Stripe webhook configuration must include `customer.deleted` and
`payment_intent.succeeded`.

## Verification

- `78 passed (208 assertions)` across the final focused security unit suite.
- `12 passed (36 assertions)` for the focused log-sanitization/session
  failure-path suite before the consolidated run.
- Earlier broad focused run: `110 passed (291 assertions)`.
- Isolated temporary-SQLite integration run: `52 passed (212 assertions)`;
  the original dynamic-allocation tests that require a non-SQLite
  `insertIgnore` path could not prove MySQL locking. The corrected allocation
  collision test passed separately.
- PHP syntax check passed for every changed/untracked PHP file.
- PHP-CS-Fixer dry run passed for every changed PHP file.
- PHPStan passed for the final auth/log/multipart changes; the earlier touched
  billing/auth/allocation analysis also passed.
- Frontend ESLint and TypeScript project checks passed.
- `git diff --check` passed.

Expected test-environment notes:

- PHPUnit reports that the repository XML configuration uses a deprecated
  schema.
- Invoking the backup integration test without the isolated migrated database
  stops in setup with `no such table: users` and zero assertions; this is a test
  harness/database initialization issue, not a provider or connected-database
  run.
- SQLite cannot demonstrate InnoDB row-lock contention. Run two-connection
  MySQL staging tests before production rollout.

## Known residual work / decisions

1. Add transactional free-entitlement synchronization to plan changes and
   administrative owner/product updates; reject or atomically backfill
   paid-to-free product conversion when servers reference the product.
2. Scope remote activity actors to users related to the authenticated
   node/server, minimize exposed actor fields, and add body/item/metadata and
   per-node rate limits.
3. Install a pre-JSON-parser body cap for the file-diff route.
4. Correlate the PayPal webhook ledger with sanitized provider order/event
   fields and retain failed/processing provider evidence until terminal
   reconciliation.
5. Design provider-enforceable multipart byte limits. The AWS SDK does not sign
   `Content-Length` for `UploadPart`, so request metadata alone is insufficient.
6. Decide whether overwrite-capable write/upload/pull/decompress/extract paths
   require both `file.create` and `file.update`, or first add daemon-level atomic
   exclusive create.
7. Decide whether suspension becomes idempotent suspend plus separately
   authorized unsuspend.
8. Decide whether password recovery revokes Account and Application API keys.
9. Decide whether `checkout_nonce` becomes mandatory for all API clients and
   whether CPU/RAM/disk are frozen in the checkout snapshot.
10. Supply the exact deployed Wings/Wings-RS revision, binary hash, build
    provenance, config, egress controls, and safe staging target for M12-SEC-017
    and M12-SEC-018. Confirm whether `nodes.update` intentionally confers
    host-administrator authority and whether legacy transfer GET callbacks can
    be removed.

## Operational security follow-up

Scrub historical activity/application logs offline and rotate potentially
exposed database/RCON credentials, payment and webhook secrets, signed or
credential-bearing pull URLs, API/access/signing keys, and command/environment
secrets. Do not copy historical credential values into the PR or tickets.

## Reviewer focus

- Validate payment state transitions and uniqueness under MySQL/InnoDB.
- Review the maintenance-only, forward-only migration behavior and snapshot
  rollback plan.
- Verify the complete Application API action-to-permission inventory.
- Confirm daemon transfer ownership semantics against the deployed revision.
- Review rate/size defaults for production workload expectations.
- Confirm all open policy decisions above before claiming the corresponding
  findings fully closed.

## Deployment checklist

- [ ] Resolve or explicitly accept every residual/policy item above.
- [ ] Complete MySQL two-connection contention tests in isolated staging.
- [ ] Validate the exact deployed daemon build and transfer callback methods.
- [ ] Verify a restorable database snapshot.
- [ ] Drain all old application processes and webhook consumers.
- [ ] Apply migrations with the maintenance acknowledgement.
- [ ] Verify migration postconditions.
- [ ] Configure required Stripe webhook events.
- [ ] Deploy only the new revision.
- [ ] Run payment sandbox and daemon staging smoke tests.
- [ ] Scrub historical logs and rotate exposed credential categories.
- [ ] Monitor fulfillment recovery, webhook retries, authorization denials, and
      multipart-upload errors.
