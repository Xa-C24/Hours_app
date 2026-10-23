const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const { Pool, Client } = require("pg");
const Database = require("better-sqlite3");
const { verifyTestTarget } = require("../scripts/m02-test-target");
const { postgresConnectionOptions } = require("../services/postgres-connection-options");
const root = path.resolve(__dirname, "..");
const migration = fs.readFileSync(path.join(root,"migrations/002_user_id.sql"),"utf8");
const referenceSchema = fs.readFileSync(path.join(root,"schema.sql"),"utf8");
const enabled = ["M02_TEST_DATABASE_URL","M02_TEST_TARGET","M02_NEON_API_KEY","M02_NEON_PROJECT_ID","M02_NEON_BRANCH_ID"].some(k=>process.env[k]);
const fixed = "f8ef48ef-177f-4f99-ae76-2e825c519b11";
const second = "7da88567-70e5-4c45-836b-304e164e7180";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const tables = ["users","clients","work_entries","pay_period_salaries","settings","sessions","mobile_auth_tokens","work_timers"];
function options(schema) {
  assert.match(schema,/^m02_uuid_[a-f0-9]{32}$/);
  return { ...postgresConnectionOptions(process.env.M02_TEST_DATABASE_URL), max:2,
    connectionTimeoutMillis:10000, statement_timeout:15000, lock_timeout:3000,
    options:"-c search_path="+schema+",pg_catalog" };
}
async function connect(client) {
  try { await client.connect(); } catch { throw new Error("Synthetic PostgreSQL connection unavailable; connection details suppressed."); }
}
async function fresh(client, legacy=false) {
  await client.query(referenceSchema);
  await client.query("CREATE TABLE work_timers (username TEXT PRIMARY KEY REFERENCES users(username) ON DELETE CASCADE,version INTEGER NOT NULL,state_json TEXT NOT NULL)");
  if(legacy) await client.query("DROP TRIGGER users_user_id_immutable ON users; ALTER TABLE users DROP COLUMN user_id");
}
async function seed(client) {
  await client.query("INSERT INTO users (username,password_salt,password_hash) VALUES ('synthetic-a','salt-a','hash-a'),('synthetic-b','salt-b','hash-b')");
  await client.query("INSERT INTO clients (id,username,company_name) VALUES (101,'synthetic-a','Synthetic A'),(202,'synthetic-b','Synthetic B')");
  await client.query("INSERT INTO work_entries (username,client_id,work_date,arrival_time,departure_time,lunch_break_minutes,worked_minutes) VALUES ('synthetic-a',101,'2026-01-01','09:00','17:00',60,420),('synthetic-b',202,'2026-01-01','09:00','17:00',60,420)");
  await client.query("INSERT INTO pay_period_salaries (username,client_id,pay_period_month,salary_amount_cents) VALUES ('synthetic-a',101,'2026-01',100),('synthetic-b',202,'2026-01',200)");
  await client.query("INSERT INTO sessions (token,username,expires_at_ms) VALUES ('synthetic-session','synthetic-a',2000000000000)");
  await client.query("INSERT INTO mobile_auth_tokens (token_hash,username,expires_at_ms) VALUES ('synthetic-token-hash','synthetic-b',2000000000000)");
  await client.query("INSERT INTO settings (username,key,value) VALUES ('synthetic-a','theme','\"premium\"'),('synthetic-b','theme','\"robot\"')");
  await client.query("INSERT INTO work_timers VALUES ('synthetic-a',7,'{\"clientId\":\"101\"}')");
}
async function snapshot(client) {
  const result={};
  for(const table of tables) {
    const columns=table==="users"?"id,username,password_salt,password_hash,recovery_code_salt,recovery_code_hash,recovery_code_expires_at_ms,created_at,updated_at":"*";
    // Fixed table allowlist; only the freshly created synthetic schema is visible.
    result[table]=(await client.query("SELECT "+columns+" FROM "+table+" ORDER BY username")).rows;
  }
  return result;
}
async function identities(client) {
  return (await client.query("SELECT username,user_id FROM users ORDER BY username")).rows;
}
async function realModule(relative,schema,run) {
  const filename=path.join(root,relative),previousModule=require.cache[filename],previousUrl=process.env.DATABASE_URL;
  const original=Module._load;let api;
  try {
    process.env.DATABASE_URL=process.env.M02_TEST_DATABASE_URL;delete require.cache[filename];
    class IsolatedPool extends Pool { constructor(config){super({...config,...options(schema)});} }
    Module._load=function(name,parent,isMain) {
      if(name==="pg"&&parent?.filename===filename)return {Pool:IsolatedPool};
      return original.call(this,name,parent,isMain);
    };
    try { api=require(filename); } finally { Module._load=original; }
    return await run(api);
  } finally {
    Module._load=original;
    try { if(api?.close)await api.close(); } finally {
      delete require.cache[filename];if(previousModule)require.cache[filename]=previousModule;
      if(previousUrl===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=previousUrl;
    }
  }
}

test("M02 real PostgreSQL integration: synthetic schemas only, independently verified target", {skip:!enabled}, async t=>{
  const target=await verifyTestTarget(); // No pg connection before this independent check.
  const admin=new Client({...postgresConnectionOptions(process.env.M02_TEST_DATABASE_URL),connectionTimeoutMillis:10000,statement_timeout:15000});
  await connect(admin);
  const created=new Set();
  try {
    await admin.query("SET default_transaction_read_only=on");
    const info=(await admin.query("SELECT current_database() AS name,current_setting('server_version_num')::int AS version")).rows[0];
    assert.equal(info.name,target.database); assert.ok(info.version>=130000,"PostgreSQL 13+ required.");
    await admin.query("SET default_transaction_read_only=off");
    async function isolated(run) {
      const schema="m02_uuid_"+crypto.randomUUID().replace(/-/g,"");
      assert.equal((await admin.query("SELECT to_regnamespace($1) AS existing",[schema])).rows[0].existing,null);
      await admin.query('CREATE SCHEMA "'+schema+'"'); created.add(schema);
      const pool=new Pool(options(schema)); let client;
      try {
        try { client=await pool.connect(); } catch { throw new Error("Synthetic schema connection unavailable; details suppressed."); }
        assert.equal((await client.query("SELECT current_schema() AS name")).rows[0].name,schema);
        await run({client,pool,schema});
      } finally {
        if(client){await client.query("ROLLBACK").catch(()=>{});client.release();}
        await pool.end();
        assert.ok(created.has(schema)&&/^m02_uuid_[a-f0-9]{32}$/.test(schema));
        await admin.query('DROP SCHEMA "'+schema+'" CASCADE');created.delete(schema);
      }
    }
    await t.test("legacy backfill is idempotent, UUIDs immutable and M01 data/relations preserved",()=>isolated(async({client})=>{
      await fresh(client,true);await seed(client);
      const before=await snapshot(client);
      await client.query(migration); const first=await identities(client);
      assert.equal(new Set(first.map(x=>x.user_id)).size,2);first.forEach(x=>assert.match(x.user_id,uuid));
      assert.deepEqual(await snapshot(client),before);
      await client.query(migration);assert.deepEqual(await identities(client),first);
      await assert.rejects(client.query("UPDATE users SET user_id=gen_random_uuid() WHERE username='synthetic-a'"),e=>e.code==="22000");
      await client.query("UPDATE users SET user_id=user_id WHERE username='synthetic-a'");
      await assert.rejects(client.query("INSERT INTO users(user_id,username,password_salt,password_hash) VALUES ($1,'synthetic-duplicate','s','h')",[first[0].user_id]),e=>e.code==="23505");
      await assert.rejects(client.query("INSERT INTO users(user_id,username,password_salt,password_hash) VALUES ('not-a-uuid','synthetic-invalid','s','h')"),e=>e.code==="22P02");
      await assert.rejects(client.query("INSERT INTO users(user_id,username,password_salt,password_hash) VALUES (NULL,'synthetic-null','s','h')"),e=>e.code==="23502");
      const generated=(await client.query("INSERT INTO users(username,password_salt,password_hash) VALUES ('synthetic-default','s','h') RETURNING user_id")).rows[0].user_id;assert.match(generated,uuid);
      await assert.rejects(client.query("INSERT INTO work_entries(username,client_id,work_date,arrival_time,departure_time,lunch_break_minutes,worked_minutes) VALUES ('synthetic-a',202,'2026-01-02','09:00','17:00',60,420)"),e=>e.code==="23503");
      await assert.rejects(client.query("INSERT INTO pay_period_salaries(username,client_id,pay_period_month,salary_amount_cents) VALUES ('synthetic-a',202,'2026-02',100)"),e=>e.code==="23503");
      const constraints=(await client.query("SELECT conname,convalidated FROM pg_constraint WHERE conrelid IN ('work_entries'::regclass,'pay_period_salaries'::regclass) AND conname IN ('work_entries_owner_client_fk','pay_period_salaries_owner_client_fk')")).rows;
      assert.equal(constraints.length,2);assert.ok(constraints.every(c=>c.convalidated));
    }));
    await t.test("existing UUID survives partial backfill and repeated migration",()=>isolated(async({client})=>{
      await fresh(client,true);await seed(client);await client.query("ALTER TABLE users ADD COLUMN user_id UUID");
      await client.query("UPDATE users SET user_id=$1 WHERE username='synthetic-a'",[fixed]);
      await client.query(migration);assert.equal((await identities(client))[0].user_id,fixed);
      const before=await identities(client);await client.query(migration);assert.deepEqual(await identities(client),before);
    }));
    await t.test("duplicate legacy UUIDs fail atomically without changing NULL or assigned values",()=>isolated(async({client})=>{
      await fresh(client,true);await seed(client);await client.query("ALTER TABLE users ADD COLUMN user_id UUID");
      await client.query("UPDATE users SET user_id=$1",[fixed]);
      await client.query("INSERT INTO users(username,password_salt,password_hash) VALUES ('synthetic-null','s','h')");
      const before=await identities(client);
      await assert.rejects(client.query(migration),e=>e.code==="23505");await client.query("ROLLBACK");
      assert.deepEqual(await identities(client),before);
    }));
    await t.test("wrong-type historical column with invalid values must not be silently accepted",()=>isolated(async({client})=>{
      await fresh(client,true);await seed(client);await client.query("ALTER TABLE users ADD COLUMN user_id TEXT");
      await client.query("UPDATE users SET user_id='not-a-uuid' WHERE username='synthetic-a'");
      const before=await identities(client);await assert.rejects(client.query(migration),"A TEXT column with malformed IDs must stop the migration.");
      await client.query("ROLLBACK");assert.deepEqual(await identities(client),before);
    }));
    await t.test("connection loss before COMMIT rolls back DDL/backfill and permits retry",()=>isolated(async({client,schema})=>{
      await fresh(client,true);await seed(client);
      const interrupted=new Client(options(schema));await connect(interrupted);
      try { await interrupted.query(migration.replace(/COMMIT;\s*$/,"")); } finally {await interrupted.end();}
      const column=(await client.query("SELECT count(*)::int AS count FROM information_schema.columns WHERE table_schema=$1 AND table_name='users' AND column_name='user_id'",[schema])).rows[0].count;
      assert.equal(column,0);await client.query(migration);
      const before=await identities(client);await client.query(migration);assert.deepEqual(await identities(client),before);
    }));
    await t.test("real PostgreSQL adapter generates/preserves UUIDs and reruns initialization",()=>isolated(async({client,schema})=>{
      await realModule("db-postgres.js",schema,async db=>{
        await db.createUser({username:"synthetic-auto",password_salt:"s",password_hash:"h"});
        await db.createUser({username:"synthetic-explicit",user_id:fixed,password_salt:"s",password_hash:"h"});
      });
      const before=await identities(client);assert.match(before[0].user_id,uuid);assert.equal(before[1].user_id,fixed);
      await realModule("db-postgres.js",schema,async db=>{await db.ensureUserDatabase();});
      assert.deepEqual(await identities(client),before);
    }));
    await t.test("real SQLite import preserves UUIDs, M01 associations and restarts after rollback",importTest=>isolated(async({client,pool,schema})=>{
      await fresh(client);
      const temporary=fs.mkdtempSync(path.join(os.tmpdir(),"hours-m02-pg-source-")),file=path.join(temporary,"auth.sqlite");
      const previousPath=process.env.SQLITE_DB_PATH;process.env.SQLITE_DB_PATH=file;
      const sqlite=new Database(file);
      sqlite.exec("CREATE TABLE users(id INTEGER PRIMARY KEY,user_id TEXT,username TEXT,password_salt TEXT,password_hash TEXT,recovery_code_salt TEXT,recovery_code_hash TEXT,recovery_code_expires_at_ms INTEGER,created_at TEXT,updated_at TEXT); CREATE TABLE sessions(token TEXT,username TEXT,expires_at_ms INTEGER,created_at TEXT,updated_at TEXT);CREATE TABLE work_timers(username TEXT,version INTEGER,state_json TEXT)");
      for(const [i,id] of [fixed,second].entries())sqlite.prepare("INSERT INTO users VALUES (?,?,?,?,?,?,?,?,?,?)").run(i+1,id,"source-"+i,"s","h",null,null,2000000000000,"2026-01-01T00:00:00Z","2026-01-01T00:00:00Z");
      try {
        await realModule("scripts/migrate-sqlite-to-postgres.js",schema,async importer=>{
          await importer.ensurePgSchema();await importer.ensurePgSchema();
          for(const username of ["source-0","source-1"]){
            const userFile=importer.getUserDbPath(username);fs.mkdirSync(path.dirname(userFile),{recursive:true});const db=new Database(userFile);
            try {
              for(const [table,columns]of Object.entries(importer.USER_DB_REQUIREMENTS)){
                db.exec('CREATE TABLE "'+table+'" (id INTEGER PRIMARY KEY,'+columns.map(c=>'"'+c+'" '+(c==='client_id'?'INTEGER':'TEXT')).join(",")+")");
              }
              db.exec("INSERT INTO clients(id,company_name,contact_name,email,phone,address,notes,company_logo,created_at) VALUES (7,'Synthetic Client','','','','','','','2026-01-01T00:00:00Z')");
              db.exec("INSERT INTO work_entries(id,client_id,work_date,day_type,arrival_time,departure_time,lunch_break_minutes,worked_minutes,comment_text,created_at,updated_at) VALUES (1,7,'2026-01-01','office','09:00','17:00',60,420,'synthetic','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')");
              db.exec("INSERT INTO pay_period_salaries(id,client_id,pay_period_month,salary_amount_cents,created_at,updated_at) VALUES (1,7,'2026-01',100,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')");
              db.exec("INSERT INTO settings(id,key,value,updated_at) VALUES (1,'theme','\"premium\"','2026-01-01T00:00:00Z')");
            }finally{db.close();}
            sqlite.prepare("INSERT INTO work_timers VALUES (?,7,?)").run(username,JSON.stringify({clientId:"7"}));
          }
          sqlite.prepare("INSERT INTO sessions VALUES ('synthetic-session','source-0',2000000000000,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')").run();
          await assert.rejects(importer.runMigration({sqlite,pool,sourceIdentity:"synthetic-m02",onStage:stage=>{if(stage==="before-commit")throw new Error("synthetic interruption");}}),/synthetic interruption/);
          assert.equal((await client.query("SELECT count(*)::int AS count FROM users")).rows[0].count,0);
          await importer.runMigration({sqlite,pool,sourceIdentity:"synthetic-m02"});
          await importTest.test("SQLite UUIDs are preserved by the real import",async()=>{assert.deepEqual(await identities(client),[{username:"source-0",user_id:fixed},{username:"source-1",user_id:second}]);});
          assert.equal((await importer.runMigration({sqlite,pool,sourceIdentity:"synthetic-m02"})).alreadyMigrated,true);
          const owners=(await client.query("SELECT w.username,c.username AS owner FROM work_entries w JOIN clients c ON c.id=w.client_id ORDER BY w.username")).rows;assert.equal(owners.length,2);assert.ok(owners.every(row=>row.username===row.owner));
          const timers=(await client.query("SELECT t.username,t.state_json,c.id FROM work_timers t JOIN clients c ON t.username=c.username ORDER BY t.username")).rows;assert.equal(timers.length,2);assert.ok(timers.every(row=>JSON.parse(row.state_json).clientId===String(row.id)));
          await importTest.test("SQLite import also preserves recovery-code expiration",async()=>{
            const rows=(await client.query("SELECT recovery_code_expires_at_ms FROM users ORDER BY username")).rows;
            assert.ok(rows.every(row=>Number(row.recovery_code_expires_at_ms)===2000000000000),"Recovery-code expiration must not be discarded.");
          });
        });
      }finally{sqlite.close();if(previousPath===undefined)delete process.env.SQLITE_DB_PATH;else process.env.SQLITE_DB_PATH=previousPath;fs.rmSync(temporary,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
    }));
  }finally{
    // Only names generated and recorded by this invocation may be dropped.
    for(const schema of created){assert.match(schema,/^m02_uuid_[a-f0-9]{32}$/);await admin.query('DROP SCHEMA "'+schema+'" CASCADE');}
    await admin.end();
  }
});

