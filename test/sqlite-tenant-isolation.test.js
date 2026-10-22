const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const sqlitePath = path.resolve(__dirname, "..", "db-sqlite.js");

test("SQLite tenant stores keep clients, entries, settings and timers account-local", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hours-m01-tenant-"));
  const previousDbPath = process.env.DB_PATH;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousModule = require.cache[sqlitePath];
  process.env.DB_PATH = path.join(root, "auth.sqlite");
  delete process.env.DATABASE_URL;
  delete require.cache[sqlitePath];
  const db = require(sqlitePath);

  try {
    for (const username of ["m01-alice", "m01-bob"]) {
      db.createUser({
        username,
        password_salt: "synthetic-salt",
        password_hash: "synthetic-hash",
        recovery_code_salt: null,
        recovery_code_hash: null,
        recovery_code_expires_at_ms: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      db.ensureUserDatabase(username);
    }

    const aliceClient = db.createClient("m01-alice", { company_name: "Synthetic Alice Client" });
    const bobClient = db.createClient("m01-bob", { company_name: "Synthetic Bob Client" });
    const entry = (client, date, comment) => ({
      client_id: client.id,
      work_date: date,
      day_type: "office",
      arrival_time: "09:00",
      departure_time: "17:00",
      lunch_break_minutes: 60,
      worked_minutes: 420,
      comment_text: comment,
    });
    db.upsertWorkEntry("m01-alice", entry(aliceClient, "2026-10-20", "Alice synthetic entry"));
    db.upsertWorkEntry("m01-bob", entry(bobClient, "2026-10-20", "Bob synthetic entry"));
    db.upsertPayPeriodSalary("m01-alice", { client_id: aliceClient.id, pay_period_month: "2026-10", salary_amount_cents: 111 });
    db.upsertPayPeriodSalary("m01-bob", { client_id: bobClient.id, pay_period_month: "2026-10", salary_amount_cents: 222 });
    db.upsertSettings("m01-alice", { theme: "light", dailyGoal: 420 });
    db.upsertSettings("m01-bob", { theme: "dark", dailyGoal: 360 });
    db.saveWorkTimer("m01-alice", 0, { start: 1, end: null, pausedAt: null, pauseMs: 0 });
    db.saveWorkTimer("m01-bob", 0, { start: 2, end: null, pausedAt: null, pauseMs: 0 });

    assert.equal(db.getClientById("m01-alice", aliceClient.id).company_name, "Synthetic Alice Client");
    assert.equal(db.getClientById("m01-bob", bobClient.id).company_name, "Synthetic Bob Client");
    assert.equal(db.getWorkEntryByDate("m01-alice", aliceClient.id, "2026-10-20").comment_text, "Alice synthetic entry");
    assert.equal(db.getWorkEntryByDate("m01-bob", bobClient.id, "2026-10-20").comment_text, "Bob synthetic entry");
    assert.equal(db.getPayPeriodSalary("m01-alice", aliceClient.id, "2026-10"), 111);
    assert.equal(db.getPayPeriodSalary("m01-bob", bobClient.id, "2026-10"), 222);
    assert.equal(db.getSettings("m01-alice").theme, "light");
    assert.equal(db.getSettings("m01-bob").theme, "dark");
    assert.equal(db.getWorkTimer("m01-alice").state.start, 1);
    assert.equal(db.getWorkTimer("m01-bob").state.start, 2);

    db.updateClient("m01-alice", aliceClient.id, { company_name: "Alice Updated" });
    assert.equal(db.getClientById("m01-bob", bobClient.id).company_name, "Synthetic Bob Client");
    db.deleteWorkEntry("m01-alice", aliceClient.id, "2026-10-20");
    assert.equal(db.getWorkEntryByDate("m01-alice", aliceClient.id, "2026-10-20"), null);
    assert.equal(db.getWorkEntryByDate("m01-bob", bobClient.id, "2026-10-20").comment_text, "Bob synthetic entry");
    db.deleteClient("m01-alice", aliceClient.id);
    assert.equal(db.getClientById("m01-alice", aliceClient.id), null);
    assert.equal(db.getClientById("m01-bob", bobClient.id).company_name, "Synthetic Bob Client");
  } finally {
    db.close();
    delete require.cache[sqlitePath];
    if (previousModule) require.cache[sqlitePath] = previousModule;
    if (previousDbPath === undefined) delete process.env.DB_PATH;
    else process.env.DB_PATH = previousDbPath;
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
