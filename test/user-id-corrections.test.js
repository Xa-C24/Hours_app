const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const {createRequire}=require("node:module");
const Database=require("better-sqlite3");
const {ensureUsersIdentitySchema:ensure}=require("../services/user-identity-sqlite");
const fixed="f8ef48ef-177f-4f99-ae76-2e825c519b11";
function fixture(ids=[fixed,null],withIdentity=true){
  const db=new Database(":memory:");db.pragma("foreign_keys=ON");
  db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY,"+(withIdentity?"user_id TEXT,":"")+"username TEXT NOT NULL UNIQUE,password_salt TEXT,password_hash TEXT,recovery_code_salt TEXT,recovery_code_hash TEXT,recovery_code_expires_at_ms INTEGER,created_at TEXT,updated_at TEXT);CREATE TABLE sessions(token TEXT,username TEXT,expires_at_ms INTEGER,created_at TEXT,updated_at TEXT)");
  ids.forEach((id,i)=>db.prepare("INSERT INTO users VALUES (?,"+(withIdentity?"?,":"")+"?,'s','h','rs','rh',1600000000000,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')").run(...[i+1,...(withIdentity?[id]:[]),"synthetic-"+i]));
  return db;
}
function rows(db){return db.prepare("SELECT * FROM users ORDER BY id").all();}
function insert(db,id,name="synthetic-new"){return db.prepare("INSERT INTO users(user_id,username) VALUES (?,?)").run(id,name);}
function importApi(){
  const filename=path.resolve(__dirname,"../scripts/migrate-sqlite-to-postgres.js");
  const context={require:createRequire(filename),module:{exports:{}},__dirname:path.dirname(filename),process:{env:{}}};
  vm.runInNewContext(fs.readFileSync(filename,"utf8")+"\nmodule.exports.auditMigrateUsers=migrateUsers;",context,{filename});
  return context.module.exports;
}
test("M02 corrections: strict SQL format rejects invalid separators, hex, whitespace, NULL and BLOB",()=>{
  const db=fixture([fixed]);try{
    ensure(db);
    for(const id of [null,"",fixed.replaceAll("-",""),fixed+" ",fixed+"\n",fixed+"\0suffix",fixed.replace("f","g"),"00000000-0000-0000-0000-00000000000-",Buffer.from(fixed)]){
      assert.throws(()=>insert(db,id),/UUID/);
    }
    assert.equal(rows(db).length,1);assert.equal(rows(db)[0].user_id,fixed);
  }finally{db.close();}
});
test("M02 corrections: assignment is immutable even across case, NULL and INSERT OR REPLACE",()=>{
  const db=fixture([fixed]);try{
    ensure(db);const before=rows(db);
    for(const id of [null,fixed.toUpperCase(),"00000000-0000-0000-0000-000000000000"]){
      assert.throws(()=>db.prepare("UPDATE users SET user_id=? WHERE id=1").run(id),/immutable|UUID/);
    }
    db.prepare("UPDATE users SET user_id=user_id WHERE id=1").run();
    assert.throws(()=>db.prepare("INSERT OR REPLACE INTO users(id,user_id,username) VALUES (1,?,'synthetic-0')").run("00000000-0000-0000-0000-000000000000"),/replacement|UNIQUE/);
    assert.throws(()=>db.prepare("INSERT OR REPLACE INTO users(user_id,username) VALUES (?,'other-synthetic')").run(fixed.toUpperCase()),/replacement|UNIQUE/);
    assert.deepEqual(rows(db),before);
  }finally{db.close();}
});
test("M02 corrections: installed protections missing or downgraded fail closed without changing UUIDs",()=>{
  for(const sql of [
    "DROP INDEX users_user_id_unique_idx",
    "DROP TRIGGER users_user_id_immutable",
    "DROP TRIGGER users_user_id_update_guard",
    "DROP TRIGGER users_user_id_replace_guard",
    "DROP INDEX users_user_id_unique_idx; CREATE UNIQUE INDEX users_user_id_unique_idx ON users(user_id)",
    "DROP TRIGGER users_user_id_immutable; CREATE TRIGGER users_user_id_immutable BEFORE UPDATE ON users BEGIN SELECT 1; END",
  ]){
    const db=fixture([fixed]);try{
      ensure(db);const before=rows(db);db.exec(sql);assert.throws(()=>ensure(db),/protection/);assert.deepEqual(rows(db),before);
    }finally{db.close();}
  }
});
test("M02 corrections: historical case-folded duplicates and expression indexes are refused atomically",()=>{
  for(const expression of [false,true]){
    const db=fixture(expression?[fixed,null]:[fixed,fixed.toUpperCase(),null]);try{
      if(expression)db.exec("CREATE UNIQUE INDEX users_user_id_unique_idx ON users(lower(user_id))");
      const before=rows(db);assert.throws(()=>ensure(db),/duplicate|index/);assert.deepEqual(rows(db),before);
      assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name='hours_user_identity_schema'").get().n,0);
    }finally{db.close();}
  }
});
test("M02 corrections: known V1 protection upgrade preserves UUID spelling, credentials and expiration",()=>{
  const db=fixture([fixed.toUpperCase(),null]);try{
    db.exec("CREATE UNIQUE INDEX users_user_id_unique_idx ON users(user_id)");
    db.exec("CREATE TRIGGER users_user_id_immutable BEFORE UPDATE OF user_id ON users WHEN OLD.user_id IS NOT NEW.user_id BEGIN SELECT RAISE(ABORT, 'users.user_id is immutable'); END");
    const before=rows(db);ensure(db);const after=rows(db);
    assert.equal(after[0].user_id,fixed.toUpperCase());
    for(let i=0;i<after.length;i++){const {user_id,...rest}=after[i];const {user_id:old,...prior}=before[i];assert.deepEqual(rest,prior);}
    assert.match(after[1].user_id,/^[a-f0-9-]{36}$/);
    assert.throws(()=>insert(db,fixed),/UNIQUE/);
    ensure(db);assert.deepEqual(rows(db),after);
  }finally{db.close();}
});
test("M02 corrections: initial DDL/backfill interruption and a silently ignored UPDATE both roll back",()=>{
  for(const action of ["SELECT RAISE(ABORT,'synthetic interruption')","SELECT RAISE(IGNORE)"]){
    const db=fixture([null,null],false);try{
      db.exec("CREATE TRIGGER synthetic_interrupt BEFORE UPDATE ON users WHEN OLD.id=2 BEGIN "+action+"; END");
      const before=rows(db);assert.throws(()=>ensure(db),/synthetic interruption|incomplete/);assert.deepEqual(rows(db),before);
      assert.equal(db.prepare("PRAGMA table_info(users)").all().some(c=>c.name==="user_id"),false);
      db.exec("DROP TRIGGER synthetic_interrupt");ensure(db);const assigned=rows(db);ensure(db);assert.deepEqual(rows(db),assigned);
    }finally{db.close();}
  }
});
test("M02 corrections: rollback can create multiple NULL accounts, then assigns each identity only once",()=>{
  const db=fixture([fixed]);try{
    ensure(db);db.exec("DROP TRIGGER users_user_id_insert_guard");
    insert(db,null,"old-version-a");insert(db,null,"old-version-b");
    assert.throws(()=>db.prepare("UPDATE users SET user_id=NULL WHERE id=1").run(),/immutable|UUID/);
    assert.throws(()=>db.prepare("UPDATE users SET user_id='invalid' WHERE username='old-version-a'").run(),/UUID/);
    ensure(db);const assigned=rows(db);assert.equal(assigned[0].user_id,fixed);
    assert.equal(new Set(assigned.map(r=>r.user_id.toLowerCase())).size,3);
    assert.throws(()=>insert(db,null,"missing-after-resume"),/UUID/);
    ensure(db);assert.deepEqual(rows(db),assigned);
  }finally{db.close();}
});
test("M02 corrections: unexpected NULL, empty, duplicate source UUIDs or invalid expiration fail before INSERT",async()=>{
  const api=importApi();
  for(const ids of [[null],[""],[fixed+"\n"],[fixed,fixed.toUpperCase()]]){
    const db=fixture(ids);let calls=0;try{
      const before=rows(db);await assert.rejects(api.auditMigrateUsers(db,{async query(){calls++;}}),/missing|malformed|conflicting/);
      assert.equal(calls,0);assert.deepEqual(rows(db),before);
    }finally{db.close();}
  }
  const db=fixture([fixed]);try{
    db.exec("UPDATE users SET recovery_code_expires_at_ms='invalid'");let calls=0;
    await assert.rejects(api.auditMigrateUsers(db,{async query(){calls++;}}),/expiration/);assert.equal(calls,0);
  }finally{db.close();}
});
test("M02 corrections: true legacy import generates UUIDs; a missing M02 column never does",async()=>{
  const api=importApi(),db=fixture([null],false);try{
    let parameters;await api.auditMigrateUsers(db,{async query(sql,p){parameters=p;}});
    assert.match(parameters[0],/^[a-f0-9-]{36}$/);assert.equal(parameters[8],1600000000000);
    db.exec("CREATE TABLE hours_user_identity_schema(singleton INTEGER,version INTEGER)");
    await assert.rejects(api.auditMigrateUsers(db,{async query(){assert.fail("must refuse before INSERT");}}),/unexpectedly absent/);
  }finally{db.close();}
});
test("M02 corrections: import keeps uppercase UUID and zero/NULL expiration exactly",async()=>{
  const api=importApi(),db=fixture([fixed.toUpperCase()]);try{
    for(const expiry of [0,null,1600000000000]){
      db.prepare("UPDATE users SET recovery_code_expires_at_ms=?").run(expiry);
      let parameters;await api.auditMigrateUsers(db,{async query(sql,p){parameters=p;}});
      assert.equal(parameters[0],fixed.toUpperCase());assert.equal(parameters[8],expiry);
    }
  }finally{db.close();}
});
test("M02 corrections: destination UUID conflict is checked before import and rolls back",async()=>{
  const api=importApi(),db=fixture([fixed]),calls=[];let lookup;
  const connection={async query(sql,params){
    calls.push(sql);
    if(sql.startsWith("SELECT source_key"))return {rowCount:0,rows:[]};
    if(sql.startsWith("SELECT count(*)::int AS count FROM users")){lookup={sql,params};return {rows:[{count:1}]};}
    return {rows:[],rowCount:0};
  },release(){}};
  try{
    await assert.rejects(api.runMigration({sqlite:db,pool:{async connect(){return connection;}},sourceIdentity:"synthetic-conflicting-uuid"}),/UUIDs conflict/);
    assert.match(lookup.sql,/user_id = ANY\(\$2::uuid\[\]\)/);assert.equal(lookup.params[1][0],fixed);
    assert.ok(calls.includes("ROLLBACK"));assert.ok(!calls.some(sql=>sql.includes("INSERT INTO users")));assert.ok(!calls.includes("COMMIT"));
  }finally{db.close();}
});


