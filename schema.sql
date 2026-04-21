CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  recovery_code_salt TEXT,
  recovery_code_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_username
  ON users (username);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (username) REFERENCES users (username) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_username
  ON sessions (username);

CREATE INDEX IF NOT EXISTS idx_sessions_expires_at_ms
  ON sessions (expires_at_ms);

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_name TEXT NOT NULL,
  contact_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_clients_company_name
  ON clients (company_name);

CREATE TABLE IF NOT EXISTS work_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL,
  work_date TEXT NOT NULL
    CHECK (work_date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  day_type TEXT NOT NULL DEFAULT 'office',
  arrival_time TEXT NOT NULL
    CHECK (arrival_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  departure_time TEXT NOT NULL
    CHECK (departure_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  lunch_break_minutes INTEGER NOT NULL
    CHECK (lunch_break_minutes >= 0),
  worked_minutes INTEGER NOT NULL
    CHECK (worked_minutes >= 0),
  comment_text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE,
  UNIQUE (client_id, work_date)
);

CREATE INDEX IF NOT EXISTS idx_work_entries_client_date
  ON work_entries (client_id, work_date);

CREATE TABLE IF NOT EXISTS pay_period_salaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL,
  pay_period_month TEXT NOT NULL
    CHECK (pay_period_month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  salary_amount_cents INTEGER NOT NULL
    CHECK (salary_amount_cents >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE,
  UNIQUE (client_id, pay_period_month)
);

CREATE INDEX IF NOT EXISTS idx_pay_period_salaries_client_month
  ON pay_period_salaries (client_id, pay_period_month);
