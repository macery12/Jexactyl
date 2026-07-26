# Security remediation status — 2026-07-26

This document records the implementation state of the findings in
`security-audit-2026-07-26.md`. It is deliberately separate from the audit:
the audit remains the statement of the original evidence, while this file is
the engineering handoff for the remediation branch.

## Safety boundary used for this work

- No production, staging, or otherwise connected database migrations were run.
- No payment-provider, daemon, node, webhook, or other external API was called.
- Database-backed integration tests used an isolated temporary SQLite database.
- The billing migrations use the normal Laravel maintenance-mode deployment
  flow and require no additional acknowledgement variable.
- The branch is not deployed and must not be merged before the migration and
  credential-rotation steps below are reviewed.

## Finding status

| Finding | Status in this branch | Summary |
| --- | --- | --- |
| M12-SEC-001 | Remediated, deployment required | Checkout snapshots, signed integrity data, stable provider idempotency, immutable provider-create payloads, and amount/currency/customer verification prevent product or price substitution. |
| M12-SEC-002 | Remediated, deployment required | PayPal creation and fulfillment use the persisted immutable order/transaction snapshot rather than later client input. |
| M12-SEC-003 | Remediated, deployment required | Capture identity and order constraints, row locks, and a single fulfillment claim make renewal processing idempotent across redirect and webhook paths. |
| M12-SEC-004 | Remediated core path; retention follow-up required | A pending order is atomically claimed before provisioning; stale claims use fencing and captured orders have scheduled recovery. The PayPal webhook ledger/cleanup residual below must be resolved before treating all long-outage evidence paths as closed. |
| M12-SEC-005 | Remediated | Application API authentication, authorization, and model binding are ordered explicitly, and privileged routes use fail-closed per-resource permissions. |
| M12-SEC-006 | Partially remediated | Remote server, transfer, and backup resources are constrained to the authenticated node. Remote activity ingestion still resolves a caller-supplied actor UUID globally and needs actor scoping/minimal projection plus hard request limits. Exact deployed daemon behavior also needs the validation listed below. |
| M12-SEC-007 | Remediated for new/read data; operational cleanup required | Structured activity data and URLs are recursively sanitized at write and read boundaries. Existing stored logs still require an offline scrub and any exposed credentials must be rotated. |
| M12-SEC-008 | Partially remediated; product decision required | Suspended users are denied admin and API access; suspension revokes tracked sessions and API keys while preserving roles. The existing toggle-style suspend endpoint still needs an API-policy decision. |
| M12-SEC-009 | Remediated for sessions; product decision required for keys | Password reset revokes every tracked browser session before establishing the new session. Whether password recovery must also revoke Account and Application API keys is an explicit policy decision. |
| M12-SEC-010 | Remediated | User deletion locks the relevant rows and blocks root deletion, self-deletion, deletion of the final active root, and ownership/quota violations. |
| M12-SEC-011 | Partially remediated | Checkout coupon/free-product reservations and ownership guards use database uniqueness and locks. Plan changes, administrative owner/product changes, and paid-to-free product updates do not yet synchronize/backfill the entitlement invariant. |
| M12-SEC-012 | Not changed; authorization/API contract required | The daemon APIs used for write, upload, pull, decompress, and extraction can overwrite existing paths. Closing this without an atomic create-only daemon primitive changes existing permission semantics; see Open decisions. |
| M12-SEC-013 | Partially remediated | Raw request, field, line, cell/work, output, and log budgets bound diff computation. A dedicated pre-JSON-parser body cap is not yet installed; the current raw check runs during request validation after framework middleware may already parse input. |
| M12-SEC-014 | Partially remediated within current storage API limits | Multipart inputs and generated part counts are bounded, URL generation is throttled, ownership is checked, and an existing multipart upload is reused safely. The AWS SDK does not sign `Content-Length` for `UploadPart`, so the requested per-part size is not cryptographically bound and provider-side completed-object limits still need a design. |
| M12-SEC-015 | Remediated | Database, backup, allocation, and subuser quota decisions use row locks/atomic conflict handling. Real MySQL multi-connection contention should still be exercised in staging. |
| M12-SEC-016 | Remediated | Checkout secrets and console history are memory-only; legacy persisted values are removed and logout clears sensitive client state even on failure. |
| M12-SEC-017 | Conditional — not claimed | The exact deployed Wings/Wings-RS binary, revision, configuration, redirect behavior, DNS re-resolution behavior, and egress policy were not available for validation. |
| M12-SEC-018 | Conditional — policy required | The Panel authorization surface is documented, but whether `nodes.update` is intentionally equivalent to host-administrator authority needs an owner decision and deployed-daemon validation. |
| M12-SEC-019 | Rejected as requested | No code change was made for the rejected business-policy candidate. |
| M12-SEC-020 | Remediated | Free renewal duration is server-authoritative; client-selected free periods are ignored while paid/coupon billing-cycle behavior remains intact. |

