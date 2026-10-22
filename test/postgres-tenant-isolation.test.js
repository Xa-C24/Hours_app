const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { postgresConnectionOptions } = require("../services/postgres-connection-options");

const TEST_URL = process.env.M01_TEST_DATABASE_URL;
const NEON_API_KEY = process.env.NEON_API_KEY;
const NEON_PROJECT_ID = process.env.M01_NEON_PROJECT_ID;
const NEON_BRANCH_ID = process.env.M01_NEON_BRANCH_ID;
const NEON_PROJECT_NAME = "App_Hours";
const NEON_BRANCH_NAME = "Branch_Test";
const NEON_API_BASE = "https://console.neon.tech/api/v2";
const APPLICATION_TABLES = [
  "users",
  "sessions",
  "mobile_auth_tokens",
  "clients",
  "work_entries",
  "pay_period_salaries",
  "settings",
  "work_timers",
];
const migration = fs.readFileSync(path.resolve(__dirname, "..", "migrations", "001_tenant_client_ownership.sql"), "utf8");
const rollback = fs.readFileSync(path.resolve(__dirname, "..", "migrations", "001_tenant_client_ownership.rollback.sql"), "utf8");
const postgresAdapter = fs.readFileSync(path.resolve(__dirname, "..", "db-postgres.js"), "utf8");
const referenceSchema = fs.readFileSync(path.resolve(__dirname, "..", "schema.sql"), "utf8");

test("M01 schema and migration declare owner-matched client relationships", () => {
  for (const source of [postgresAdapter, referenceSchema]) {
    assert.match(source, /FOREIGN KEY \(username, client_id\)\s+REFERENCES clients \(username, id\) ON DELETE CASCADE/);
    assert.match(source, /UNIQUE \(username, id\)/);
  }
  assert.match(migration, /LOCK TABLE clients, work_entries, pay_period_salaries/);
  assert.match(migration, /M01 ownership preflight failed/);
  assert.match(migration, /VALIDATE CONSTRAINT work_entries_owner_client_fk/);
  assert.match(migration, /VALIDATE CONSTRAINT pay_period_salaries_owner_client_fk/);
  assert.match(migration, /BEGIN;[\s\S]*COMMIT;/);
  assert.match(rollback, /DROP CONSTRAINT IF EXISTS work_entries_owner_client_fk/);
  assert.match(rollback, /DROP CONSTRAINT IF EXISTS pay_period_salaries_owner_client_fk/);
});

test("M01 catalog arrays normalize node-postgres and PostgreSQL text representations", () => {
  const expected = ["username", "client_id"];
  assert.deepEqual(normalizePgTextArray(expected), expected);
  assert.deepEqual(normalizePgTextArray("{username,client_id}"), expected);
  assert.deepEqual(normalizePgTextArray('{"username","client_id"}'), expected);
  assert.throws(() => normalizePgTextArray("username,client_id"), /PostgreSQL array/);
});

test("Neon target guard requires a direct Neon host and neondb", () => {
  const host = "ep-m01-branch-test.us-east-1.aws.neon.tech";
  const url = `postgresql://synthetic:synthetic@${host}/neondb?sslmode=require`;
  assert.deepEqual(assertIsolatedNeonTestUrl(url), { hostname: host, databaseName: "neondb" });
  assert.throws(() => assertIsolatedNeonTestUrl(url.replace(host, "ep-m01-branch-test-pooler.us-east-1.aws.neon.tech")), /direct endpoint/);
  assert.throws(() => assertIsolatedNeonTestUrl(url.replace("/neondb", "/production")), /exactly neondb/);
  assert.throws(() => assertIsolatedNeonTestUrl(url.replace("sslmode=require", "sslmode=disable")), /Unsupported PostgreSQL TLS option/);
});

