const { Pool } = require("pg");

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required for PostgreSQL mode.");
}

const usesLocalhost =
  connectionString.includes("localhost") ||
  connectionString.includes("127.0.0.1") ||
  connectionString.includes("host.docker.internal");

const pool = new Pool({
  connectionString,
  ssl: usesLocalhost ? false : { rejectUnauthorized: false },
});

let initPromise = null;

function nowIsoString() {
  return new Date().toISOString();
}

async function initializeDatabase() {
  if (!initPromise) {
    initPromise = (async () => {
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
          ALTER TABLE clients
          ADD COLUMN IF NOT EXISTS company_logo TEXT NOT NULL DEFAULT ''
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
    })();
  }

  return initPromise;
}

function mapClientRow(row) {
  if (!row) {
    return null;
  }
  return {
    ...row,
    id: Number(row.id),
    archived_at: row.archived_at ? new Date(row.archived_at).toISOString().replace("T", " ").slice(0, 19) : null,
    created_at: row.created_at ? new Date(row.created_at).toISOString().replace("T", " ").slice(0, 19) : "",
  };
}

function mapWorkEntryRow(row) {
  if (!row) {
    return null;
  }
  return {
    ...row,
    id: Number(row.id),
    client_id: Number(row.client_id),
    work_date: row.work_date instanceof Date ? row.work_date.toISOString().slice(0, 10) : String(row.work_date),
  };
}

function normalizeClientPayload(client) {
  return {
    company_name:
      typeof client.company_name === "string" ? client.company_name.trim() : "",
    contact_name:
      typeof client.contact_name === "string" ? client.contact_name.trim() : "",
    email: typeof client.email === "string" ? client.email.trim() : "",
    phone: typeof client.phone === "string" ? client.phone.trim() : "",
    address: typeof client.address === "string" ? client.address.trim() : "",
    notes: typeof client.notes === "string" ? client.notes.trim() : "",
    company_logo:
      typeof client.company_logo === "string" && client.company_logo.trim().startsWith("data:image/")
        ? client.company_logo.trim()
        : "",
  };
}

async function ensureUserDatabase() {
  await initializeDatabase();
}

async function getAllClients(username) {
  await initializeDatabase();
  const result = await pool.query(
    `
      SELECT id, company_name, contact_name, email, phone, address, notes, company_logo, archived_at, created_at
      FROM clients
      WHERE username = $1
        AND archived_at IS NULL
      ORDER BY company_name ASC, id ASC
    `,
    [username]
  );
  return result.rows.map(mapClientRow);
}

async function getArchivedClients(username) {
  await initializeDatabase();
  const result = await pool.query(
    `
      SELECT id, company_name, contact_name, email, phone, address, notes, company_logo, archived_at, created_at
      FROM clients
      WHERE username = $1
        AND archived_at IS NOT NULL
      ORDER BY archived_at DESC, company_name ASC, id ASC
    `,
    [username]
  );
  return result.rows.map(mapClientRow);
}

async function getClientById(username, id) {
  await initializeDatabase();
  const result = await pool.query(
    `
      SELECT id, company_name, contact_name, email, phone, address, notes, company_logo, archived_at, created_at
      FROM clients
      WHERE username = $1
        AND id = $2
    `,
    [username, id]
  );
  return mapClientRow(result.rows[0] || null);
}

async function createClient(username, client) {
  await initializeDatabase();
  const payload = normalizeClientPayload(client);
  const result = await pool.query(
    `
      INSERT INTO clients (
        username,
        company_name,
        contact_name,
        email,
        phone,
        address,
        notes,
        company_logo
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
    `,
    [
      username,
      payload.company_name,
      payload.contact_name,
      payload.email,
      payload.phone,
      payload.address,
      payload.notes,
      payload.company_logo,
    ]
  );
  return getClientById(username, Number(result.rows[0].id));
}

async function updateClient(username, clientId, client) {
  await initializeDatabase();
  const payload = normalizeClientPayload(client);
  await pool.query(
    `
      UPDATE clients
      SET
        company_name = $3,
        contact_name = $4,
        email = $5,
        phone = $6,
        address = $7,
        notes = $8,
        company_logo = $9
      WHERE username = $1
        AND id = $2
    `,
    [
      username,
      clientId,
      payload.company_name,
      payload.contact_name,
      payload.email,
      payload.phone,
      payload.address,
      payload.notes,
      payload.company_logo,
    ]
  );
  return getClientById(username, clientId);
}

async function deleteClient(username, clientId) {
  await initializeDatabase();
  await pool.query(`DELETE FROM clients WHERE username = $1 AND id = $2`, [username, clientId]);
}

