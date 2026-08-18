-- PostgreSQL reference schema for App_Hours.
-- SQLite uses two storage layers at runtime:
--   1. auth DB: users + sessions
--   2. one user DB per username: clients + work_entries + pay_period_salaries + settings
-- This file intentionally documents the centralized PostgreSQL model only.

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  recovery_code_salt TEXT,
  recovery_code_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_username
  ON users (username);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  username TEXT NOT NULL REFERENCES users (username) ON DELETE CASCADE,
  expires_at_ms BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_username
  ON sessions (username);

CREATE INDEX IF NOT EXISTS idx_sessions_expires_at_ms
  ON sessions (expires_at_ms);

CREATE TABLE IF NOT EXISTS clients (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL REFERENCES users (username) ON DELETE CASCADE,
  company_name TEXT NOT NULL,
  contact_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  company_logo TEXT NOT NULL DEFAULT '',
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clients_username_company_name
  ON clients (username, company_name);

CREATE TABLE IF NOT EXISTS work_entries (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL REFERENCES users (username) ON DELETE CASCADE,
  client_id BIGINT NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  work_date DATE NOT NULL,
  day_type TEXT NOT NULL DEFAULT 'office',
  arrival_time TEXT NOT NULL,
  departure_time TEXT NOT NULL,
  lunch_break_minutes INTEGER NOT NULL CHECK (lunch_break_minutes >= 0),
  worked_minutes INTEGER NOT NULL CHECK (worked_minutes >= 0),
  comment_text TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (username, client_id, work_date)
);

CREATE INDEX IF NOT EXISTS idx_work_entries_username_client_date
  ON work_entries (username, client_id, work_date);

CREATE TABLE IF NOT EXISTS pay_period_salaries (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL REFERENCES users (username) ON DELETE CASCADE,
  client_id BIGINT NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  pay_period_month TEXT NOT NULL,
  salary_amount_cents INTEGER NOT NULL CHECK (salary_amount_cents >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (username, client_id, pay_period_month)
);

CREATE INDEX IF NOT EXISTS idx_pay_period_salaries_username_client_month
  ON pay_period_salaries (username, client_id, pay_period_month);

CREATE TABLE IF NOT EXISTS settings (
  username TEXT NOT NULL REFERENCES users (username) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (username, key)
);

CREATE INDEX IF NOT EXISTS idx_settings_username
  ON settings (username);
