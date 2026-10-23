const crypto = require("crypto");
const USER_ID_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const path = require("path");
const Database = require("better-sqlite3");
const { Pool } = require("pg");
const { postgresConnectionOptions } = require("../services/postgres-connection-options");

const sqlitePath = process.env.SQLITE_DB_PATH || path.resolve(__dirname, "..", "data", "hours.db");

const AUTH_DB_REQUIREMENTS = {
  users: [
    "username",
    "password_salt",
    "password_hash",
    "recovery_code_salt",
    "recovery_code_hash",
    "created_at",
    "updated_at",
  ],
  sessions: [
    "token",
    "username",
    "expires_at_ms",
    "created_at",
    "updated_at",
  ],
};

const USER_DB_REQUIREMENTS = {
  clients: [
    "id",
    "company_name",
    "contact_name",
    "email",
    "phone",
    "address",
    "notes",
    "company_logo",
    "archived_at",
    "created_at",
  ],
  work_entries: [
    "client_id",
    "work_date",
    "day_type",
    "arrival_time",
    "departure_time",
    "lunch_break_minutes",
    "worked_minutes",
    "comment_text",
    "created_at",
    "updated_at",
  ],
  pay_period_salaries: [
    "client_id",
    "pay_period_month",
    "salary_amount_cents",
    "created_at",
    "updated_at",
  ],
  settings: [
    "key",
    "value",
    "updated_at",
  ],
};

function createSqliteConnection() {
  return new Database(sqlitePath, { readonly: true });
}

function createPgPool() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  return new Pool(postgresConnectionOptions(databaseUrl));
}

function getUserDbPath(username) {
  const usernameHash = crypto.createHash("sha256").update(username).digest("hex");
  return path.resolve(path.dirname(sqlitePath), "users", `${usernameHash}.db`);
}

function getTableColumns(database, tableName) {
  return database.prepare(`PRAGMA table_info(${tableName})`).all().map((column) => column.name);
}

function assertRequiredColumns(database, tableName, expectedColumns, databaseLabel) {
  const availableColumns = getTableColumns(database, tableName);
  if (availableColumns.length === 0) {
    throw new Error(`Missing required table "${tableName}" in ${databaseLabel}.`);
  }

  const missingColumns = expectedColumns.filter((column) => !availableColumns.includes(column));
  if (missingColumns.length > 0) {
    throw new Error(
      `Missing required columns in ${databaseLabel}.${tableName}: ${missingColumns.join(", ")}`
    );
  }
}

function validateAuthDatabase(database) {
  for (const [tableName, expectedColumns] of Object.entries(AUTH_DB_REQUIREMENTS)) {
    assertRequiredColumns(database, tableName, expectedColumns, "auth SQLite DB");
  }
}

function validateUserDatabase(database, username) {
  for (const [tableName, expectedColumns] of Object.entries(USER_DB_REQUIREMENTS)) {
    assertRequiredColumns(database, tableName, expectedColumns, `user SQLite DB (${username})`);
  }
}