## Payment migration

Apply the three `2026_07_26_*` migrations using the normal maintenance-mode
flow documented in `security-payment-migration-runbook-2026-07-26.md`:

```bash
php artisan down
php artisan migrate --force
php artisan up
```

No additional environment variable is required. Configure Stripe webhooks to
include `customer.deleted` and `payment_intent.succeeded`, in addition to the
events already required.

## Required operational follow-up

Because the original finding demonstrated plaintext secret persistence,
deploying redaction code is not sufficient. Use an offline, reviewed procedure
to scrub historical activity/application logs and rotate every potentially
exposed credential category, including:

- database host usernames/passwords and database URLs/DSNs;
- RCON credentials and server environment secrets;
- PayPal and Stripe secrets or signing credentials;
- Discord and other webhook URLs/tokens;
- file-pull URLs containing userinfo, tokens, or signed query strings;
- API/access/signing keys and secrets embedded in commands or metadata.

Do not paste the historical values into tickets, pull requests, or chat while
performing the inventory.

## Open decisions and external validation

The following were intentionally not guessed:

1. **Create versus overwrite permissions (M12-SEC-012).** Decide whether every
   operation capable of replacing an existing path must require both
   `file.create` and `file.update` as an immediate compatibility-breaking
   mitigation, or first add an atomic exclusive-create primitive to the daemon
   and preserve true create-only access.
2. **Suspension API contract (M12-SEC-008).** Replace the current toggle endpoint
   with idempotent suspend and separately authorized unsuspend operations, or
   explicitly accept the existing toggle contract.
3. **Password-reset key policy (M12-SEC-009).** Decide whether password recovery
   also revokes all Account and Application API keys.
4. **Checkout nonce compatibility.** `checkout_nonce` remains optional for
   legacy direct API clients. Requiring it would make create requests strictly
   idempotent but is a public API change.
5. **Fulfillment resource snapshot.** Price/product identity is frozen, while
   CPU, RAM, and disk fulfillment currently follows the product configuration
   at fulfillment time. Decide whether these resource specifications must also
   be frozen at checkout.
6. **Daemon deployment evidence (M12-SEC-017/018).** Supply the exact deployed
   Wings/Wings-RS binary hash or revision, build provenance, configuration, and a
   safe staging target. Confirm whether `nodes.update` is intended to carry
   host-administrator authority.
7. **Transfer callback compatibility.** The current Panel accepts both GET and
   POST transfer callbacks. Confirm the deployed daemon revision before removing
   legacy state-changing GET routes.

## Known code follow-ups

These are concrete residuals found during the final review and are not hidden by
the high-level status table:

1. Add a transactional free-product entitlement transition service and call it
   from plan changes and administrative server owner/product updates. Reject or
   transactionally backfill a product price transition from paid to free while
   referenced servers exist.
2. Scope remote activity actors to the authenticated node/server relationship,
   expose only the actor data required by the activity view, and add item,
   metadata/body, and per-node rate limits.
3. Add an early middleware/body-server limit for the file-diff endpoint before
   JSON and form parsing. Keep the existing algorithmic budgets as defense in
   depth.
4. Extend the verified PayPal event ledger with sanitized event type/provider
   order correlation and retain failed/processing correlated orders, or
   conservatively retain all provider-backed expired orders until terminal
   reconciliation. The current rare failure requires a verified completion
   event to fail before local capture and remain unrecovered beyond retention,
   but deleting the evidence would still be unsafe.
5. Design enforceable object-storage size validation. The AWS SDK's SigV4
   implementation omits `Content-Length` from signed headers for `UploadPart`,
   so adding it to the command alone would not close the trust gap.

## Verification limits

- Unit and isolated SQLite integration coverage exercises the application
  invariants without touching a connected database.
- SQLite cannot prove MySQL/InnoDB `SELECT ... FOR UPDATE` behavior. Run the
  quota and fulfillment contention tests against two independent MySQL
  connections in an isolated staging environment before production rollout.
- No provider signature, webhook delivery, object-storage multipart operation,
  daemon operation, or external network path was exercised during this work.
