const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Database = require("better-sqlite3");

const defaultDbPath = path.resolve(__dirname, "data", "hours.db");
const configuredDbPath =
  typeof process.env.DB_PATH === "string" && process.env.DB_PATH.trim()
    ? process.env.DB_PATH.trim()
    : defaultDbPath;
const dbPath = path.isAbsolute(configuredDbPath)
  ? configuredDbPath
  : path.resolve(process.cwd(), configuredDbPath);
const dbDir = path.dirname(dbPath);
const userDbsDir = path.join(dbDir, "users");

fs.mkdirSync(dbDir, { recursive: true });
fs.mkdirSync(userDbsDir, { recursive: true });

const authDb = new Database(dbPath);
authDb.pragma("journal_mode = WAL");
authDb.pragma("foreign_keys = ON");

const authSchemaSql = `
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
`;

const clientsSchemaSql = `
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_name TEXT NOT NULL,
  contact_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  archived_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_clients_company_name
  ON clients (company_name);
`;

const workEntriesSchemaSql = `
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
`;

const payPeriodSalariesSchemaSql = `
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
`;

authDb.exec(authSchemaSql);

function tableExists(database, tableName) {
  const row = database
    .prepare(
      `
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name = ?
      `
    )
    .get(tableName);
  return Boolean(row);
}

function getTableColumns(database, tableName) {
  if (!tableExists(database, tableName)) {
    return [];
  }
  return database.prepare(`PRAGMA table_info(${tableName})`).all();
}

function ensureUsersRecoveryColumns(database) {
  const columns = getTableColumns(database, "users");
  const hasRecoverySaltColumn = columns.some((column) => column.name === "recovery_code_salt");
  const hasRecoveryHashColumn = columns.some((column) => column.name === "recovery_code_hash");

  if (!hasRecoverySaltColumn) {
    database.prepare("ALTER TABLE users ADD COLUMN recovery_code_salt TEXT").run();
  }
  if (!hasRecoveryHashColumn) {
    database.prepare("ALTER TABLE users ADD COLUMN recovery_code_hash TEXT").run();
  }
}

function ensureClientsTable(database) {
  database.exec(clientsSchemaSql);
  const columns = getTableColumns(database, "clients");
  const hasArchivedAtColumn = columns.some((column) => column.name === "archived_at");

  if (!hasArchivedAtColumn) {
    database.prepare("ALTER TABLE clients ADD COLUMN archived_at TEXT").run();
  }
}

function getOrCreateDefaultClientId(database) {
  ensureClientsTable(database);
  const existingClient = database
    .prepare(
      `
        SELECT id
        FROM clients
        WHERE archived_at IS NULL
        ORDER BY created_at ASC, id ASC
        LIMIT 1
      `
    )
    .get();

  if (existingClient) {
    return existingClient.id;
  }

  const result = database
    .prepare(
      `
        INSERT INTO clients (
          company_name,
          contact_name,
          email,
          phone,
          address,
          notes,
          created_at
        )
        VALUES (
          'Client principal',
          '',
          '',
          '',
          '',
          '',
          datetime('now')
        )
      `
    )
    .run();

  return Number(result.lastInsertRowid);
}

