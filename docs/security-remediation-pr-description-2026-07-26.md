# Security remediation and billing integrity

## Required deployment actions

This PR contains database migrations. Put the Panel into maintenance mode while
applying them:

```bash
php artisan down
php artisan migrate --force
php artisan up
```

Also verify that Laravel's scheduler is invoked every minute. Scheduled plan
changes are applied by the registered
`p:billing:apply-scheduled-plan-changes` command. The task is protected against
overlap and retries a blocked change after 15 minutes.

The migrations also convert every existing Application API key to an Access
Profile. The conversion preserves the key's previous effective access: enforced
legacy read/write restrictions remain restrictions, while older unrestricted
keys receive only the capabilities their creator held at migration time.

Stripe webhooks must include:

- `customer.deleted`
- `payment_intent.succeeded`

PayPal webhooks must include:

- `CHECKOUT.ORDER.COMPLETED`
- `PAYMENT.CAPTURE.COMPLETED`
- `PAYMENT.CAPTURE.DENIED`
- `PAYMENT.CAPTURE.REFUNDED`
- `PAYMENT.CAPTURE.REVERSED`

## Summary

This PR closes the confirmed Panel-side security issues found during the July
26 review. The changes cover payment integrity, prorated plan upgrades,
scheduled downgrades, unified Access Profiles, Application API key
authorization, administrator authorization,
account recovery, daemon ownership boundaries, secret redaction, file-operation
permissions and limits, quota enforcement, browser secret cleanup, and
multipart backup completion.

The most visible behavior changes are:

- Administrators and Application API keys now use the same Access Profile
  capability model. A human has one assigned profile; an Application API key
  has one separately assigned API-eligible profile.
- The built-in Owner profile replaces `root_admin` as the source of unrestricted
  human authority. Owner cannot be edited, deleted, or assigned to an API key.
- Custom Access Profiles can be named, renamed, described, colored, and marked
  as available to API keys. No sample Support or Billing profiles are imposed.
- Moving to a more expensive plan charges only the prorated price difference
  for the server's remaining prepaid time. Its renewal date and billing cycle
  do not change.
- Moving to an equal- or lower-priced plan is scheduled for the current renewal
  date. There is no immediate resource change and no automatic refund.
- A scheduled downgrade is revalidated when it becomes due. If current usage is
  above the new limits, the old plan remains active and the Panel reports the
  reason instead of applying an unsafe downgrade.
- Checkout retries reuse the same local order and provider payment instead of
  creating duplicates.
- Password recovery and suspension revoke all browser sessions and both Account
  and Application API keys.
- Wings-RS executable upgrades can be requested only by an active interactive
  Owner. The Panel no longer accepts a caller-supplied restart command
  or download headers.

## Plan changes and charging

Plan changes now preserve the server's existing billing cycle and renewal date.
The browser displays a server-authoritative quote before continuing.

For a more expensive target plan, the amount charged now is:

```text
(target cycle price - current cycle price)
× seconds remaining until renewal
÷ seconds in the current billing cycle
```

The calculation uses integer minor currency units and rounds once at the end.
Remaining time is intentionally not capped to one cycle: if a server has
multiple prepaid cycles remaining, the price difference applies to all of that
time. A paid change is not started during the final 15 minutes before renewal,
because the quote could become stale while the provider payment is completing.

Paid upgrades use the existing Stripe or PayPal checkout and fulfillment
pipeline. The order stores the source plan, target plan, renewal date, cycle,
prices, resource definitions, and a signed checkout snapshot. Before payment
capture and again during fulfillment, the Panel verifies that the order still
owns the server's plan-change reservation and that none of those inputs changed.
The new limits are applied only after capture succeeds.

Equal-price changes and downgrades are stored on the server without changing its
current plan or limits. At the renewal date, the scheduler:

1. locks the server and checks that the schedule is still current;
2. verifies the target plan, price, cycle, and resource definition;
3. checks live resource use against any lower limits;
4. applies the plan once, or leaves it pending with a safe error and 15-minute
   retry time.

Users can cancel a scheduled change. They can also cancel a pending paid
checkout while it is still uncaptured. Renewals, scheduled changes, and paid
plan-change checkouts are mutually exclusive so that the old plan cannot be
renewed while another plan is about to take effect.

## Unified Access Profiles

Access Profiles are now the single administrative authorization model:

```text
human administrator authority = assigned Access Profile
Application API key authority = key's assigned Access Profile
```

The human who creates a key remains its creator for audit and emergency
revocation, but the key does not inherit that person's profile at request time.
Changing the creator's human permissions therefore cannot silently broaden or
narrow the key.

There is one built-in profile: **Owner**. It provides unrestricted interactive
administrator access and is protected from renaming, permission changes,
deletion, and API-key assignment. Existing root administrators are migrated to
Owner. The old `root_admin` database value is retained only as compatibility
output for older clients; it is no longer consulted for authorization.

