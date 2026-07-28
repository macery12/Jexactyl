# PR title

`security: complete 2026-07-26 audit remediation`

# PR description

## Summary

This PR remediates every confirmed application finding from the independently
validated 2026-07-26 M12Labs Panel security audit.

The work hardens payment integrity and idempotency, delegated-administrator
authorization, account recovery, daemon ownership boundaries, secret logging,
file permissions and request costs, atomic quota/entitlement handling, browser
secret cleanup, and multipart backup completion.

M12-SEC-017 remains an exact-deployment validation item. M12-SEC-018 is
restricted at the Panel boundary so Wings-RS executable upgrades require an
active root administrator, while exact daemon installation behavior still
requires staging evidence. M12-SEC-019 remains rejected because deferred
plan-change charging is an explicit business policy.

No connected database migration, deployment, provider request, webhook,
daemon/node call, credential rotation, or destructive external action was
performed while preparing this branch.

## Audit coverage

| Finding | PR disposition |
| --- | --- |
| M12-SEC-001 | Immutable checkout snapshots, mandatory retry nonce, unique provider identifiers, and provider/local integrity checks. |
| M12-SEC-002 | PayPal creation and fulfillment use one immutable server-side snapshot. |
| M12-SEC-003 | PayPal redirect/webhook renewal processing is idempotent. |
| M12-SEC-004 | Fulfillment is claimed before provisioning; stale captured work and correlated verified PayPal evidence are recoverable/retained. |
| M12-SEC-005 | Application API actions fail closed without explicit delegated-role permission. |
| M12-SEC-006 | Daemon resources and activity actors are scoped to the authenticated node/server. |
| M12-SEC-007 | Activity payloads and URLs are recursively redacted at write and read boundaries. |
| M12-SEC-008 | Suspension uses explicit idempotent suspend/unsuspend operations and revokes every credential. |
| M12-SEC-009 | All password-recovery paths transactionally revoke sessions plus Account and Application API keys. |
| M12-SEC-010 | Root, self, final-root, ownership, and quota deletion invariants are lock-protected. |
| M12-SEC-011 | Coupon/free-product reservations and owner/product/plan transitions are atomic. |
| M12-SEC-012 | Overwrite-capable daemon operations require both `file.create` and `file.update`; wipes also require `file.delete`. |
| M12-SEC-013 | File diff input and algorithmic work are capped before JSON transformation and rate-limited. |
| M12-SEC-014 | Multipart work is bounded and completed only from provider-authoritative parts matching the authorized exact size. |
| M12-SEC-015 | Database, backup, allocation, and subuser quota consumption is serialized or collision-safe. |
| M12-SEC-016 | Checkout secrets and console history are memory-only and cleared on sensitive lifecycle paths. |
| M12-SEC-017 | Deployment validation only; exact running daemon evidence is still required. |
| M12-SEC-018 | Panel policy resolved as active-root-only executable upgrade; exact daemon behavior still needs staging validation. |
| M12-SEC-019 | Rejected explicit deferred-charging policy; unchanged. |
| M12-SEC-020 | Free-renewal duration is server-authoritative. |

See `docs/security-remediation-completion-2026-07-28.md` for the complete
finding disposition, resolved decisions, compatibility notes, validation
evidence, and remaining deployment-only risks.

## Key implementation changes

### Payment and fulfillment

- Persist immutable local order state before provider creation.
- Require a UUID `checkout_nonce` for Stripe and PayPal create calls so a lost
  response can be retried without creating a second logical order.
- Enforce unique provider order, transaction, and capture identities.
- Verify amount, currency, customer, product metadata, and local integrity
  before capture/fulfillment.
- Atomically claim fulfillment before provisioning and recover stale captured
  claims.
- Correlate verified PayPal event type/order evidence and retain failed or
  processing reconciliation records.

### Authorization and account recovery

- Fail closed on undeclared Application API permissions.
- Enforce active account state across admin, API-key, and session issuance.
- Replace the suspension toggle with separate retry-safe suspend and unsuspend
  endpoints.
- Prevent public suspension operations from bypassing pending jGuard approval;
  jGuard transitions require an actual pending entry/account.
- Revoke browser sessions, Account API keys, and Application API keys on
  suspension and every password-recovery surface.
- Make password mutation, reset-token consumption, and database credential
  revocation transactional.

### Daemon, files, and availability

- Scope remote server, transfer, backup, and activity resources to the
  authenticated node.