async function ensurePgSchema() {
  const pool = createPgPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id BIGSERIAL PRIMARY KEY,
        user_id UUID NOT NULL DEFAULT gen_random_uuid(),
        username TEXT NOT NULL UNIQUE,
        password_salt TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        recovery_code_salt TEXT,
        recovery_code_hash TEXT,
        recovery_code_expires_at_ms BIGINT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT users_user_id_unique UNIQUE (user_id)
      )
    `);
    await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS recovery_code_expires_at_ms BIGINT");
    await client.query("LOCK TABLE users IN ACCESS EXCLUSIVE MODE");
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS user_id UUID`);
        await client.query("DO $$\nBEGIN\n  IF NOT EXISTS (\n    SELECT 1 FROM pg_catalog.pg_attribute\n    WHERE attrelid = 'users'::regclass AND attname = 'user_id'\n      AND atttypid = 'pg_catalog.uuid'::regtype AND NOT attisdropped\n  ) THEN\n    RAISE EXCEPTION 'M02 identity preflight failed: users.user_id must have PostgreSQL type UUID';\n  END IF;\nEND;\n$$;");
    await client.query(`UPDATE users SET user_id = gen_random_uuid() WHERE user_id IS NULL`);
    await client.query(`ALTER TABLE users ALTER COLUMN user_id SET DEFAULT gen_random_uuid()`);
    await client.query(`ALTER TABLE users ALTER COLUMN user_id SET NOT NULL`);
    await client.query(`
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
      $$
    `);
    await client.query(`
      CREATE OR REPLACE FUNCTION hours_m02_reject_user_id_update() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
          RAISE EXCEPTION 'users.user_id is immutable' USING ERRCODE = '22000';
        END IF;
        RETURN NEW;
      END;
      $$
    `);
    await client.query(`DROP TRIGGER IF EXISTS users_user_id_immutable ON users`);
    await client.query(`
      CREATE TRIGGER users_user_id_immutable
      BEFORE UPDATE OF user_id ON users
      FOR EACH ROW EXECUTE FUNCTION hours_m02_reject_user_id_update()
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        username TEXT NOT NULL REFERENCES users (username) ON DELETE CASCADE,
        expires_at_ms BIGINT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_sessions_username
        ON sessions (username)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_sessions_expires_at_ms
        ON sessions (expires_at_ms)
    `);
    await client.query(`
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
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_clients_username_company_name
        ON clients (username, company_name)
    `);
    await client.query(`
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
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_work_entries_username_client_date
        ON work_entries (username, client_id, work_date)
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS pay_period_salaries (
        id BIGSERIAL PRIMARY KEY,
        username TEXT NOT NULL REFERENCES users (username) ON DELETE CASCADE,
        client_id BIGINT NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
        pay_period_month TEXT NOT NULL,
        salary_amount_cents INTEGER NOT NULL CHECK (salary_amount_cents >= 0),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (username, client_id, pay_period_month)
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_pay_period_salaries_username_client_month
        ON pay_period_salaries (username, client_id, pay_period_month)
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS settings (
        username TEXT NOT NULL REFERENCES users (username) ON DELETE CASCADE,
        key TEXT NOT NULL,
        value JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (username, key)
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_settings_username
        ON settings (username)
    `);
    await client.query(`CREATE TABLE IF NOT EXISTS mobile_auth_tokens (token_hash TEXT PRIMARY KEY, username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE, expires_at_ms BIGINT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), last_used_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ)`);
    await client.query(`CREATE TABLE IF NOT EXISTS work_timers (username TEXT PRIMARY KEY REFERENCES users(username) ON DELETE CASCADE, version INTEGER NOT NULL, state_json TEXT NOT NULL)`);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

function readSourceUsers(sqlite) {
  validateAuthDatabase(sqlite);
  const columns = getTableColumns(sqlite, "users");
  const hasUserId = columns.includes("user_id");
  const hasExpiry = columns.includes("recovery_code_expires_at_ms");
  if (!hasUserId) {
    const protection = sqlite.prepare("SELECT 1 FROM sqlite_schema WHERE name IN ('hours_user_identity_schema','users_user_id_unique_idx','users_user_id_insert_guard','users_user_id_update_guard','users_user_id_immutable','users_user_id_replace_guard') LIMIT 1").get();
    if (protection) throw new Error("Migration stopped: user_id is unexpectedly absent from an M02 source.");
  }
  const users = sqlite.prepare(
    "SELECT " + (hasUserId ? "user_id, " : "") +
    (hasExpiry ? "recovery_code_expires_at_ms, " : "NULL AS recovery_code_expires_at_ms, ") +
    "username,password_salt,password_hash,recovery_code_salt,recovery_code_hash,created_at,updated_at FROM users ORDER BY id ASC"
  ).all();
  const seen = new Set();
  return users.map(user => {
    if (hasUserId && (user.user_id === null || user.user_id === undefined)) {
      throw new Error("Migration stopped: missing user_id in an M02 source; resume its SQLite migration before importing.");
    }
    if (hasUserId && (typeof user.user_id !== "string" || user.user_id.length !== 36 || !USER_ID_UUID_PATTERN.test(user.user_id))) {
      throw new Error("Migration stopped: source account has a malformed user_id.");
    }
    const id = hasUserId ? user.user_id : crypto.randomUUID();
    const key = id.toLowerCase();
    if (seen.has(key)) throw new Error("Migration stopped: conflicting source UUIDs (case insensitive).");
    seen.add(key);
    if (user.recovery_code_expires_at_ms !== null && !Number.isSafeInteger(user.recovery_code_expires_at_ms)) {
      throw new Error("Migration stopped: invalid recovery-code expiration; no account imported.");
    }
    return { ...user, user_id: id };
  });
}

