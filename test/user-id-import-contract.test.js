const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const {createRequire}=require("node:module");
const Database=require("better-sqlite3");
const fixed="f8ef48ef-177f-4f99-ae76-2e825c519b11",expiry=1600000000000;
async function captureImport(id=fixed) {
  const filename=path.resolve(__dirname,"../scripts/migrate-sqlite-to-postgres.js");
  const sandbox={require:createRequire(filename),module:{exports:{}},__dirname:path.dirname(filename),process:{env:{}}};
  // Expose the actual private function only inside this VM; the source file is unchanged.
  vm.runInNewContext(fs.readFileSync(filename,"utf8")+"\nmodule.exports.auditMigrateUsers=migrateUsers;",sandbox,{filename});
  const sqlite=new Database(":memory:");
  try{
    sqlite.exec("CREATE TABLE users(id INTEGER PRIMARY KEY,user_id TEXT,username TEXT,password_salt TEXT,password_hash TEXT,recovery_code_salt TEXT,recovery_code_hash TEXT,recovery_code_expires_at_ms INTEGER,created_at TEXT,updated_at TEXT);CREATE TABLE sessions(token TEXT,username TEXT,expires_at_ms INTEGER,created_at TEXT,updated_at TEXT)");
    sqlite.prepare("INSERT INTO users VALUES (1,?,'synthetic','s','h','rs','rh',?,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')").run(id,expiry);
    let bound;
    await sandbox.module.exports.auditMigrateUsers(sqlite,{async query(sql,params){
      const columns=/INSERT INTO users\s*\(([\s\S]*?)\)\s*VALUES/i.exec(sql)[1].split(",").map(x=>x.trim());
      bound=Object.fromEntries(columns.map((column,index)=>[column,params[index]]));return {rows:[],rowCount:1};
    }});
    return bound;
  }finally{sqlite.close();}
}
test("M02 import audit: actual import bindings preserve an existing SQLite UUID",async()=>{
  assert.equal((await captureImport()).user_id,fixed,"Existing UUID must be preserved");
});
test("M02 import audit: actual import rejects a malformed existing source UUID",async()=>{
  await assert.rejects(captureImport("not-a-uuid"),/malformed/i);
});
test("M02 import audit: actual import preserves recovery-code expiration",async()=>{
  assert.equal((await captureImport()).recovery_code_expires_at_ms,expiry,"Import must not turn an expired recovery code into a non-expiring legacy code");
});