function migrateWorkEntriesTable(database) {
  if (!tableExists(database, "work_entries")) {
    database.exec(workEntriesSchemaSql);
    return;
  }

  const columns = getTableColumns(database, "work_entries");
  const hasClientId = columns.some((column) => column.name === "client_id");
  const hasCommentColumn = columns.some((column) => column.name === "comment_text");
  const hasDayTypeColumn = columns.some((column) => column.name === "day_type");
  const hasIdColumn = columns.some((column) => column.name === "id");
  const hasPrimaryKeyOnWorkDate = columns.some(
    (column) => column.name === "work_date" && Number(column.pk) === 1
  );

  const indexList = database.prepare("PRAGMA index_list(work_entries)").all();
  const hasUniqueClientDateIndex = indexList.some((index) => {
    if (!index.unique) {
      return false;
    }
    const indexInfo = database.prepare(`PRAGMA index_info(${index.name})`).all();
    const indexedColumns = indexInfo.map((column) => column.name).join(",");
    return indexedColumns === "client_id,work_date";
  });

  if (hasClientId && hasIdColumn && !hasPrimaryKeyOnWorkDate && hasUniqueClientDateIndex) {
    database.exec(`
      CREATE INDEX IF NOT EXISTS idx_work_entries_client_date
        ON work_entries (client_id, work_date);
    `);
    return;
  }

  const defaultClientId = getOrCreateDefaultClientId(database);
  const dayTypeSelect = hasDayTypeColumn ? "day_type" : "'office'";
  const commentSelect = hasCommentColumn ? "comment_text" : "''";
  const clientIdSelect = hasClientId ? "client_id" : String(defaultClientId);

  database.exec(`
    BEGIN;

    CREATE TABLE work_entries_new (
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

    INSERT INTO work_entries_new (
      client_id,
      work_date,
      day_type,
      arrival_time,
      departure_time,
      lunch_break_minutes,
      worked_minutes,
      comment_text,
      created_at,
      updated_at
    )
    SELECT
      ${clientIdSelect},
      work_date,
      ${dayTypeSelect},
      arrival_time,
      departure_time,
      lunch_break_minutes,
      worked_minutes,
      ${commentSelect},
      created_at,
      updated_at
    FROM work_entries;

    DROP TABLE work_entries;
    ALTER TABLE work_entries_new RENAME TO work_entries;

    CREATE INDEX IF NOT EXISTS idx_work_entries_client_date
      ON work_entries (client_id, work_date);

    COMMIT;
  `);
}

function migratePayPeriodSalariesTable(database) {
  if (!tableExists(database, "pay_period_salaries")) {
    database.exec(payPeriodSalariesSchemaSql);
    return;
  }

  const columns = getTableColumns(database, "pay_period_salaries");
  const hasClientId = columns.some((column) => column.name === "client_id");
  const hasIdColumn = columns.some((column) => column.name === "id");
  const hasPrimaryKeyOnMonth = columns.some(
    (column) => column.name === "pay_period_month" && Number(column.pk) === 1
  );
  const indexList = database.prepare("PRAGMA index_list(pay_period_salaries)").all();
  const hasUniqueClientMonthIndex = indexList.some((index) => {
    if (!index.unique) {
      return false;
    }
    const indexInfo = database.prepare(`PRAGMA index_info(${index.name})`).all();
    const indexedColumns = indexInfo.map((column) => column.name).join(",");
    return indexedColumns === "client_id,pay_period_month";
  });

  if (hasClientId && hasIdColumn && !hasPrimaryKeyOnMonth && hasUniqueClientMonthIndex) {
    database.exec(`
      CREATE INDEX IF NOT EXISTS idx_pay_period_salaries_client_month
        ON pay_period_salaries (client_id, pay_period_month);
    `);
    return;
  }

  const defaultClientId = getOrCreateDefaultClientId(database);
  const clientIdSelect = hasClientId ? "client_id" : String(defaultClientId);

  database.exec(`
    BEGIN;

    CREATE TABLE pay_period_salaries_new (
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

    INSERT INTO pay_period_salaries_new (
      client_id,
      pay_period_month,
      salary_amount_cents,
      created_at,
      updated_at
    )
    SELECT
      ${clientIdSelect},
      pay_period_month,
      salary_amount_cents,
      created_at,
      updated_at
    FROM pay_period_salaries;

    DROP TABLE pay_period_salaries;
    ALTER TABLE pay_period_salaries_new RENAME TO pay_period_salaries;

    CREATE INDEX IF NOT EXISTS idx_pay_period_salaries_client_month
      ON pay_period_salaries (client_id, pay_period_month);

    COMMIT;
  `);
}

function initializeUserDatabase(database) {
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  ensureClientsTable(database);
  migrateWorkEntriesTable(database);
  migratePayPeriodSalariesTable(database);
}

