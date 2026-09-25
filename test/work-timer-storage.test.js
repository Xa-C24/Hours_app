const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Database = require("better-sqlite3");

test("SQLite timer writes are atomic, isolated per account and retain stopped state", () => {
  const connections = [];
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "db-sqlite.js"), "utf8"), {
    module, __dirname: path.join(__dirname, ".."), process: { env: {}, cwd: () => __dirname },
    require(name) {
      if (name === "fs") return { mkdirSync() {}, existsSync: () => false };
      if (name === "better-sqlite3") return function () {
        const connection = new Database(":memory:");
        connections.push(connection);
        return connection;
      };
      return require(name);
    },
  });
  try {
    const db = module.exports;
    for (const username of ["alice", "bob"]) {
      connections[0].prepare("INSERT INTO users (username, password_salt, password_hash, created_at, updated_at) VALUES (?, 'test', 'test', 'test', 'test')").run(username);
    }
    const running = { start: 1000, end: null, pausedAt: null, pauseMs: 0, clientId: "1" };
    assert.equal(db.saveWorkTimer("alice", 0, running).version, 1);
    assert.equal(db.saveWorkTimer("alice", 0, running), null);
    assert.equal(db.getWorkTimer("bob").state, null);
    assert.equal(db.saveWorkTimer("alice", 1, { ...running, end: 2000 }).version, 2);
    assert.equal(db.saveWorkTimer("alice", 1, running), null);
    assert.equal(db.getWorkTimer("alice").state.end, 2000);
    assert.throws(() => db.saveWorkTimer("unknown-user", 0, running), /FOREIGN KEY/);
  } finally { connections.forEach(connection => connection.close()); }
});