async function migrateUsers(sqlite, pool, users = readSourceUsers(sqlite)) {
  for (const user of users) {
    await pool.query(
      "INSERT INTO users (user_id, username, password_salt, password_hash, recovery_code_salt, recovery_code_hash, created_at, updated_at, recovery_code_expires_at_ms) " +
      "VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7::timestamptz,NOW()),COALESCE($8::timestamptz,NOW()),$9)",
      [
        user.user_id, user.username, user.password_salt, user.password_hash,
        user.recovery_code_salt, user.recovery_code_hash, user.created_at, user.updated_at,
        user.recovery_code_expires_at_ms,
      ]
    );
  }
  return users;
}

async function migrateSessions(sqlite, pool) {
  validateAuthDatabase(sqlite);

  const sessions = sqlite.prepare(`
    SELECT token, username, expires_at_ms, created_at, updated_at
    FROM sessions
    ORDER BY created_at ASC, token ASC
  `).all();

  for (const session of sessions) {
    await pool.query(
      `
        INSERT INTO sessions (
          token, username, expires_at_ms, created_at, updated_at
        )
        VALUES ($1, $2, $3, COALESCE($4::timestamptz, NOW()), COALESCE($5::timestamptz, NOW()))
      `,
      [
        session.token,
        session.username,
        session.expires_at_ms,
        session.created_at,
        session.updated_at,
      ]
    );
  }

  return sessions.length;
}

async function migrateMobileAuthTokens(sqlite, pool) {
  if (!getTableColumns(sqlite, "mobile_auth_tokens").length) return 0;
  const rows = sqlite.prepare("SELECT token_hash, username, expires_at_ms, created_at, last_used_at, revoked_at FROM mobile_auth_tokens ORDER BY token_hash ASC").all();
  for (const row of rows) {
    await pool.query(
      "INSERT INTO mobile_auth_tokens (token_hash, username, expires_at_ms, created_at, last_used_at, revoked_at) VALUES ($1, $2, $3, COALESCE($4::timestamptz, NOW()), $5::timestamptz, $6::timestamptz)",
      [row.token_hash, row.username, row.expires_at_ms, row.created_at, row.last_used_at || null, row.revoked_at || null]
    );
  }
  return rows.length;
}

async function migrateWorkTimers(sqlite, pool, clientMapsByUsername) {
  if (!getTableColumns(sqlite, "work_timers").length) return 0;
  const rows = sqlite.prepare("SELECT username, version, state_json FROM work_timers ORDER BY username ASC").all();
  for (const row of rows) {
    let state;
    try { state = JSON.parse(row.state_json); } catch (_) { throw new Error("Migration stopped: invalid stored timer state."); }
    if (state && state.clientId !== undefined && state.clientId !== null && String(state.clientId) !== "") {
      const mappedId = clientMapsByUsername.get(row.username)?.get(String(state.clientId));
      if (!mappedId) throw new Error("Migration stopped: a timer references a client that was not migrated.");
      state.clientId = String(mappedId);
    }
    await pool.query("INSERT INTO work_timers (username, version, state_json) VALUES ($1, $2, $3)", [row.username, row.version, JSON.stringify(state)]);
  }
  return rows.length;
}