ensureUsersRecoveryColumns(authDb);

const getUserByUsernameStmt = authDb.prepare(`
  SELECT
    id,
    username,
    password_salt,
    password_hash,
    recovery_code_salt,
    recovery_code_hash
  FROM users
  WHERE username = ?
`);

const createUserStmt = authDb.prepare(`
  INSERT INTO users (
    username,
    password_salt,
    password_hash,
    recovery_code_salt,
    recovery_code_hash,
    created_at,
    updated_at
  )
  VALUES (
    @username,
    @password_salt,
    @password_hash,
    @recovery_code_salt,
    @recovery_code_hash,
    datetime('now'),
    datetime('now')
  )
`);

const updateUserPasswordStmt = authDb.prepare(`
  UPDATE users
  SET
    password_salt = @password_salt,
    password_hash = @password_hash,
    updated_at = datetime('now')
  WHERE username = @username
`);

const updateUserPasswordAndRecoveryCodeStmt = authDb.prepare(`
  UPDATE users
  SET
    password_salt = @password_salt,
    password_hash = @password_hash,
    recovery_code_salt = @recovery_code_salt,
    recovery_code_hash = @recovery_code_hash,
    updated_at = datetime('now')
  WHERE username = @username
`);

const upsertSessionStmt = authDb.prepare(`
  INSERT INTO sessions (
    token,
    username,
    expires_at_ms,
    created_at,
    updated_at
  )
  VALUES (
    @token,
    @username,
    @expires_at_ms,
    datetime('now'),
    datetime('now')
  )
  ON CONFLICT(token) DO UPDATE SET
    username = excluded.username,
    expires_at_ms = excluded.expires_at_ms,
    updated_at = datetime('now')
`);

const getSessionByTokenStmt = authDb.prepare(`
  SELECT
    token,
    username,
    expires_at_ms
  FROM sessions
  WHERE token = ?
`);

const deleteSessionStmt = authDb.prepare(`
  DELETE FROM sessions
  WHERE token = ?
`);

const deleteExpiredSessionsStmt = authDb.prepare(`
  DELETE FROM sessions
  WHERE expires_at_ms <= ?
`);

const userStores = new Map();

function migrateExistingUserDbs() {
  if (!fs.existsSync(userDbsDir)) {
    return;
  }

  const files = fs.readdirSync(userDbsDir).filter((file) => file.endsWith(".db"));
  for (const file of files) {
    const filePath = path.join(userDbsDir, file);
    const userDb = new Database(filePath);
    initializeUserDatabase(userDb);
    userDb.close();
  }
}

migrateExistingUserDbs();

function getUserDbPath(username) {
  const usernameHash = crypto.createHash("sha256").update(username).digest("hex");
  return path.join(userDbsDir, `${usernameHash}.db`);
}

