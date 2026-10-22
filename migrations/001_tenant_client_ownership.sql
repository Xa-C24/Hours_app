-- M01: require each work entry and pay-period salary to reference a client
-- owned by the same username. Run only after review in an isolated/staging DB.
-- The transaction aborts on any existing orphan or cross-owner relationship;
-- it never repairs or deletes application data.
BEGIN;

LOCK TABLE clients, work_entries, pay_period_salaries IN SHARE ROW EXCLUSIVE MODE;

DO $m01_preflight$
DECLARE
  invalid_work_entries BIGINT;
  invalid_salaries BIGINT;
BEGIN
  SELECT COUNT(*) INTO invalid_work_entries
  FROM work_entries AS entry
  LEFT JOIN clients AS client ON client.id = entry.client_id
  WHERE client.id IS NULL OR client.username <> entry.username;

  SELECT COUNT(*) INTO invalid_salaries
  FROM pay_period_salaries AS salary
  LEFT JOIN clients AS client ON client.id = salary.client_id
  WHERE client.id IS NULL OR client.username <> salary.username;

  IF invalid_work_entries > 0 OR invalid_salaries > 0 THEN
    RAISE EXCEPTION
      'M01 ownership preflight failed (work_entries=%, pay_period_salaries=%); no rows were changed',
      invalid_work_entries, invalid_salaries;
  END IF;
END
$m01_preflight$;

DO $m01_client_key$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'clients'::regclass
      AND conname = 'clients_username_id_unique'
      AND contype = 'u'
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_username_id_unique
      ON clients (username, id);
  END IF;
END
$m01_client_key$;

DO $m01_constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'work_entries'::regclass
      AND conname = 'work_entries_owner_client_fk'
  ) THEN
    ALTER TABLE work_entries
      ADD CONSTRAINT work_entries_owner_client_fk
      FOREIGN KEY (username, client_id)
      REFERENCES clients (username, id) ON DELETE CASCADE NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'pay_period_salaries'::regclass
      AND conname = 'pay_period_salaries_owner_client_fk'
  ) THEN
    ALTER TABLE pay_period_salaries
      ADD CONSTRAINT pay_period_salaries_owner_client_fk
      FOREIGN KEY (username, client_id)
      REFERENCES clients (username, id) ON DELETE CASCADE NOT VALID;
  END IF;
END
$m01_constraints$;

ALTER TABLE work_entries VALIDATE CONSTRAINT work_entries_owner_client_fk;
ALTER TABLE pay_period_salaries VALIDATE CONSTRAINT pay_period_salaries_owner_client_fk;

COMMIT;