test("Neon API proof binds App_Hours, Branch_Test and the URL endpoint independently", async () => {
  const host = "ep-m01-branch-test.us-east-1.aws.neon.tech";
  const calls = [];
  const fakeFetch = async (url, options) => {
    calls.push({ url: String(url), authorization: options.headers.Authorization });
    if (String(url).endsWith("/projects/proj-synthetic")) {
      return { ok: true, json: async () => ({ project: { id: "proj-synthetic", name: "App_Hours" } }) };
    }
    if (String(url).endsWith("/branches/br-synthetic")) {
      return { ok: true, json: async () => ({ branch: { id: "br-synthetic", project_id: "proj-synthetic", name: "Branch_Test" } }) };
    }
    return { ok: true, json: async () => ({ endpoints: [{ id: "ep-synthetic", branch_id: "br-synthetic", host, type: "read_write" }] }) };
  };
  await verifyNeonEndpointIdentity({
    apiKey: "synthetic-api-key",
    projectId: "proj-synthetic",
    branchId: "br-synthetic",
    targetHost: host,
    fetchImpl: fakeFetch,
  });
  assert.equal(calls.length, 3);
  assert.ok(calls.every(call => call.authorization === "Bearer synthetic-api-key"));
  assert.ok(calls.every(call => !call.url.includes("synthetic-api-key")));

  await assert.rejects(
    verifyNeonEndpointIdentity({
      apiKey: "synthetic-api-key",
      projectId: "proj-synthetic",
      branchId: "br-synthetic",
      targetHost: "ep-production.us-east-1.aws.neon.tech",
      fetchImpl: fakeFetch,
    }),
    /does not belong to the verified Branch_Test endpoint/
  );
});

test("public application preflight reads row counts and refuses populated tables", async () => {
  const queries = [];
  const client = {
    async query(sql) {
      queries.push(sql.trim());
      if (sql.includes("current_database")) return { rows: [{ database_name: "neondb", schema_name: "public" }] };
      if (sql.includes("information_schema.tables")) return { rows: [{ table_name: "clients" }] };
      return { rows: [{ count: 0 }] };
    },
  };
  assert.deepEqual(await assertEmptyPublicApplicationTables(client), [{ tableName: "clients", count: 0 }]);
  assert.ok(queries.every(sql => /^SELECT\b/i.test(sql)), "preflight must remain read-only");

  client.query = async sql => {
    if (sql.includes("current_database")) return { rows: [{ database_name: "neondb", schema_name: "public" }] };
    if (sql.includes("information_schema.tables")) return { rows: [{ table_name: "clients" }] };
    return { rows: [{ count: 1 }] };
  };
  await assert.rejects(assertEmptyPublicApplicationTables(client), /must be empty/);
});

function assertIsolatedNeonTestUrl(value) {
  assert.ok(typeof value === "string" && value.length > 0, "M01_TEST_DATABASE_URL is required");
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase();
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol), "M01 test URL must use PostgreSQL");
  assert.ok(hostname.endsWith(".neon.tech") && hostname.startsWith("ep-"), "M01 test PostgreSQL must use a direct Neon endpoint");
  assert.ok(!hostname.includes("-pooler."), "M01 test PostgreSQL must use the direct endpoint, not a pooler");
  assert.equal(databaseName, "neondb", "M01 test database name must be exactly neondb");
  const options = postgresConnectionOptions(value);
  assert.equal(options.ssl.rejectUnauthorized, true, "M01 Neon connection must verify TLS certificates");
  return { hostname, databaseName };
}