function getUserStore(username) {
  const safeUsername = typeof username === "string" ? username.trim() : "";
  if (!safeUsername) {
    throw new Error("Username is required to access user database.");
  }

  if (userStores.has(safeUsername)) {
    return userStores.get(safeUsername);
  }

  const userDbPath = getUserDbPath(safeUsername);
  const userDb = new Database(userDbPath);
  initializeUserDatabase(userDb);

  const store = {
    getAllClientsStmt: userDb.prepare(`
      SELECT
        id,
        company_name,
        contact_name,
        email,
        phone,
        address,
        notes,
        archived_at,
        created_at
      FROM clients
      WHERE archived_at IS NULL
      ORDER BY company_name COLLATE NOCASE ASC, id ASC
    `),
    getArchivedClientsStmt: userDb.prepare(`
      SELECT
        id,
        company_name,
        contact_name,
        email,
        phone,
        address,
        notes,
        archived_at,
        created_at
      FROM clients
      WHERE archived_at IS NOT NULL
      ORDER BY archived_at DESC, company_name COLLATE NOCASE ASC, id ASC
    `),
    getClientByIdStmt: userDb.prepare(`
      SELECT
        id,
        company_name,
        contact_name,
        email,
        phone,
        address,
        notes,
        archived_at,
        created_at
      FROM clients
      WHERE id = ?
    `),
    createClientStmt: userDb.prepare(`
      INSERT INTO clients (
        company_name,
        contact_name,
        email,
        phone,
        address,
        notes,
        created_at
      )
      VALUES (
        @company_name,
        @contact_name,
        @email,
        @phone,
        @address,
        @notes,
        datetime('now')
      )
    `),
    updateClientStmt: userDb.prepare(`
      UPDATE clients
      SET
        company_name = @company_name,
        contact_name = @contact_name,
        email = @email,
        phone = @phone,
        address = @address,
        notes = @notes
      WHERE id = @id
    `),
    deleteClientStmt: userDb.prepare(`
      DELETE FROM clients
      WHERE id = ?
    `),
    archiveClientStmt: userDb.prepare(`
      UPDATE clients
      SET archived_at = datetime('now')
      WHERE id = ?
        AND archived_at IS NULL
    `),
    restoreClientStmt: userDb.prepare(`
      UPDATE clients
      SET archived_at = NULL
      WHERE id = ?
        AND archived_at IS NOT NULL
    `),
    upsertWorkEntryStmt: userDb.prepare(`
      INSERT INTO work_entries (
        client_id,
        work_date,
        day_type,
        arrival_time,
        departure_time,
        lunch_break_minutes,
        worked_minutes,
        comment_text,
        created_at,
        updated_at
      )
      VALUES (
        @client_id,
        @work_date,
        @day_type,
        @arrival_time,
        @departure_time,
        @lunch_break_minutes,
        @worked_minutes,
        @comment_text,
        datetime('now'),
        datetime('now')
      )
      ON CONFLICT(client_id, work_date) DO UPDATE SET
        day_type = excluded.day_type,
        arrival_time = excluded.arrival_time,
        departure_time = excluded.departure_time,
        lunch_break_minutes = excluded.lunch_break_minutes,
        worked_minutes = excluded.worked_minutes,
        comment_text = excluded.comment_text,
        updated_at = datetime('now')
    `),
    deleteWorkEntryStmt: userDb.prepare(`
      DELETE FROM work_entries
      WHERE client_id = @client_id
        AND work_date = @work_date
    `),
    getWorkEntryByDateStmt: userDb.prepare(`
      SELECT
        id,
        client_id,
        work_date,
        day_type,
        arrival_time,
        departure_time,
        lunch_break_minutes,
        worked_minutes,
        comment_text
      FROM work_entries
      WHERE client_id = ?
        AND work_date = ?
    `),
    getWorkEntriesByClientStmt: userDb.prepare(`
      SELECT
        id,
        client_id,
        work_date,
        day_type,
        arrival_time,
        departure_time,
        lunch_break_minutes,
        worked_minutes,
        comment_text
      FROM work_entries
      WHERE client_id = ?
      ORDER BY work_date ASC
    `),
    getWorkEntriesByClientRangeStmt: userDb.prepare(`
      SELECT
        id,
        client_id,
        work_date,
        day_type,
        arrival_time,
        departure_time,
        lunch_break_minutes,
        worked_minutes,
        comment_text
      FROM work_entries
      WHERE client_id = ?
        AND work_date >= ?
        AND work_date < ?
      ORDER BY work_date ASC
    `),
    upsertPayPeriodSalaryStmt: userDb.prepare(`
      INSERT INTO pay_period_salaries (
        client_id,
        pay_period_month,
        salary_amount_cents,
        created_at,
        updated_at
      )
      VALUES (
        @client_id,
        @pay_period_month,
        @salary_amount_cents,
        datetime('now'),
        datetime('now')
      )
      ON CONFLICT(client_id, pay_period_month) DO UPDATE SET
        salary_amount_cents = excluded.salary_amount_cents,
        updated_at = datetime('now')
    `),
    deletePayPeriodSalaryStmt: userDb.prepare(`
      DELETE FROM pay_period_salaries
      WHERE client_id = ?
        AND pay_period_month = ?
    `),
    getPayPeriodSalaryStmt: userDb.prepare(`
      SELECT salary_amount_cents
      FROM pay_period_salaries
      WHERE client_id = ?
        AND pay_period_month = ?
    `),
  };

  userStores.set(safeUsername, store);
  return store;
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
  };
}