- Remove unused state-changing GET transfer callbacks; POST remains.
- Restrict Wings-RS executable upgrades to active root administrators.
- Require create plus update permission for raw/diff writes, uploads, pulls,
  extraction, mod downloads/retries, and modpack installation.
- Cap daemon activity before JSON parsing, bound events/metadata, resolve only
  owner/subuser actors, and apply a per-node rate limit.
- Cap file-diff bodies before JSON parsing and retain existing bounded
  byte/line/cell/output work limits.

### Entitlements, quotas, and backups

- Synchronize free-product entitlements in the same transaction as plan,
  product, or owner changes.
- Serialize paid-to-free product conversion against checkout creation.
- Reject a plan whose resource definition changes during downgrade validation.
- Persist the expected multipart byte size and reject retry size changes.
- Complete multipart uploads from a bounded, paginated provider `ListParts`
  result, ignoring caller ETags and part numbers.
- Verify the provider byte total and daemon-reported total exactly match the
  authorized size; safely reconcile uploads begun before the size column.

## Compatibility notes

- Third-party provider-create clients must send a UUID `checkout_nonce`, reuse
  it for retries of the same logical checkout, and generate a new UUID for a
  new purchase. The bundled frontend already does this.
- Create-only subusers can no longer invoke operations whose daemon API might
  overwrite an existing path; grant `file.update` when intended.
- Deployed daemons must use POST transfer success/failure callbacks.
- Wings-RS executable upgrades are no longer available to delegated
  `nodes.update` users.

## Database migrations

This branch adds:

1. `2026_07_26_000001_harden_payment_fulfillment.php`
2. `2026_07_26_000002_create_paypal_webhook_events_table.php`
3. `2026_07_26_000003_add_atomic_billing_reservations.php`
4. `2026_07_28_000001_add_expected_size_to_backups.php`
5. `2026_07_28_000002_correlate_paypal_webhook_events.php`

They were not applied to a connected environment. Deployment uses only the
normal Laravel maintenance flow:

```bash
php artisan down
php artisan migrate --force
php artisan up
```

No extra acknowledgement environment variable is required. Migration
prechecks stop on real provider/order/coupon/free-entitlement conflicts so
operators can reconcile the data before retrying.

Stripe webhook configuration must include `customer.deleted` and
`payment_intent.succeeded`.

## Verification

- 89 changed unit tests passed, 202 assertions.
- 35 remote/backup/activity integration tests passed, 175 assertions.
- 3 suspension API integration tests passed, 16 assertions.
- Fresh isolated SQLite migration and seed passed with all five security
  migrations.
- PHPStan passed across every changed PHP source/configuration/route/migration.
- PHP-CS-Fixer dry-run passed across every changed PHP file.
- Frontend ESLint and TypeScript project checks passed.
- `git diff --check` passed.

Expected environment notes:

- PHPUnit reports the repository's existing XML-schema deprecation.
- The full pre-existing `UserControllerTest` has one unrelated exact-JSON
  assertion that omits existing transformer fields; all new suspension
  regressions pass.
- SQLite cannot prove MySQL/InnoDB multi-connection locking. Exercise the
  fulfillment, quota, and entitlement contention paths against isolated MySQL
  before production.

## Remaining deployment validation

- [ ] Record the exact deployed Wings/Wings-RS revision, binary hash, build
      provenance, downloader/redirect/DNS behavior, blocked CIDRs, TLS config,
      and egress policy for every node.
- [ ] Confirm every deployed daemon uses POST transfer callbacks.
- [ ] Run payment sandbox, object-storage, daemon, and two-connection MySQL
      contention tests in isolated staging.
- [ ] Configure an object-storage `AbortIncompleteMultipartUpload` lifecycle;
      presigned `UploadPart` requests do not cryptographically bind
      `Content-Length`.
- [ ] Add or document object-storage reconciliation for the rare case where
      provider completion succeeds but the following local DB commit fails.
- [ ] Review the original audit's H-01 through H-06 non-vulnerability hardening
      observations as separate product/deployment work.

## Reviewer focus

- Payment state transitions, provider identity uniqueness, and stale-claim
  recovery under MySQL/InnoDB.
- Application API action-to-role permission inventory.
- Pending-account and credential-revocation transactions.
- Free-product entitlement transitions during concurrent checkout/admin work.
- Deployed daemon callback methods and downloader configuration.
- Multipart lifecycle cleanup and provider/local completion reconciliation.