async function verifyNeonEndpointIdentity({ apiKey, projectId, branchId, targetHost, fetchImpl = fetch }) {
  assert.ok(apiKey, "NEON_API_KEY is required for independent target verification");
  assert.ok(projectId, "M01_NEON_PROJECT_ID is required for independent target verification");
  assert.ok(branchId, "M01_NEON_BRANCH_ID is required for independent target verification");
  assert.ok(targetHost, "Neon endpoint host is required for independent target verification");

  async function getJson(pathname) {
    let response;
    try {
      response = await fetchImpl(`${NEON_API_BASE}${pathname}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
        signal: AbortSignal.timeout(10000),
      });
    } catch (_) {
      throw new Error("Neon target verification request failed.");
    }
    if (!response.ok) throw new Error("Neon target verification was rejected.");
    try { return await response.json(); } catch (_) { throw new Error("Neon target verification returned invalid metadata."); }
  }

  const projectPayload = await getJson(`/projects/${encodeURIComponent(projectId)}`);
  const project = projectPayload.project || projectPayload;
  assert.equal(project.id, projectId, "Neon API project ID did not match");
  assert.equal(project.name, NEON_PROJECT_NAME, "Neon API project is not App_Hours");

  const branchPayload = await getJson(`/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branchId)}`);
  const branch = branchPayload.branch || branchPayload;
  assert.equal(branch.id, branchId, "Neon API branch ID did not match");
  assert.equal(branch.project_id, projectId, "Neon API branch is not in App_Hours");
  assert.equal(branch.name, NEON_BRANCH_NAME, "Neon API branch is not Branch_Test");

  const endpointPayload = await getJson(`/projects/${encodeURIComponent(projectId)}/endpoints`);
  const endpoints = endpointPayload.endpoints || [];
  const matchedEndpoint = endpoints.find(endpoint => endpoint.branch_id === branchId && endpoint.host === targetHost);
  assert.ok(matchedEndpoint, "URL host does not belong to the verified Branch_Test endpoint");
  assert.equal(matchedEndpoint.type, "read_write", "M01 endpoint must be the Branch_Test read-write endpoint");
  return { projectId: project.id, branchId: branch.id, endpointId: matchedEndpoint.id };
}

async function assertEmptyPublicApplicationTables(client) {
  const current = await client.query("SELECT current_database() AS database_name, current_schema() AS schema_name");
  assert.equal(current.rows[0].database_name, "neondb", "M01 target database must be neondb");
  assert.equal(current.rows[0].schema_name, "public", "M01 preflight must start in public schema");

  const existing = await client.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name = ANY($1::text[])",
    [APPLICATION_TABLES]
  );
  const counts = [];
  for (const { table_name: tableName } of existing.rows) {
    // tableName comes from a fixed application-table allowlist above.
    const result = await client.query(`SELECT count(*)::int AS count FROM public."${tableName}"`);
    counts.push({ tableName, count: result.rows[0].count });
  }
  assert.ok(
    counts.every(({ count }) => count === 0),
    `M01 stopped before writing: public application tables must be empty (${counts.map(({ tableName, count }) => `${tableName}=${count}`).join(", ") || "no application tables found"})`
  );
  return counts;
}

function normalizePgTextArray(value) {
  if (Array.isArray(value)) return [...value];
  if (typeof value !== "string" || value.length < 2 || value[0] !== "{" || value.at(-1) !== "}") {
    throw new TypeError("Expected a PostgreSQL array value.");
  }
  if (value === "{}") return [];

  const values = [];
  let index = 1;
  const end = value.length - 1;
  while (index < end) {
    let item = "";
    if (value[index] === '"') {
      index += 1;
      let closed = false;
      while (index < end) {
        const character = value[index++];
        if (character === "\\") {
          if (index >= end) throw new TypeError("Malformed PostgreSQL array escape.");
          item += value[index++];
        } else if (character === '"') {
          closed = true;
          break;
        } else {
          item += character;
        }
      }
      if (!closed) throw new TypeError("Malformed PostgreSQL array quoting.");
    } else {
      while (index < end && value[index] !== ",") {
        const character = value[index++];
        if (character === "\\") {
          if (index >= end) throw new TypeError("Malformed PostgreSQL array escape.");
          item += value[index++];
        } else {
          item += character;
        }
      }
      if (item === "NULL") {
        values.push(null);
      } else {
        values.push(item);
      }
    }

    if (value[index] === ",") index += 1;
    else if (index !== end) throw new TypeError("Malformed PostgreSQL array separator.");
    if (value[index - 1] === '"' || value[index - 2] === '"') values.push(item);
  }
  return values;
}

async function assertTenantConstraints(client, { expectSupportingIndex = true } = {}) {
  const result = await client.query(`
    SELECT con.conname, con.contype, con.convalidated,
      ARRAY(
        SELECT attr.attname
        FROM unnest(con.conkey) WITH ORDINALITY AS key(attnum, ord)
        JOIN pg_attribute AS attr ON attr.attrelid = con.conrelid AND attr.attnum = key.attnum
        ORDER BY key.ord
      ) AS columns,
      ARRAY(
        SELECT attr.attname
        FROM unnest(con.confkey) WITH ORDINALITY AS key(attnum, ord)
        JOIN pg_attribute AS attr ON attr.attrelid = con.confrelid AND attr.attnum = key.attnum
        ORDER BY key.ord
      ) AS referenced_columns
    FROM pg_constraint AS con
    WHERE con.conname = ANY($1::text[])
      AND con.conrelid IN ('work_entries'::regclass, 'pay_period_salaries'::regclass)
    ORDER BY con.conname
  `, [["work_entries_owner_client_fk", "pay_period_salaries_owner_client_fk"]]);
  const normalizedRows = result.rows.map(row => ({
    ...row,
    columns: normalizePgTextArray(row.columns),
    referenced_columns: normalizePgTextArray(row.referenced_columns),
  }));
  assert.deepEqual(normalizedRows, [
    {
      conname: "pay_period_salaries_owner_client_fk",
      contype: "f",
      convalidated: true,
      columns: ["username", "client_id"],
      referenced_columns: ["username", "id"],
    },
    {
      conname: "work_entries_owner_client_fk",
      contype: "f",
      convalidated: true,
      columns: ["username", "client_id"],
      referenced_columns: ["username", "id"],
    },
  ]);

  if (!expectSupportingIndex) return;
  const index = await client.query(`
    SELECT index_class.relname, index_data.indisunique, index_data.indisvalid,
      ARRAY(
        SELECT attr.attname
        FROM unnest(index_data.indkey) WITH ORDINALITY AS key(attnum, ord)
        JOIN pg_attribute AS attr ON attr.attrelid = index_data.indrelid AND attr.attnum = key.attnum
        WHERE key.ord <= index_data.indnkeyatts
        ORDER BY key.ord
      ) AS columns
    FROM pg_index AS index_data
    JOIN pg_class AS index_class ON index_class.oid = index_data.indexrelid
    WHERE index_data.indrelid = 'clients'::regclass
      AND index_class.relname = 'idx_clients_username_id_unique'
  `);
  assert.deepEqual(index.rows.map(row => ({ ...row, columns: normalizePgTextArray(row.columns) })), [{
    relname: "idx_clients_username_id_unique",
    indisunique: true,
    indisvalid: true,
    columns: ["username", "id"],
  }]);
}

async function assertTenantConstraintsRemoved(client, { expectSupportingIndexRemoved = false } = {}) {
  const result = await client.query(`
    SELECT count(*)::int AS count FROM pg_constraint
    WHERE conname = ANY($1::text[])
      AND conrelid IN ('work_entries'::regclass, 'pay_period_salaries'::regclass)
  `, [["work_entries_owner_client_fk", "pay_period_salaries_owner_client_fk"]]);
  assert.equal(result.rows[0].count, 0);
  if (expectSupportingIndexRemoved) {
    const index = await client.query("SELECT to_regclass('idx_clients_username_id_unique') AS index_name");
    assert.equal(index.rows[0].index_name, null);
  }
}

async function withPublicSchemaClone(client, callback) {
  const schema = `m01_public_clone_${crypto.randomUUID().replace(/-/g, "")}`;
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET search_path TO "${schema}"`);
  try {
    await client.query(referenceSchema);
    await client.query(`
      ALTER TABLE work_entries DROP CONSTRAINT IF EXISTS work_entries_owner_client_fk;
      ALTER TABLE pay_period_salaries DROP CONSTRAINT IF EXISTS pay_period_salaries_owner_client_fk;
      ALTER TABLE work_entries ADD CONSTRAINT work_entries_legacy_client_fk
        FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE;
      ALTER TABLE pay_period_salaries ADD CONSTRAINT pay_period_salaries_legacy_client_fk
        FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE;
    `);
    await callback(schema);
  } finally {
    await client.query("SET search_path TO public");
    await client.query(`DROP SCHEMA "${schema}" CASCADE`);
  }
}

