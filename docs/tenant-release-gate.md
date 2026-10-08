# Tenant isolation release gate (#54, stacked #55)

**HOLD merge/deploy until independent review and owner sign-off.** Passing seeded
local/CI tests is not evidence about production data or migration lock duration.
No production credentials, customer dump or provider access is needed to develop
these fixes. Mobile publishing workflow and `apps/mobile/eas.json` are out of scope.

## Sanitized-restore rehearsal (owner-operated, isolated staging only)

1. An authorized operator creates a consistent backup at the previous migration
   version. Sanitize names, message bodies, addresses, tokens, device identifiers,
   integration secrets and files before transferring it. Retain relational IDs,
   tenant membership, row counts, duplicate distribution and index sizes. Never
   copy plaintext integration settings or encryption keys. Document sanitization
   coverage and any changes to cardinality; synthetic CI fixtures are not a restore.
2. Restore into a disposable PostgreSQL environment matching production major
   version, capacity and schema. Deny internet egress, disable jobs/webhooks and
   external providers. Record source schema revision and backup/restore verification
   (counts/checksums of sanitized artifact, not customer data). Use a separate local
   URL; never export a production URL to the test environment.
3. Run `psql "$REHEARSAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f docs/tenant-release-preflight.sql`.
   Require zero integrity violations. Investigate and repair only under owner
   authorization, then repeat the restore and gate. Multiple organizations plus
   staged attachments need explicit disposition; do not silently assign them.
   Also inventory duplicate channel routing keys (WhatsApp phone IDs, widget/app
   keys, email addresses) and ensure each routes to exactly one organization.
4. Apply the exact migration SQL from `20261008120000_tenant_isolation` with
   `psql`, `ON_ERROR_STOP=1`, `\timing on`, a rehearsal-approved `lock_timeout`
   and `statement_timeout`. Measure total time and each ALTER/UPDATE/index step.
   In a second session sample `pg_stat_activity` and `pg_locks`, recording blocked
   sessions and their wait durations. Repeat with representative concurrent reads
   and writes. Fail the gate if any timeout, deadlock, unavailable route or lock
   duration exceeds the owner's maintenance-window budget. Prisma migrate deploy
   does not provide a substitute for this measured exercise; ensure migration
   history is consistent in a separate fresh restore using migrate deploy.
5. Verify post-migration: every linked attachment has its conversation org; only
   approved multi-org staged uploads remain unowned; identities match their
   contacts' org; the `(orgId, kind, value)` unique index exists; no duplicate keys.
   Re-run integrity SQL, tenant isolation and HTTP suites. Test same-tenant owners,
   cross-tenant owners, platform fallback, absent/foreign inboxes, and sandbox
   zero-egress behavior. Record exact tested commit and commands.
6. Restore the backup again into a SECOND empty database and exercise the rollback
   below. Record duration, restored counts and a successful prior-version boot.

## Production preflight (not executed by this change)

Owner must supply a current verified backup and restore rehearsal, approved
maintenance window, deployment SHA and previous image, integrity counts, measured
lock/wait durations and timeout budgets, queued-job inventory, and a rollback
owner. Pause incoming traffic and background workers during the migration if the
rehearsal requires it. Re-run read-only integrity counts on the actual source
immediately before the maintenance window. Do not infer all rows belong to
`org_swiftee` just because older code assumed that.

## Rollback

Before writes resume: stop the new app/workers, restore the verified pre-migration
backup to a fresh database, validate counts and ownership, point the **prior**
application image at it and resume only after smoke tests. Keep the failed database
for authorized investigation. Restoring loses post-backup writes; the maintenance
plan must prevent or explicitly reconcile them. Do not casually DROP new columns
or recreate the global identity unique index: different tenants may now share
identity values, so an in-place down migration can fail or destroy isolation.
Do not mark a failed Prisma migration resolved without investigating partial DDL
and rehearsing the recovery. If new writes have occurred, stop and use an
owner-approved forward fix/data reconciliation instead of assuming backup restore
is lossless.

## Evidence record (fill only with observed results)

- Sanitized restore provenance/revision/counts: **pending owner**
- Integrity violations and staged-upload disposition: **pending owner**
- Representative migration runtime / longest blocking wait: **pending owner**
- Backup restoration runtime and previous-image smoke test: **pending owner**
- Production preflight / release approval: **not performed; HOLD**

Local seeded checks and offline regressions demonstrate code behavior only. They
must not be relabelled as production migration approval.