async function migrateUserDatabase(pool, username, sourceKey) {
  const userDb = new Database(getUserDbPath(username), { readonly: true });
  try {
    validateUserDatabase(userDb, username);

    const clients = userDb.prepare(`
      SELECT id, company_name, contact_name, email, phone, address, notes, company_logo, archived_at, created_at
      FROM clients
      ORDER BY id ASC
    `).all();

    const clientIdMap = new Map();

    for (const client of clients) {
      const inserted = await pool.query(
        `
          INSERT INTO clients (
            username, company_name, contact_name, email, phone, address, notes, company_logo, archived_at, created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, COALESCE($10::timestamptz, NOW()))
          RETURNING id
        `,
        [
          username,
          client.company_name,
          client.contact_name,
          client.email,
          client.phone,
          client.address,
          client.notes,
          client.company_logo || "",
          client.archived_at || null,
          client.created_at || null,
        ]
      );
      clientIdMap.set(client.id, Number(inserted.rows[0].id));
      await pool.query("INSERT INTO hours_sqlite_client_id_map (source_key, username, source_client_id, target_client_id) VALUES ($1, $2, $3, $4)", [sourceKey, username, String(client.id), Number(inserted.rows[0].id)]);
    }

    const workEntries = userDb.prepare(`
      SELECT client_id, work_date, day_type, arrival_time, departure_time, lunch_break_minutes,
             worked_minutes, comment_text, created_at, updated_at
      FROM work_entries
      ORDER BY id ASC
    `).all();

    for (const entry of workEntries) {
      await pool.query(
        `
          INSERT INTO work_entries (
            username, client_id, work_date, day_type, arrival_time, departure_time,
            lunch_break_minutes, worked_minutes, comment_text, created_at, updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10::timestamptz, NOW()), COALESCE($11::timestamptz, NOW()))
          ON CONFLICT (username, client_id, work_date) DO UPDATE SET
            day_type = EXCLUDED.day_type,
            arrival_time = EXCLUDED.arrival_time,
            departure_time = EXCLUDED.departure_time,
            lunch_break_minutes = EXCLUDED.lunch_break_minutes,
            worked_minutes = EXCLUDED.worked_minutes,
            comment_text = EXCLUDED.comment_text,
            updated_at = EXCLUDED.updated_at
        `,
        [
          username,
          clientIdMap.get(entry.client_id),
          entry.work_date,
          entry.day_type,
          entry.arrival_time,
          entry.departure_time,
          entry.lunch_break_minutes,
          entry.worked_minutes,
          entry.comment_text,
          entry.created_at || null,
          entry.updated_at || null,
        ]
      );
    }

    const salaries = userDb.prepare(`
      SELECT client_id, pay_period_month, salary_amount_cents, created_at, updated_at
      FROM pay_period_salaries
      ORDER BY id ASC
    `).all();

    for (const salary of salaries) {
      await pool.query(
        `
          INSERT INTO pay_period_salaries (
            username, client_id, pay_period_month, salary_amount_cents, created_at, updated_at
          )
          VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, NOW()), COALESCE($6::timestamptz, NOW()))
          ON CONFLICT (username, client_id, pay_period_month) DO UPDATE SET
            salary_amount_cents = EXCLUDED.salary_amount_cents,
            updated_at = EXCLUDED.updated_at
        `,
        [
          username,
          clientIdMap.get(salary.client_id),
          salary.pay_period_month,
          salary.salary_amount_cents,
          salary.created_at || null,
          salary.updated_at || null,
        ]
      );
    }

    const settingsEntries = userDb.prepare(`
      SELECT key, value, updated_at
      FROM settings
      ORDER BY key ASC
    `).all();

    for (const setting of settingsEntries) {
      await pool.query(
        `
          INSERT INTO settings (
            username, key, value, updated_at
          )
          VALUES ($1, $2, $3::jsonb, COALESCE($4::timestamptz, NOW()))
          ON CONFLICT (username, key) DO UPDATE SET
            value = EXCLUDED.value,
            updated_at = EXCLUDED.updated_at
        `,
        [
          username,
          setting.key,
          setting.value,
          setting.updated_at || null,
        ]
      );
    }

    return {
      clients: clients.length,
      workEntries: workEntries.length,
      salaries: salaries.length,
      settings: settingsEntries.length,
      clientIdMap: new Map([...clientIdMap].map(([sourceId, targetId]) => [String(sourceId), targetId])),
    };
  } finally {
    userDb.close();
  }
}

