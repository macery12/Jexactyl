# Payment hardening migration runbook

The migrations dated `2026_07_26_000001` through `000003` add the durable
payment, webhook, coupon-reservation, and free-entitlement invariants required
by the security remediation. They have not been applied by this remediation.

## Required deployment boundary

These migrations contain MySQL DDL, which implicitly commits, and data
backfills that cannot be made atomic with writes from an old application
version. Do not use a rolling or mixed-version deployment.

Before running them:

1. Stop HTTP traffic to every Panel instance.
2. Stop queue workers, the scheduler, webhook delivery, and every other process
   that can create or update orders, payment transactions, coupons, servers, or
   free-product ownership.
3. Confirm no old Panel instance can write to the database.
4. Take and verify a restorable database snapshot.
5. Reconcile every non-processed provider-backed order and every duplicate
   provider identifier, coupon usage, or free-product ownership reported by the
   migration prechecks.
6. Set `M12_BILLING_MIGRATION_MAINTENANCE=confirmed` only in the migration
   process and run the migrations once.
7. Verify all three migrations are recorded, their new unique indexes and
   foreign keys exist, no provider-backed non-processed order lacks an immutable
   snapshot, and every existing free-product ownership has one entitlement row.
8. Start only the hardened application version, then restart the scheduler,
   queue workers, and webhook traffic.

Before reopening checkout, verify in the Stripe dashboard/configuration that the
existing signed webhook endpoint is subscribed to both `customer.deleted` and
`payment_intent.succeeded`. The latter is the recovery path when Stripe captures
payment but the browser or Panel process exits before local fulfillment finishes.
No provider configuration was changed as part of this remediation.

If a migration fails after making any schema change, keep all writers stopped.
Do not rerun it against a partially changed schema and do not improvise a
manual rollback. Restore the verified pre-migration snapshot, address the
reported precondition, and retry the complete sequence.

## Rollback policy

The schema is additive and must be treated as forward-only once any billing
data exists. If application code must be rolled back, leave this schema in
place and deploy a schema-compatible application build. Do not execute
`migrate:rollback` after payment, order, coupon, entitlement, or webhook
evidence has been written.

For an unused empty installation only, the guarded `down()` methods permit a
normal rollback. For every used installation, restoring the verified
pre-migration database snapshot is the only supported schema rollback.
