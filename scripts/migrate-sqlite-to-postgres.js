const path = require("path");
const Database = require("better-sqlite3");
const { Pool } = require("pg");

const sqlitePath = process.env.SQLITE_DB_PATH || path.resolve(__dirname, "..", "data", "hours.db");
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required.");
}

const sqlite = new Database(sqlitePath, { readonly: true });
const usesLocalhost =
  databaseUrl.includes("localhost") ||
  databaseUrl.includes("127.0.0.1") ||
  databaseUrl.includes("host.docker.internal");
const pool = new Pool({
  connectionString: databaseUrl,
  ssl: usesLocalhost ? false : { rejectUnauthorized: false },
});

function getUserDbPath(username) {
  const crypto = require("crypto");
  const usernameHash = crypto.createHash("sha256").update(username).digest("hex");
  return path.resolve(path.dirname(sqlitePath), "users", `${usernameHash}.db`);
}

async function ensurePgSchema() {
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
      CREATE TABLE IF NOT EXISTS clients (
        id BIGSERIAL PRIMARY KEY,
        username TEXT NOT NULL REFERENCES users (username) ON DELETE CASCADE,
        company_name TEXT NOT NULL,
        contact_name TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '',
        address TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        archived_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
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
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function run() {
  await ensurePgSchema();

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

    const userDb = new Database(getUserDbPath(user.username), { readonly: true });
    try {
      const clients = userDb.prepare(`
        SELECT id, company_name, contact_name, email, phone, address, notes, archived_at, created_at
        FROM clients
        ORDER BY id ASC
      `).all();

      const clientIdMap = new Map();

      for (const client of clients) {
        const inserted = await pool.query(
          `
            INSERT INTO clients (
              username, company_name, contact_name, email, phone, address, notes, archived_at, created_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, COALESCE($9::timestamptz, NOW()))
            RETURNING id
          `,
          [
            user.username,
            client.company_name,
            client.contact_name,
            client.email,
            client.phone,
            client.address,
            client.notes,
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
            user.username,
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
            user.username,
            clientIdMap.get(salary.client_id),
            salary.pay_period_month,
            salary.salary_amount_cents,
            salary.created_at || null,
            salary.updated_at || null,
          ]
        );
      }
    } finally {
      userDb.close();
    }
  }

  console.log(`Migration completed from ${sqlitePath}`);
}

run()
  .then(async () => {
    sqlite.close();
    await pool.end();
  })
  .catch(async (error) => {
    console.error(error);
    sqlite.close();
    await pool.end();
    process.exit(1);
  });
