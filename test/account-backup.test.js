const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const sandboxRoot=path.resolve(__dirname,"../tmp");
fs.mkdirSync(sandboxRoot,{recursive:true});
const sandbox=fs.mkdtempSync(path.join(sandboxRoot,"account-backup-test-"));
process.env.DB_PATH=path.join(sandbox,"auth.db");
const db=require("../db-sqlite");
const {envelope,validateBackup,digest,summary}=require("../services/account-backup");
const {createAccountBackupRouter}=require("../routes/account-backup");
function seed(user) {
  const client=db.createClient(user,{company_name:"Client fictif"});
  db.upsertWorkEntry(user,{client_id:client.id,work_date:"2026-10-02",day_type:"office",arrival_time:"09:00",departure_time:"17:00",lunch_break_minutes:60,worked_minutes:420,comment_text:"Test synthétique"});
  db.upsertPayPeriodSalary(user,{client_id:client.id,pay_period_month:"2026-10",salary_amount_cents:123400});
  db.upsertSettings(user,{workingDays:[1,2,4,5],defaultStartTime:"08:30"});
  return client;
}
test("full account round trip includes archives, salaries, settings and preserves other accounts",()=>{
  const client=seed("roundtrip");seed("other");
  const archived=db.createClient("roundtrip",{company_name:"Archive fictive"});db.archiveClient("roundtrip",archived.id);
  const before=db.getAccountSnapshot("roundtrip");
  const other=db.getAccountSnapshot("other");
  const backup=envelope("roundtrip",before);
  const data=validateBackup(JSON.parse(JSON.stringify(backup)),"roundtrip");
  let preserved;
  const after=db.restoreAccountSnapshot("roundtrip",data,digest(before),snapshot=>{preserved=snapshot;});
  assert.deepEqual(preserved,before);
  assert.deepEqual(summary(after),summary(before));
  assert.equal(after.work_entries[0].comment_text,"Test synthétique");
  assert.equal(after.pay_period_salaries[0].salary_amount_cents,123400);
  assert.deepEqual(after.settings.workingDays,[1,2,4,5]);
  assert.notEqual(after.clients[0].id,client.id);
  assert.deepEqual(db.getAccountSnapshot("other"),other);
});
test("invalid owner, duplicate dates and inconsistent hours are rejected",()=>{
  seed("validation");const backup=envelope("validation",db.getAccountSnapshot("validation"));
  assert.throws(()=>validateBackup(backup,"other"));
  const duplicate=structuredClone(backup);duplicate.data.work_entries.push(duplicate.data.work_entries[0]);
  assert.throws(()=>validateBackup(duplicate,"validation"));
  const invalid=structuredClone(backup);invalid.data.work_entries[0].worked_minutes=999;
  assert.throws(()=>validateBackup(invalid,"validation"));
});
test("stale preview and failed rollback snapshot cannot modify account",()=>{
  seed("stale");const before=db.getAccountSnapshot("stale");
  const data=validateBackup(envelope("stale",before),"stale");
  db.upsertSettings("stale",{defaultPause:45});
  const current=db.getAccountSnapshot("stale");
  assert.throws(()=>db.restoreAccountSnapshot("stale",data,digest(before),()=>assert.fail("must not write backup")),/changé/);
  assert.throws(()=>db.restoreAccountSnapshot("stale",data,digest(current),()=>{throw Error("disk full");}),/disk full/);
  assert.deepEqual(db.getAccountSnapshot("stale"),current);
});
test("transaction rolls back every table if an insert fails",()=>{
  seed("rollback");const before=db.getAccountSnapshot("rollback");
  const invalid=structuredClone(before);invalid.work_entries[0].lunch_break_minutes=-1;
  assert.throws(()=>db.restoreAccountSnapshot("rollback",invalid,digest(before),()=>{}));
  assert.deepEqual(db.getAccountSnapshot("rollback"),before);
});
test("backup routes require authentication, preview before restore, and return verified downloadable files",async()=>{
  seed("routes");
  const app=express();app.use(express.json());app.use((req,res,next)=>{req.authUser=req.get("test-user");next();});
  app.use(createAccountBackupRouter(db,path.join(sandbox,"backups")));
  const server=app.listen(0,"127.0.0.1");await new Promise(resolve=>server.once("listening",resolve));
  const request=async(route,body,user="routes")=>{
    const response=await fetch(`http://127.0.0.1:${server.address().port}/${route}`,{method:body?"POST":"GET",headers:{"Content-Type":"application/json",...(user?{"test-user":user}:{})},...(body?{body:JSON.stringify(body)}:{})});
    return {status:response.status,data:await response.json()};
  };
  try {
    assert.equal((await request("status",null,"")).status,401);
    assert.equal((await request("restore",{confirm:"RESTAURER",token:"bad"})).status,409);
    const created=await request("create",{});assert.equal(created.status,200);
    const saved=await request(`download/${created.data.name}`);assert.equal(saved.status,200);
    assert.equal(saved.data.data.work_entries.length,1);
    assert.equal(JSON.stringify(saved.data).includes("password_hash"),false);
    assert.equal((await request("preview",{backup:saved.data},"other")).status,400);
    const preview=await request("preview",{backup:saved.data});assert.equal(preview.status,200);
    const restore=await request("restore",{token:preview.data.token,confirm:"RESTAURER"});assert.equal(restore.status,200);
    assert.equal((await request("restore",{token:preview.data.token,confirm:"RESTAURER"})).status,409);
    const status=await request("status");assert.equal(status.data.backups.length,2);assert.ok(status.data.backups.some(b=>b.rollback));
  } finally {await new Promise(resolve=>server.close(resolve));}
});