All other profiles are operator-created or migrated custom profiles. Their
names, descriptions, colors, capabilities, and API eligibility can be changed.
The Panel does not create opinionated defaults such as Support or Billing
Viewer. Existing custom administrator roles retain their names during
migration and remain human-only until an Owner explicitly enables API
eligibility.

New Application API keys select one API-eligible custom profile instead of
configuring a separate nine-resource scope matrix. This makes the key's
authority visible and reusable in the same place as human access. The key form
also supports an expiry and IP/CIDR allowlist.

Delegation is bounded: a caller can assign a key only a profile whose
capabilities are no broader than the caller's own. A key that can create another
key is subject to the same rule. Unknown capabilities and Application API
routes without an explicit capability declaration fail closed.

The legacy nine-resource key fields remain only for one-way compatibility.
During migration:

- a previously enforced read/write grant is translated to the corresponding
  granular capabilities;
- the result is intersected with the creator's profile, so migration cannot add
  authority;
- capabilities outside the old nine-resource vocabulary are preserved only
  when the creator already held them;
- every migrated key receives an editable, API-eligible custom profile.

Allocations, locations, and server databases now have dedicated capabilities.
They no longer rely on broad node or server permissions for new profiles.

## Payment and fulfillment integrity

- The complete local order is saved and cryptographically locked before a
  provider order is created.
- Stripe and PayPal creates require a UUID checkout nonce. Retrying the same
  logical checkout reuses that nonce and order.
- Provider order, transaction, and capture identifiers are unique.
- Provider amount, currency, customer, product, and local metadata are checked
  before capture or fulfillment.
- Fulfillment is claimed atomically before provisioning. Fenced claims prevent
  two workers from completing the same order.
- Captured or provider-verified work is retained for reconciliation instead of
  being deleted as an abandoned checkout.
- PayPal redirect and webhook paths converge on the same idempotent fulfillment
  service and retain correlated event evidence.
- Coupon and free-product reservations are locked and consumed or released in
  the same transaction as the order transition.
- Free-product entitlement changes are synchronized with server product and
  ownership changes.
- Free renewals use the server-authoritative renewal period and ignore a
  caller-supplied duration.

## Authorization and account recovery

- Application API permissions fail closed unless the human or key's Access
  Profile explicitly allows the action.
- Access Profile creation and updates cannot grant capabilities above the
  caller's own authority. A profile cannot be deleted while it is assigned to a
  person or API key.
- Only an interactive Owner can assign Access Profiles to people, and
  transactional checks prevent removing or deleting the final active Owner.
- Admin login, API-key issuance, and session issuance require an active account.
- Suspension uses separate, idempotent suspend and unsuspend operations.
- Public suspension approval cannot bypass a required pending approval record.
- Suspension and all password-recovery paths revoke browser sessions, Account
  API keys, and Application API keys.
- Password mutation, reset-token consumption, and credential revocation occur
  in one transaction.
- User deletion is row-locked and rejects unauthorized Owner deletion,
  self-deletion, deletion of the final active Owner, remaining server ownership, and quota
  conflicts.

## Daemon, file, and availability boundaries

- Remote server, transfer, backup, and activity resources are constrained to
  the authenticated node and server.
- State-changing transfer callbacks use POST; unused GET callbacks were
  removed.
- Activity actors are limited to the server owner or a real subuser.
- Activity payloads and URLs are size-limited and recursively redacted both when
  stored and when returned.
- Overwrite-capable file operations require both `file.create` and
  `file.update`; wipe/delete behavior also requires `file.delete`.
- Raw and diff writes, upload, pull, extraction, mod download/retry, and modpack
  installation follow those combined permission rules.
- Diff request body, field size, line count, comparison work, response size, and
  request rate are bounded.
- Database, backup, allocation, and subuser quota consumption is serialized or
  collision-safe.
- Multipart backups store the authorized total size and complete only from a
  bounded provider `ListParts` result whose part set and byte total exactly
  match that size.

## Wings-RS upgrade behavior

The Panel's Wings-RS self-upgrade endpoint is now active-Owner-only. Its request
accepts the binary URL and SHA-256 digest, while download headers and the restart
command come from trusted Panel configuration. The Panel sends every field
required by the daemon and now distinguishes an accepted upgrade from a daemon
response of `applied: false`.

The default restart command matches the generated systemd unit:
`systemctl restart wings`. OpenRC nodes require
`WINGS_RS_RESTART_COMMAND=rc-service` and
`WINGS_RS_RESTART_ARGS=wings,restart`. A Panel managing nodes with mixed init
systems should not expose self-upgrade until restart configuration is available
per node.

No Wings-RS source is changed by this PR.

## Remaining daemon-side requirement: M12-SEC-017

M12-SEC-017 is not a request for unspecified “deployment evidence.” It concerns
the security of daemon-initiated remote file downloads.

The reviewed Wings-RS source already performs DNS/literal-address filtering and
limits concurrent pulls per server. It still needs daemon-side changes before
the file-pull path can be considered fully hardened:

- ignore system proxy settings for remote pulls;
- reject every non-public destination after each DNS resolution;
- apply the same destination checks after redirects;
- limit redirect count;
- enforce connection and total-operation timeouts;
- bound the downloaded response body.

