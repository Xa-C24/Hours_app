CREATE TABLE IF NOT EXISTS work_entries (
  work_date TEXT PRIMARY KEY
    CHECK (work_date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  arrival_time TEXT NOT NULL
    CHECK (arrival_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  departure_time TEXT NOT NULL
    CHECK (departure_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  lunch_break_minutes INTEGER NOT NULL
    CHECK (lunch_break_minutes >= 0 AND lunch_break_minutes <= 480),
  worked_minutes INTEGER NOT NULL
    CHECK (worked_minutes >= 0),
  comment_text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_work_entries_work_date
  ON work_entries (work_date);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_username
  ON users (username);