async function archiveClient(username, clientId) {
  await initializeDatabase();
  await pool.query(
    `
      UPDATE clients
      SET archived_at = NOW()
      WHERE username = $1
        AND id = $2
        AND archived_at IS NULL
    `,
    [username, clientId]
  );
}

async function restoreClient(username, clientId) {
  await initializeDatabase();
  await pool.query(
    `
      UPDATE clients
      SET archived_at = NULL
      WHERE username = $1
        AND id = $2
        AND archived_at IS NOT NULL
    `,
    [username, clientId]
  );
}

async function getWorkEntriesByClient(username, clientId, startDate = null, endDate = null) {
  await initializeDatabase();
  const result =
    typeof startDate === "string" && typeof endDate === "string"
      ? await pool.query(
          `
            SELECT id, client_id, work_date, day_type, arrival_time, departure_time,
                   lunch_break_minutes, worked_minutes, comment_text
            FROM work_entries
            WHERE username = $1
              AND client_id = $2
              AND work_date >= $3
              AND work_date < $4
            ORDER BY work_date ASC
          `,
          [username, clientId, startDate, endDate]
        )
      : await pool.query(
          `
            SELECT id, client_id, work_date, day_type, arrival_time, departure_time,
                   lunch_break_minutes, worked_minutes, comment_text
            FROM work_entries
            WHERE username = $1
              AND client_id = $2
            ORDER BY work_date ASC
          `,
          [username, clientId]
        );
  return result.rows.map(mapWorkEntryRow);
}

async function getWorkEntryByDate(username, clientId, workDate) {
  await initializeDatabase();
  const result = await pool.query(
    `
      SELECT id, client_id, work_date, day_type, arrival_time, departure_time,
             lunch_break_minutes, worked_minutes, comment_text
      FROM work_entries
      WHERE username = $1
        AND client_id = $2
        AND work_date = $3
    `,
    [username, clientId, workDate]
  );
  return mapWorkEntryRow(result.rows[0] || null);
}

async function upsertWorkEntry(username, entry) {
  await initializeDatabase();
  await pool.query(
    `
      INSERT INTO work_entries (
        username,
        client_id,
        work_date,
        day_type,
        arrival_time,
        departure_time,
        lunch_break_minutes,
        worked_minutes,
        comment_text
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (username, client_id, work_date) DO UPDATE SET
        day_type = EXCLUDED.day_type,
        arrival_time = EXCLUDED.arrival_time,
        departure_time = EXCLUDED.departure_time,
        lunch_break_minutes = EXCLUDED.lunch_break_minutes,
        worked_minutes = EXCLUDED.worked_minutes,
        comment_text = EXCLUDED.comment_text,
        updated_at = NOW()
    `,
    [
      username,
      entry.client_id,
      entry.work_date,
      entry.day_type,
      entry.arrival_time,
      entry.departure_time,
      entry.lunch_break_minutes,
      entry.worked_minutes,
      entry.comment_text,
    ]
  );
}

async function deleteWorkEntry(username, clientId, workDate) {
  await initializeDatabase();
  await pool.query(
    `
      DELETE FROM work_entries
      WHERE username = $1
        AND client_id = $2
        AND work_date = $3
    `,
    [username, clientId, workDate]
  );
}

async function upsertPayPeriodSalary(username, payPeriodSalary) {
  await initializeDatabase();
  await pool.query(
    `
      INSERT INTO pay_period_salaries (
        username,
        client_id,
        pay_period_month,
        salary_amount_cents
      )
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (username, client_id, pay_period_month) DO UPDATE SET
        salary_amount_cents = EXCLUDED.salary_amount_cents,
        updated_at = NOW()
    `,
    [
      username,
      payPeriodSalary.client_id,
      payPeriodSalary.pay_period_month,
      payPeriodSalary.salary_amount_cents,
    ]
  );
}

async function deletePayPeriodSalary(username, clientId, payPeriodMonth) {
  await initializeDatabase();
  await pool.query(
    `
      DELETE FROM pay_period_salaries
      WHERE username = $1
        AND client_id = $2
        AND pay_period_month = $3
    `,
    [username, clientId, payPeriodMonth]
  );
}

async function getPayPeriodSalary(username, clientId, payPeriodMonth) {
  await initializeDatabase();
  const result = await pool.query(
    `
      SELECT salary_amount_cents
      FROM pay_period_salaries
      WHERE username = $1
        AND client_id = $2
        AND pay_period_month = $3
    `,
    [username, clientId, payPeriodMonth]
  );
  return result.rows[0] ? Number(result.rows[0].salary_amount_cents) : null;
}

