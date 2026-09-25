const test = require('node:test');
const assert = require('node:assert/strict');
const { postgresConnectionOptions: options } = require('../services/postgres-connection-options');
const { createEntryDraftStore } = require('../public/entry-draft-store');
test('remote PostgreSQL always verifies TLS, including require mode', () => {
  for (const host of ['db.example.test', 'localhost.example.test']) {
    for (const query of ['', '?sslmode=require', '?sslmode=verify-full']) {
      const config = options(`postgresql://demo:localhost@${host}/test${query}`);
      assert.deepEqual(config.ssl, {rejectUnauthorized:true});
      assert.equal(new URL(config.connectionString).searchParams.has('sslmode'), false);
    }
  }
});
test('only exact local hosts can use plaintext by default', () => {
  assert.equal(options('postgresql://localhost/test').ssl, false);
  assert.equal(options('postgresql://[::1]/test').ssl, false);
  assert.deepEqual(options('postgresql://localhost/test?sslmode=require').ssl, {rejectUnauthorized:true});
});
test('TLS bypass options are rejected without disclosing connection secrets', () => {
  for (const query of ['sslmode=disable','sslmode=no-verify','ssl=false','sslcert=/tmp/cert']) {
    assert.throws(() => options(`postgresql://demo:private-value@db.example.test/test?${query}`), e => !e.message.includes('private-value') && /TLS/.test(e.message));
  }
});
test('two accounts cannot restore or delete each other drafts or claim legacy drafts', () => {
  const values = new Map();
  const storage = {getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
  const a=createEntryDraftStore(storage,'alice');
  const b=createEntryDraftStore(storage,'bob');
  const payload={clientId:'1',workDate:'2026-09-24',commentText:'Private draft'};
  createEntryDraftStore(storage).set(payload);
  assert.equal(a.get('1',payload.workDate),null);
  a.set(payload);
  assert.equal(b.get('1',payload.workDate),null);
  b.remove('1',payload.workDate);
  assert.equal(a.get('1',payload.workDate).commentText,payload.commentText);
});
test('PostgreSQL selection does not initialize SQLite', () => {
  const fs=require('node:fs');
  const vm=require('node:vm');
  const loaded=[];
  vm.runInNewContext(fs.readFileSync(require.resolve('../db'),'utf8'), {process:{env:{DATABASE_URL:'postgresql://example.test/test'}},module:{exports:{}},require:name=>{loaded.push(name);return {};}});
  assert.deepEqual(loaded,['./db-postgres']);
});
