const crypto = require("crypto");
const path = require("path");
const Database = require("better-sqlite3");
const { Pool } = require("pg");

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
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const usesLocalhost =
    databaseUrl.includes("localhost") ||
    databaseUrl.includes("127.0.0.1") ||
    databaseUrl.includes("host.docker.internal");
  return new Pool({
    connectionString: databaseUrl,
    ssl: usesLocalhost ? false : { rejectUnauthorized: false },
  });
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
        username TEXT NOT NULL UNIQUE,
        password_salt TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        recovery_code_salt TEXT,
        recovery_code_hash TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
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
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function migrateUsers(sqlite, pool) {
  validateAuthDatabase(sqlite);

  const users = sqlite.prepare(`
    SELECT username, password_salt, password_hash, recovery_code_salt, recovery_code_hash, created_at, updated_at
    FROM users
    ORDER BY id ASC
  `).all();

  for (const user of users) {
    await pool.query(
      `
        INSERT INTO users (
          username, password_salt, password_hash, recovery_code_salt, recovery_code_hash, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, NOW()), COALESCE($7::timestamptz, NOW()))
        ON CONFLICT (username) DO UPDATE SET
          password_salt = EXCLUDED.password_salt,
          password_hash = EXCLUDED.password_hash,
          recovery_code_salt = EXCLUDED.recovery_code_salt,
          recovery_code_hash = EXCLUDED.recovery_code_hash,
          updated_at = EXCLUDED.updated_at
      `,
      [
        user.username,
        user.password_salt,
        user.password_hash,
        user.recovery_code_salt,
        user.recovery_code_hash,
        user.created_at,
        user.updated_at,
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
        ON CONFLICT (token) DO UPDATE SET
          username = EXCLUDED.username,
          expires_at_ms = EXCLUDED.expires_at_ms,
          updated_at = EXCLUDED.updated_at
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

async function migrateUserDatabase(pool, username) {
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
    };
  } finally {
    userDb.close();
  }
}

async function run() {
  const sqlite = createSqliteConnection();
  const pool = createPgPool();
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id BIGSERIAL PRIMARY KEY,
          username TEXT NOT NULL UNIQUE,
          password_salt TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          recovery_code_salt TEXT,
          recovery_code_hash TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
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
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    const users = await migrateUsers(sqlite, pool);
    const sessionCount = await migrateSessions(sqlite, pool);
    const perUserStats = {};

    for (const user of users) {
      perUserStats[user.username] = await migrateUserDatabase(pool, user.username);
    }

    console.log(
      JSON.stringify(
        {
          sqlitePath,
          migratedUsers: users.length,
          migratedSessions: sessionCount,
          perUserStats,
        },
        null,
        2
      )
    );
  } finally {
    sqlite.close();
    await pool.end();
  }
}

module.exports = {
  AUTH_DB_REQUIREMENTS,
  USER_DB_REQUIREMENTS,
  ensurePgSchema,
  getUserDbPath,
  validateAuthDatabase,
  validateUserDatabase,
};

if (require.main === module) {
  run()
    .catch(async (error) => {
      console.error(error);
      process.exit(1);
    });
}
