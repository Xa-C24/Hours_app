-- M02 phase 1: add an independent, write-once account UUID.
-- PostgreSQL 13+ provides gen_random_uuid() in core.
BEGIN;

LOCK TABLE users IN ACCESS EXCLUSIVE MODE;

ALTER TABLE users ADD COLUMN IF NOT EXISTS user_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'users'::regclass AND attname = 'user_id'
      AND atttypid = 'pg_catalog.uuid'::regtype AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'M02 identity preflight failed: users.user_id must have PostgreSQL type UUID';
  END IF;
END;
$$;

-- Preserve every existing value; only incomplete earlier attempts are filled.
UPDATE users
SET user_id = gen_random_uuid()
WHERE user_id IS NULL;

ALTER TABLE users ALTER COLUMN user_id SET DEFAULT gen_random_uuid();
ALTER TABLE users ALTER COLUMN user_id SET NOT NULL;

DO $$
DECLARE existing_definition TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO existing_definition
  FROM pg_constraint
  WHERE conrelid = 'users'::regclass AND conname = 'users_user_id_unique';
  IF existing_definition IS NULL THEN
    ALTER TABLE users ADD CONSTRAINT users_user_id_unique UNIQUE (user_id);
  ELSIF existing_definition <> 'UNIQUE (user_id)' THEN
    RAISE EXCEPTION 'users_user_id_unique has an unexpected definition';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION hours_m02_reject_user_id_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'users.user_id is immutable' USING ERRCODE = '22000';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_user_id_immutable ON users;
CREATE TRIGGER users_user_id_immutable
BEFORE UPDATE OF user_id ON users
FOR EACH ROW EXECUTE FUNCTION hours_m02_reject_user_id_update();

COMMIT;