test("real page renders new controls and all inline scripts parse; prefill is account scoped and backup POSTs require CSRF",async()=>{
  process.env.ACCOUNT_BACKUP_DIR=path.join(sandbox,"http-backups");
  delete process.env.DATABASE_URL;
  process.env.NODE_ENV="test";
  const username="page-fixture";
  db.createUser({username,password_salt:"fixture",password_hash:"fixture",recovery_code_salt:null,recovery_code_hash:null});
  const client=seed(username);
  const token="a".repeat(64);
  db.upsertSession({token,username,expires_at_ms:Date.now()+60000});
  const {app}=require("../server");
  const server=app.listen(0,"127.0.0.1");await new Promise(resolve=>server.once("listening",resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    const response=await fetch(`${base}/?clientId=${client.id}&month=2026-10`,{headers:{cookie:`hours_session=${token}`}});
    assert.equal(response.status,200);
    const html=await response.text();
    assert.ok(html.includes('data-go-today'));
    assert.ok(html.includes('data-entry-prefill="last"'));
    assert.ok(html.includes('data-account-backup'));
    const vm=require("node:vm");
    for(const match of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
      if(!match[1].includes('application/json') && !match[1].includes('src=')) new vm.Script(match[2]);
    }
    const csrfCookie=response.headers.getSetCookie().find(value=>value.startsWith("hours_csrf="))?.split(";")[0];
    const csrf=csrfCookie.split("=")[1];
    const cookie=`hours_session=${token}; ${csrfCookie}`;
    const prefill=await fetch(`${base}/api/entries/last-worked?clientId=${client.id}&beforeDate=2026-10-05`,{headers:{cookie}});
    assert.equal(prefill.status,200);assert.equal((await prefill.json()).entry.arrival_time,"09:00");
    const foreign=await fetch(`${base}/api/entries/last-worked?clientId=999999&beforeDate=2026-10-05`,{headers:{cookie}});
    assert.equal(foreign.status,404);
    const denied=await fetch(`${base}/account-backup/create`,{method:"POST",headers:{cookie,"Content-Type":"application/json"},body:"{}"});
    assert.equal(denied.status,403);
    const exported=await fetch(`${base}/account-backup/create`,{method:"POST",headers:{cookie,"Content-Type":"application/json"},body:JSON.stringify({_csrf:csrf})});
    assert.equal(exported.status,200);
  } finally {await new Promise(resolve=>server.close(resolve));}
});
