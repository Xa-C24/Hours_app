-- M01 rollback: removes only the ownership constraints and their supporting
-- index. It does not change or delete application rows.
BEGIN;

ALTER TABLE IF EXISTS work_entries
  DROP CONSTRAINT IF EXISTS work_entries_owner_client_fk;
ALTER TABLE IF EXISTS pay_period_salaries
  DROP CONSTRAINT IF EXISTS pay_period_salaries_owner_client_fk;
DROP INDEX IF EXISTS idx_clients_username_id_unique;

COMMIT;