async function getSettings(username) {
  await initializeDatabase();
  const result = await pool.query(
    `
      SELECT key, value
      FROM settings
      WHERE username = $1
    `,
    [username]
  );
  return Object.fromEntries(result.rows.map((row) => [row.key, row.value]));
}

async function upsertSettings(username, settings) {
  await initializeDatabase();
  const entries = Object.entries(settings);
  for (const [key, value] of entries) {
    await pool.query(
      `
        INSERT INTO settings (
          username,
          key,
          value,
          updated_at
        )
        VALUES ($1, $2, $3::jsonb, NOW())
        ON CONFLICT (username, key) DO UPDATE SET
          value = EXCLUDED.value,
          updated_at = NOW()
      `,
      [username, key, JSON.stringify(value)]
    );
  }
}

async function resetSettings(username) {
  await initializeDatabase();
  await pool.query(`DELETE FROM settings WHERE username = $1`, [username]);
}

async function getUserByUsername(username) {
  await initializeDatabase();
  const result = await pool.query(
    `
      SELECT id, username, password_salt, password_hash, recovery_code_salt, recovery_code_hash
      FROM users
      WHERE username = $1
    `,
    [username]
  );
  return result.rows[0] || null;
}

async function createUser(user) {
  await initializeDatabase();
  await pool.query(
    `
      INSERT INTO users (
        username,
        password_salt,
        password_hash,
        recovery_code_salt,
        recovery_code_hash,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $6)
    `,
    [
      user.username,
      user.password_salt,
      user.password_hash,
      user.recovery_code_salt,
      user.recovery_code_hash,
      nowIsoString(),
    ]
  );
}

async function updateUserPassword(user) {
  await initializeDatabase();
  await pool.query(
    `
      UPDATE users
      SET password_salt = $2, password_hash = $3, updated_at = $4
      WHERE username = $1
    `,
    [user.username, user.password_salt, user.password_hash, nowIsoString()]
  );
}

async function updateUserPasswordAndRecoveryCode(user) {
  await initializeDatabase();
  await pool.query(
    `
      UPDATE users
      SET
        password_salt = $2,
        password_hash = $3,
        recovery_code_salt = $4,
        recovery_code_hash = $5,
        updated_at = $6
      WHERE username = $1
    `,
    [
      user.username,
      user.password_salt,
      user.password_hash,
      user.recovery_code_salt,
      user.recovery_code_hash,
      nowIsoString(),
    ]
  );
}

async function upsertSession(session) {
  await initializeDatabase();
  await pool.query(
    `
      INSERT INTO sessions (
        token,
        username,
        expires_at_ms,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $4)
      ON CONFLICT (token) DO UPDATE SET
        username = EXCLUDED.username,
        expires_at_ms = EXCLUDED.expires_at_ms,
        updated_at = EXCLUDED.updated_at
    `,
    [session.token, session.username, session.expires_at_ms, nowIsoString()]
  );
}

async function getSessionByToken(token) {
  await initializeDatabase();
  const result = await pool.query(
    `
      SELECT token, username, expires_at_ms
      FROM sessions
      WHERE token = $1
    `,
    [token]
  );
  return result.rows[0] || null;
}

async function deleteSession(token) {
  await initializeDatabase();
  await pool.query(`DELETE FROM sessions WHERE token = $1`, [token]);
}

async function deleteExpiredSessions(nowMs) {
  await initializeDatabase();
  await pool.query(`DELETE FROM sessions WHERE expires_at_ms <= $1`, [nowMs]);
}

async function healthCheck() {
  await initializeDatabase();
  const result = await pool.query("SELECT 1 AS ok");
  return {
    ok: Boolean(result.rows[0] && Number(result.rows[0].ok) === 1),
    engine: "postgres",
  };
}

module.exports = {
  ensureUserDatabase,
  getAllClients,
  getArchivedClients,
  getClientById,
  createClient,
  updateClient,
  deleteClient,
  archiveClient,
  restoreClient,
  getWorkEntriesByClient,
  getWorkEntryByDate,
  upsertWorkEntry,
  deleteWorkEntry,
  upsertPayPeriodSalary,
  deletePayPeriodSalary,
  getPayPeriodSalary,
  getSettings,
  upsertSettings,
  resetSettings,
  getUserByUsername,
  createUser,
  updateUserPassword,
  updateUserPasswordAndRecoveryCode,
  upsertSession,
  getSessionByToken,
  deleteSession,
  deleteExpiredSessions,
  healthCheck,
};