Those controls belong in Wings-RS, not the Panel, and this repository does not
own or modify that project. The Panel-side file permissions and request limits
in this PR reduce exposure but do not replace the missing outbound-network
controls.

## Finding-by-finding result

| Finding | What changed and what it means |
| --- | --- |
| M12-SEC-001 | Checkout data is persisted and signed before provider creation; amount, currency, customer, product, and retry identity cannot be substituted later. |
| M12-SEC-002 | PayPal creation and fulfillment use the same immutable server-side order snapshot instead of later browser input. |
| M12-SEC-003 | PayPal redirects and webhooks can repeat safely without renewing or charging the same order twice. |
| M12-SEC-004 | Provisioning is atomically claimed, stale captured work is recoverable, and verified provider evidence is retained for reconciliation. |
| M12-SEC-005 | Humans and Application API keys now authorize through one canonical Access Profile capability registry. Each key has its own API-eligible profile, delegation cannot exceed the caller, and old resource masks are migrated without broadening access. |
| M12-SEC-006 | A daemon credential can access only resources belonging to its authenticated node/server; activity actors are also server-scoped. |
| M12-SEC-007 | Secrets in activity metadata and URLs are recursively redacted at write and response boundaries. |
| M12-SEC-008 | Suspend and unsuspend are separate retry-safe actions, and suspension revokes every session and API credential. |
| M12-SEC-009 | Every password-recovery path transactionally revokes sessions plus Account and Application API keys. |
| M12-SEC-010 | User deletion protects Owners, self-deletion, the final active Owner, owned servers, and quota invariants under row locks. Access Profile reassignment has the same final-Owner protection. |
| M12-SEC-011 | Coupon/free-product reservations and entitlement changes are atomic with order, product, plan, and owner transitions. |
| M12-SEC-012 | Operations that may overwrite a path require create and update permission; destructive wipes also require delete permission. |
| M12-SEC-013 | File-diff input and computational work are limited before the expensive comparison and response transformation. |
| M12-SEC-014 | Multipart completion trusts a bounded provider part listing and requires its exact bytes to match the authorized backup size. |
| M12-SEC-015 | Database, backup, allocation, and subuser quotas use locks or unique conflicts so parallel requests cannot oversubscribe them. |
| M12-SEC-016 | Checkout secrets and console history are memory-only and cleared on logout and other sensitive lifecycle paths. |
| M12-SEC-017 | Panel-side permissions and limits are improved, but the specific outbound file-pull protections listed above still require a Wings-RS change. |
| M12-SEC-018 | Panel-initiated Wings-RS executable upgrades require an active interactive Owner, trusted server-side restart configuration, a matching SHA-256 digest, and an explicit daemon acceptance response. Application API keys cannot perform this operation. |
| M12-SEC-019 | Immediate uncharged plan changes were replaced: higher-priced plans require a prorated payment now; equal/lower-priced plans are scheduled at renewal with no immediate resources or refund. |
| M12-SEC-020 | Free-renewal duration is selected by the server's product configuration, not by the browser request. |

## Compatibility notes

- Third-party checkout clients must send a UUID `checkout_nonce`, reuse it only
  when retrying the same logical checkout, and generate a new UUID for a new
  purchase. The bundled frontend already does this.
- Create-only subusers can no longer invoke a daemon operation that may
  overwrite an existing path. Grant `file.update` when replacement is intended.
- Daemons must use POST transfer success/failure callbacks.
- Delegated administrators and API keys with `nodes.update` can no longer initiate a
  Wings-RS executable replacement.
- Clients creating Application API keys should send `access_profile_id`.
  `admin_role_id` is accepted as a temporary alias, but the historical
  `permissions` payload cannot be combined with either field.
- Plan changes cannot also change billing cycle, use a coupon, or proceed while
  a renewal, paid plan change, or scheduled plan change conflicts.

## Database migrations

This branch adds:

1. `2026_07_26_000001_harden_payment_fulfillment.php`
2. `2026_07_26_000002_create_paypal_webhook_events_table.php`
3. `2026_07_26_000003_add_atomic_billing_reservations.php`
4. `2026_07_28_000001_add_expected_size_to_backups.php`
5. `2026_07_28_000002_correlate_paypal_webhook_events.php`
6. `2026_07_29_000001_mark_scoped_api_keys.php`
7. `2026_07_29_000002_add_scheduled_plan_changes.php`
8. `2026_07_29_000003_create_owner_access_profile.php`
9. `2026_07_29_000004_bind_application_keys_to_access_profiles.php`

## Verification performed

- Focused unit and isolated SQLite integration tests cover checkout locking,
  amount/currency integrity, retry idempotency, reservation release, fulfillment
  claims, proration beyond one cycle, the renewal safety window, scheduled
  apply/cancel behavior, API-key Access Profile delegation, and legacy-key
  migration.
- PHP static analysis and formatting checks pass for the changed backend.
- Frontend type checking, linting, and build pass.
- The Wings-RS checkout remains unchanged.