async function createLegacySchema(client, schema, { clientForeignKeys = true } = {}) {
  const clientReference = clientForeignKeys ? "REFERENCES clients(id) ON DELETE CASCADE" : "";
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET search_path TO "${schema}"`);
  await client.query(`
    CREATE TABLE clients (
      id BIGINT PRIMARY KEY,
      username TEXT NOT NULL,
      company_name TEXT NOT NULL
    );
    CREATE TABLE work_entries (
      id BIGINT PRIMARY KEY,
      username TEXT NOT NULL,
      client_id BIGINT NOT NULL ${clientReference},
      work_date DATE NOT NULL,
      comment_text TEXT NOT NULL DEFAULT '',
      UNIQUE(username, client_id, work_date)
    );
    CREATE TABLE pay_period_salaries (
      id BIGINT PRIMARY KEY,
      username TEXT NOT NULL,
      client_id BIGINT NOT NULL ${clientReference},
      pay_period_month TEXT NOT NULL,
      salary_amount_cents INTEGER NOT NULL CHECK (salary_amount_cents >= 0),
      UNIQUE(username, client_id, pay_period_month)
    );
    INSERT INTO clients (id, username, company_name) VALUES
      (101, 'synthetic-a', 'A one'), (102, 'synthetic-a', 'A two'),
      (201, 'synthetic-b', 'B one'), (202, 'synthetic-b', 'B two');
    INSERT INTO work_entries (id, username, client_id, work_date, comment_text) VALUES
      (1001, 'synthetic-a', 101, '2026-10-20', 'A synthetic row'),
      (2001, 'synthetic-b', 201, '2026-10-20', 'B synthetic row');
    INSERT INTO pay_period_salaries (id, username, client_id, pay_period_month, salary_amount_cents) VALUES
      (3001, 'synthetic-a', 101, '2026-10', 100),
      (4001, 'synthetic-b', 201, '2026-10', 200);
  `);
}

async function withIsolatedSchema(client, callback, options = {}) {
  const schema = `m01_${crypto.randomUUID().replace(/-/g, "")}`;
  await createLegacySchema(client, schema, options);
  try {
    await callback(schema);
  } finally {
    await client.query("SET search_path TO public");
    await client.query(`DROP SCHEMA "${schema}" CASCADE`);
  }
}

async function withFreshSchema(client, callback) {
  const schema = `m01_fresh_${crypto.randomUUID().replace(/-/g, "")}`;
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET search_path TO "${schema}"`);
  try {
    await callback();
  } finally {
    await client.query("SET search_path TO public");
    await client.query(`DROP SCHEMA "${schema}" CASCADE`);
  }
}