function ensureUserDatabase(username) {
  getUserStore(username);
}

function getAllClients(username) {
  const store = getUserStore(username);
  return store.getAllClientsStmt.all();
}

function getArchivedClients(username) {
  const store = getUserStore(username);
  return store.getArchivedClientsStmt.all();
}

function getClientById(username, id) {
  const store = getUserStore(username);
  return store.getClientByIdStmt.get(id) || null;
}

function createClient(username, client) {
  const store = getUserStore(username);
  const payload = normalizeClientPayload(client);
  const result = store.createClientStmt.run(payload);
  return getClientById(username, Number(result.lastInsertRowid));
}

function updateClient(username, clientId, client) {
  const store = getUserStore(username);
  const payload = normalizeClientPayload(client);
  store.updateClientStmt.run({
    id: clientId,
    ...payload,
  });
  return getClientById(username, clientId);
}

function deleteClient(username, clientId) {
  const store = getUserStore(username);
  store.deleteClientStmt.run(clientId);
}

function archiveClient(username, clientId) {
  const store = getUserStore(username);
  store.archiveClientStmt.run(clientId);
}

function restoreClient(username, clientId) {
  const store = getUserStore(username);
  store.restoreClientStmt.run(clientId);
}

function getWorkEntriesByClient(username, clientId, startDate = null, endDate = null) {
  const store = getUserStore(username);
  if (typeof startDate === "string" && typeof endDate === "string") {
    return store.getWorkEntriesByClientRangeStmt.all(clientId, startDate, endDate);
  }
  return store.getWorkEntriesByClientStmt.all(clientId);
}

function getWorkEntryByDate(username, clientId, workDate) {
  const store = getUserStore(username);
  return store.getWorkEntryByDateStmt.get(clientId, workDate) || null;
}

function upsertWorkEntry(username, entry) {
  const store = getUserStore(username);
  store.upsertWorkEntryStmt.run(entry);
}

function deleteWorkEntry(username, clientId, workDate) {
  const store = getUserStore(username);
  store.deleteWorkEntryStmt.run({ client_id: clientId, work_date: workDate });
}

function upsertPayPeriodSalary(username, payPeriodSalary) {
  const store = getUserStore(username);
  store.upsertPayPeriodSalaryStmt.run(payPeriodSalary);
}

function deletePayPeriodSalary(username, clientId, payPeriodMonth) {
  const store = getUserStore(username);
  store.deletePayPeriodSalaryStmt.run(clientId, payPeriodMonth);
}

function getPayPeriodSalary(username, clientId, payPeriodMonth) {
  const store = getUserStore(username);
  const row = store.getPayPeriodSalaryStmt.get(clientId, payPeriodMonth);
  return row ? row.salary_amount_cents : null;
}

function getUserByUsername(username) {
  return getUserByUsernameStmt.get(username) || null;
}

function createUser(user) {
  createUserStmt.run(user);
}

function updateUserPassword(user) {
  updateUserPasswordStmt.run(user);
}

function updateUserPasswordAndRecoveryCode(user) {
  updateUserPasswordAndRecoveryCodeStmt.run(user);
}

function upsertSession(session) {
  upsertSessionStmt.run(session);
}

function getSessionByToken(token) {
  return getSessionByTokenStmt.get(token) || null;
}

function deleteSession(token) {
  deleteSessionStmt.run(token);
}

function deleteExpiredSessions(nowMs) {
  deleteExpiredSessionsStmt.run(nowMs);
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
  getUserByUsername,
  createUser,
  updateUserPassword,
  updateUserPasswordAndRecoveryCode,
  upsertSession,
  getSessionByToken,
  deleteSession,
  deleteExpiredSessions,
};