test("M02 corrections: emitted PostgreSQL preflight keeps SQL delimiters and rolls back before backfill on type refusal",async()=>{
  const sqlMigration=fs.readFileSync(path.resolve(__dirname,"../migrations/002_user_id.sql"),"utf8");
  const expected=/DO \$\$\s+BEGIN[\s\S]*?M02 identity preflight failed[\s\S]*?\$\$;/.exec(sqlMigration);
  assert.ok(expected,"standalone type preflight must have balanced dollar quoting");
  for(const [relative,entry] of [["../db-postgres.js","initializeDatabase"],["../scripts/migrate-sqlite-to-postgres.js","ensurePgSchema"]]){
    for(const refuse of [false,true]){
      const calls=[],filename=path.resolve(__dirname,relative),realRequire=createRequire(filename);
      const connection={async query(sql){
        calls.push(sql);
        if(refuse&&sql.includes("M02 identity preflight failed"))throw new Error("synthetic wrong column type");
        return {rows:[],rowCount:0};
      },release(){}};
      class Pool {async connect(){return connection;}async end(){}}
      const context={
        require(name){if(name==="pg")return {Pool};return realRequire(name);},
        module:{exports:{}},__dirname:path.dirname(filename),
        process:{env:{DATABASE_URL:"postgresql://synthetic:synthetic@localhost/synthetic"}}
      };
      vm.runInNewContext(fs.readFileSync(filename,"utf8")+"\nmodule.exports.auditInitialize="+entry+";",context,{filename});
      if(refuse)await assert.rejects(context.module.exports.auditInitialize(),/synthetic wrong column type/);
      else await context.module.exports.auditInitialize();
      const guard=calls.find(sql=>sql.includes("M02 identity preflight failed"));
      assert.equal(guard,expected[0]);
      if(refuse){
        assert.ok(calls.includes("ROLLBACK"));assert.ok(!calls.includes("COMMIT"));
        assert.ok(!calls.some(sql=>/UPDATE users SET user_id/.test(sql)));
      }
    }
  }
});
test("M02 corrections: duplicate username retains the registration conflict diagnostic",()=>{
  const db=fixture([fixed]);try{
    ensure(db);
    assert.throws(()=>insert(db,"00000000-0000-0000-0000-000000000000","synthetic-0"),/UNIQUE constraint failed: users.username/);
    assert.equal(rows(db)[0].user_id,fixed);
  }finally{db.close();}
});