test("PostgreSQL M01 test is restricted to the verified Neon Branch_Test endpoint", {
  skip: !TEST_URL && !NEON_API_KEY && !NEON_PROJECT_ID && !NEON_BRANCH_ID,
}, async () => {
  const { hostname } = assertIsolatedNeonTestUrl(TEST_URL);
  await verifyNeonEndpointIdentity({
    apiKey: NEON_API_KEY,
    projectId: NEON_PROJECT_ID,
    branchId: NEON_BRANCH_ID,
    targetHost: hostname,
  });
  const pool = new Pool(postgresConnectionOptions(TEST_URL));
  const client = await pool.connect();
  try {
    await assertEmptyPublicApplicationTables(client);
    await withIsolatedSchema(client, async () => {
      await client.query(migration);
      await client.query(migration); // rerun must remain safe

      const before = await client.query("SELECT count(*)::int AS count FROM work_entries");
      assert.equal(before.rows[0].count, 2);
      await assertTenantConstraints(client);

      await assert.rejects(
        client.query("INSERT INTO work_entries (id, username, client_id, work_date) VALUES (1002, 'synthetic-a', 201, '2026-10-21')"),
        error => error.code === "23503"
      );
      await assert.rejects(
        client.query("UPDATE work_entries SET client_id = 201 WHERE id = 1001"),
        error => error.code === "23503"
      );
      await assert.rejects(
        client.query("INSERT INTO pay_period_salaries (id, username, client_id, pay_period_month, salary_amount_cents) VALUES (3002, 'synthetic-a', 201, '2026-11', 100)"),
        error => error.code === "23503"
      );

      await client.query("INSERT INTO work_entries (id, username, client_id, work_date) VALUES (1003, 'synthetic-a', 102, '2026-10-21')");
      await client.query("DELETE FROM clients WHERE id = 101");
      const remaining = await client.query(`
        SELECT
          (SELECT count(*)::int FROM work_entries WHERE username = 'synthetic-b') AS b_entries,
          (SELECT count(*)::int FROM pay_period_salaries WHERE username = 'synthetic-b') AS b_salaries,
          (SELECT count(*)::int FROM work_entries WHERE username = 'synthetic-a') AS a_entries
      `);
      assert.deepEqual(remaining.rows[0], { b_entries: 1, b_salaries: 1, a_entries: 1 });

      await client.query(rollback);
      await assertTenantConstraintsRemoved(client, { expectSupportingIndexRemoved: true });
      await client.query("INSERT INTO work_entries (id, username, client_id, work_date) VALUES (1004, 'synthetic-a', 201, '2026-10-22')");
      await client.query("INSERT INTO pay_period_salaries (id, username, client_id, pay_period_month, salary_amount_cents) VALUES (3004, 'synthetic-a', 201, '2026-11', 100)");
    });

    await withIsolatedSchema(client, async () => {
      await client.query("INSERT INTO work_entries (id, username, client_id, work_date) VALUES (9001, 'synthetic-a', 201, '2026-10-21')");
      await assert.rejects(client.query(migration), /M01 ownership preflight failed/);
      await client.query("ROLLBACK");
      const unchanged = await client.query("SELECT count(*)::int AS count FROM work_entries");
      assert.equal(unchanged.rows[0].count, 3);
      await assertTenantConstraintsRemoved(client);
    });

    await withIsolatedSchema(client, async () => {
      await client.query("INSERT INTO pay_period_salaries (id, username, client_id, pay_period_month, salary_amount_cents) VALUES (5001, 'synthetic-a', 201, '2026-11', 100)");
      await assert.rejects(client.query(migration), /M01 ownership preflight failed.*pay_period_salaries=1/);
      await client.query("ROLLBACK");
      const unchanged = await client.query("SELECT count(*)::int AS count FROM pay_period_salaries WHERE id = 5001");
      assert.equal(unchanged.rows[0].count, 1);
      await assertTenantConstraintsRemoved(client);
    });

    await withIsolatedSchema(client, async () => {
      await assert.rejects(
        client.query("INSERT INTO work_entries (id, username, client_id, work_date) VALUES (6001, 'synthetic-a', 999, '2026-10-21')"),
        error => error.code === "23503"
      );
    });

    await withIsolatedSchema(client, async () => {
      await client.query("INSERT INTO work_entries (id, username, client_id, work_date) VALUES (7001, 'synthetic-a', 999, '2026-10-21')");
      await client.query("INSERT INTO pay_period_salaries (id, username, client_id, pay_period_month, salary_amount_cents) VALUES (7002, 'synthetic-a', 998, '2026-11', 100)");
      await assert.rejects(client.query(migration), /M01 ownership preflight failed.*work_entries=1, pay_period_salaries=1/);
      await client.query("ROLLBACK");
      const unchanged = await client.query(`
        SELECT
          (SELECT count(*)::int FROM work_entries WHERE id = 7001 AND client_id = 999) AS orphan_entries,
          (SELECT count(*)::int FROM pay_period_salaries WHERE id = 7002 AND client_id = 998) AS orphan_salaries
      `);
      assert.deepEqual(unchanged.rows[0], { orphan_entries: 1, orphan_salaries: 1 });
      await assertTenantConstraintsRemoved(client);
    }, { clientForeignKeys: false });

    await withPublicSchemaClone(client, async () => {
      await client.query(`
        INSERT INTO users (username, password_salt, password_hash) VALUES
          ('public-a', 'synthetic-salt-a', 'synthetic-hash-a'),
          ('public-b', 'synthetic-salt-b', 'synthetic-hash-b');
        INSERT INTO clients (username, company_name) VALUES
          ('public-a', 'Synthetic public A'), ('public-b', 'Synthetic public B');
        INSERT INTO work_entries (username, client_id, work_date, arrival_time, departure_time, lunch_break_minutes, worked_minutes)
        SELECT 'public-a', id, '2026-10-20', '09:00', '17:00', 60, 420 FROM clients WHERE username = 'public-a';
        INSERT INTO pay_period_salaries (username, client_id, pay_period_month, salary_amount_cents)
        SELECT 'public-b', id, '2026-10', 200 FROM clients WHERE username = 'public-b';
      `);
      await client.query(migration);
      await client.query(migration);
      await assertTenantConstraints(client, { expectSupportingIndex: false });
      const counts = await client.query("SELECT (SELECT count(*)::int FROM work_entries) AS entries, (SELECT count(*)::int FROM pay_period_salaries) AS salaries");
      assert.deepEqual(counts.rows[0], { entries: 1, salaries: 1 });
    });

    await withFreshSchema(client, async () => {
      await client.query(referenceSchema);
      await client.query(`
        INSERT INTO users (username, password_salt, password_hash) VALUES
          ('fresh-a', 'synthetic-salt-a', 'synthetic-hash-a'),
          ('fresh-b', 'synthetic-salt-b', 'synthetic-hash-b');
        INSERT INTO clients (username, company_name) VALUES
          ('fresh-a', 'Synthetic A'), ('fresh-b', 'Synthetic B');
      `);
      const ids = await client.query("SELECT username, id FROM clients ORDER BY id");
      const idA = Number(ids.rows.find(row => row.username === "fresh-a").id);
      const idB = Number(ids.rows.find(row => row.username === "fresh-b").id);
      await client.query(`
        INSERT INTO work_entries (username, client_id, work_date, arrival_time, departure_time, lunch_break_minutes, worked_minutes)
        VALUES ('fresh-a', $1, '2026-10-20', '09:00', '17:00', 60, 420)
      `, [idA]);
      await assert.rejects(
        client.query(`
          INSERT INTO work_entries (username, client_id, work_date, arrival_time, departure_time, lunch_break_minutes, worked_minutes)
          VALUES ('fresh-a', $1, '2026-10-21', '09:00', '17:00', 60, 420)
        `, [idB]),
        error => error.code === "23503"
      );
      await assert.rejects(
        client.query("INSERT INTO pay_period_salaries (username, client_id, pay_period_month, salary_amount_cents) VALUES ('fresh-a', $1, '2026-10', 100)", [idB]),
        error => error.code === "23503"
      );
      const ownRows = await client.query("SELECT count(*)::int AS count FROM work_entries WHERE username = 'fresh-a'");
      assert.equal(ownRows.rows[0].count, 1);
      await assertTenantConstraints(client, { expectSupportingIndex: false });
    });
  } finally {
    client.release();
    await pool.end();
  }
});
