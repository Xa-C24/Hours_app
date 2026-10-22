# M01 PostgreSQL tenant ownership migration

This migration keeps `username` as the tenant key. It adds composite foreign keys
so a work entry or pay-period salary can reference only a client with the same
username. New PostgreSQL installations get the same constraints from
`schema.sql` and `db-postgres.js`.

## Existing database procedure

Do not run this against production as part of application startup. First run it
on a dedicated staging copy and review the migration result. The migration locks
the affected tables, counts existing orphaned or cross-owner references without
printing row contents, and aborts the transaction if any are found. It never
reassigns or deletes data. Resolve any anomaly only through a separately approved
data-repair procedure.

Apply `migrations/001_tenant_client_ownership.sql` with the project's approved
PostgreSQL migration process. The script is transactional and safe to rerun.
The rollback is `migrations/001_tenant_client_ownership.rollback.sql`; it removes
only the new constraints and supporting index, so it restores the former weaker
integrity guarantee and should be used only as an incident rollback.

## Isolated integration test

The test `test/postgres-tenant-isolation.test.js` never reads `DATABASE_URL`.
To enable it against the dedicated Neon test branch, provide these variables
to the test process without putting their values in tracked files:

- `M01_TEST_DATABASE_URL`: direct (non-pooler) PostgreSQL endpoint for database
  `neondb`, with TLS certificate verification enabled.
- `NEON_API_KEY`: credential used only for read-only Neon API requests. The
  test sends it as an authorization header and never includes it in output.
- `M01_NEON_PROJECT_ID` and `M01_NEON_BRANCH_ID`: identifiers copied from the
  Neon console for the intended project and branch.

The integration test does not treat a hostname copied from the connection URL
as proof of branch identity. Before opening PostgreSQL, it issues GET requests
to the Neon API and verifies that the configured project ID is named
`App_Hours`, the configured branch ID is named `Branch_Test` and belongs to that
project, and the endpoint host from `M01_TEST_DATABASE_URL` is listed for that
branch as its read-write endpoint. Production and backup branches fail the
name/ID checks. API errors fail closed and response bodies or credentials are
not logged.

After endpoint identity is verified, the test checks the current database and
schema and counts rows in the known public application tables. It stops before
writing if any such table contains rows. It then creates uniquely named test
schemas, uses synthetic accounts and rows only, and drops only those schemas.
One isolated schema is built from the complete checked-in `schema.sql` and
downgraded to the prior single-column client references to represent the
pre-M01 public schema; no public table is altered. The integration covers
constraint definitions and validation state, rollback of both tenant foreign
keys and the migration-created supporting index, cross-owner salary and entry
rejection, idempotence, legacy orphan detection, and fresh-schema constraints.

If the URL is absent and no Neon verification settings are supplied, the
PostgreSQL integration test is skipped; that is not evidence of PostgreSQL
validation. If a URL is supplied without the API verification settings, the
test fails before opening PostgreSQL.

The migration does not enable PostgreSQL Row-Level Security. The application
continues to require explicit tenant-scoped queries. RLS needs a separate design
for transaction-local identity and pool safety.