test("M02 corrections: a legacy NOCASE column cannot allow UUID case mutation",()=>{
  const db=new Database(":memory:");try{
    db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY,user_id TEXT COLLATE NOCASE,username TEXT UNIQUE)");
    db.prepare("INSERT INTO users VALUES(1,?,'synthetic')").run(fixed);
    ensure(db);
    assert.throws(()=>db.prepare("UPDATE users SET user_id=? WHERE id=1").run(fixed.toUpperCase()),/immutable/);
    assert.equal(db.prepare("SELECT user_id FROM users").get().user_id,fixed);
  }finally{db.close();}
});

test("M02 corrections: a historical UUID with a trailing newline is refused without normalization",()=>{
  const db=fixture([fixed+"\n",null]);try{
    const before=rows(db);
    assert.throws(()=>ensure(db),/malformed/);
    assert.deepEqual(rows(db),before);
  }finally{db.close();}
});

test("M02 corrections: SQL definition checks preserve case-sensitive string literals",()=>{
  const db=fixture([fixed]);try{
    ensure(db);
    const definition=db.prepare("SELECT sql FROM sqlite_schema WHERE name='users_user_id_insert_guard'").get().sql;
    db.exec("DROP TRIGGER users_user_id_insert_guard");
    db.exec(definition.replace("'text'","'TEXT'"));
    assert.throws(()=>ensure(db),/unexpected identity trigger definition/);
    assert.equal(rows(db)[0].user_id,fixed);
  }finally{db.close();}
});