async function runMigration({ sqlite, pool, sourceIdentity, onStage } = {}) {
  const source = sourceIdentity || process.env.MIGRATION_SOURCE_ID || path.resolve(sqlitePath);
  const sourceKey = crypto.createHash("sha256").update(String(source)).digest("hex");
  const connection = await pool.connect();
  try {
    await connection.query("BEGIN");
    await connection.query("SELECT pg_advisory_xact_lock(hashtext($1))", [sourceKey]);
    await connection.query("CREATE TABLE IF NOT EXISTS hours_sqlite_migration_runs (source_key TEXT PRIMARY KEY, completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), migrated_users INTEGER NOT NULL, migrated_sessions INTEGER NOT NULL)");
    await connection.query("CREATE TABLE IF NOT EXISTS hours_sqlite_client_id_map (source_key TEXT NOT NULL, username TEXT NOT NULL, source_client_id TEXT NOT NULL, target_client_id BIGINT NOT NULL REFERENCES clients(id), PRIMARY KEY (source_key, username, source_client_id))");
    const priorRun = await connection.query("SELECT source_key FROM hours_sqlite_migration_runs WHERE source_key = $1", [sourceKey]);
    if (priorRun.rowCount) {
      await connection.query("COMMIT");
      return { alreadyMigrated: true };
    }
    validateAuthDatabase(sqlite);
    const users = readSourceUsers(sqlite);
    const usernames = users.map((user) => user.username);
    if (usernames.length) {
      const existing = await connection.query("SELECT count(*)::int AS count FROM users WHERE username = ANY($1::text[]) OR user_id = ANY($2::uuid[])", [usernames, users.map(user => user.user_id)]);
      if (Number(existing.rows[0].count) > 0) throw new Error("Migration stopped: one or more source accounts already exist in PostgreSQL or their UUIDs conflict without a matching migration record.");
    }
    if (onStage) await onStage("before-import");
    const migratedUsers = await migrateUsers(sqlite, connection, users);
    const migratedSessions = await migrateSessions(sqlite, connection);
    const migratedMobileTokens = await migrateMobileAuthTokens(sqlite, connection);
    const clientMapsByUsername = new Map();
    const totals = { clients: 0, workEntries: 0, salaries: 0, settings: 0 };
    for (const user of migratedUsers) {
      const stats = await migrateUserDatabase(connection, user.username, sourceKey);
      clientMapsByUsername.set(user.username, stats.clientIdMap);
      for (const key of Object.keys(totals)) totals[key] += stats[key];
    }
    const migratedWorkTimers = await migrateWorkTimers(sqlite, connection, clientMapsByUsername);
    if (onStage) await onStage("before-commit");
    await connection.query("INSERT INTO hours_sqlite_migration_runs (source_key, migrated_users, migrated_sessions) VALUES ($1, $2, $3)", [sourceKey, migratedUsers.length, migratedSessions]);
    await connection.query("COMMIT");
    return { alreadyMigrated: false, migratedUsers: migratedUsers.length, migratedSessions, migratedMobileTokens, migratedWorkTimers, ...totals };
  } catch (error) {
    try { await connection.query("ROLLBACK"); } catch (_) { /* connection may already be closed */ }
    throw error;
  } finally {
    connection.release();
  }
}

async function run() {
  const sqlite = createSqliteConnection();
  const pool = createPgPool();
  try {
    await ensurePgSchema();
    const result = await runMigration({ sqlite, pool });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    sqlite.close();
    await pool.end();
  }
}

module.exports = {
  AUTH_DB_REQUIREMENTS,
  USER_DB_REQUIREMENTS,
  createPgPool,
  runMigration,
  ensurePgSchema,
  getUserDbPath,
  validateAuthDatabase,
  validateUserDatabase,
};

if (require.main === module) {
  run()
    .catch(async (error) => {
      const safeMessage = String(error && error.message || "Unknown migration failure.").replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, "postgresql://***@").replace(/(password\s*[=:]\s*)[^\s,;]+/gi, "$1***");
      console.error(`Migration failed: ${safeMessage}`);
      process.exit(1);
    });
}
