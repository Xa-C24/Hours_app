const test = require("node:test");
const assert = require("node:assert/strict");
const { parseTestTarget, verifyTestTarget } = require("../scripts/m02-test-target");
const env = { M02_TEST_TARGET:"neon-branch-test", M02_TEST_DATABASE_URL:"postgresql://synthetic:synthetic@ep-fixture.region.aws.neon.tech/neondb?sslmode=require", M02_NEON_API_KEY:"synthetic-not-a-key", M02_NEON_PROJECT_ID:"fixture", M02_NEON_BRANCH_ID:"fixture-branch" };
test("M02 target guard refuses ambient DATABASE_URL and arbitrary local/remote databases", () => {
  assert.throws(() => parseTestTarget({ DATABASE_URL:env.M02_TEST_DATABASE_URL }));
  assert.throws(() => parseTestTarget({ M02_TEST_TARGET:"local-synthetic", M02_TEST_DATABASE_URL:"postgres://u:p@localhost/production" }));
  assert.throws(() => parseTestTarget({ M02_TEST_TARGET:"local-synthetic", M02_TEST_DATABASE_URL:"postgres://u:p@remote.example/hours_m02_test_fixture" }));
  assert.throws(() => parseTestTarget({ ...env,M02_TEST_DATABASE_URL:env.M02_TEST_DATABASE_URL+"&host=forbidden.example" }));
  assert.throws(() => parseTestTarget({ ...env,M02_TEST_DATABASE_URL:env.M02_TEST_DATABASE_URL+"&database=production" }));
  assert.equal(parseTestTarget({ M02_TEST_TARGET:"local-synthetic", M02_TEST_DATABASE_URL:"postgres://u:p@127.0.0.1/hours_m02_test_fixture" }).mode,"local");
});
test("M02 target guard rejects poolers, startup options and insecure remote TLS", () => {
  assert.throws(() => parseTestTarget({ ...env,M02_TEST_DATABASE_URL:env.M02_TEST_DATABASE_URL.replace("ep-fixture.","ep-fixture-pooler.") }));
  assert.throws(() => parseTestTarget({ ...env,M02_TEST_DATABASE_URL:env.M02_TEST_DATABASE_URL+"&options=x" }));
  assert.throws(() => parseTestTarget({ ...env,M02_TEST_DATABASE_URL:env.M02_TEST_DATABASE_URL.replace("sslmode=require","sslmode=disable") }));
});
test("M02 Neon guard refuses protected branches before any database connection", async () => {
  for (const name of ["production","Backup_production_20261022_1536","Branch_Test_M02"]) {
    const mock=async url=>({ok:true,json:async()=>String(url).endsWith("/projects/fixture")?{project:{id:"fixture",name:"App_Hours"}}:{branch:{id:"fixture-branch",project_id:"fixture",name}}});
    await assert.rejects(verifyTestTarget(env,mock),/Only synthetic Branch_Test/);
  }
});
test("M02 Neon guard independently binds project, branch and exact endpoint using GET only", async () => {
  const calls=[]; const mock=async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>String(url).endsWith("/endpoints")?{endpoints:[{branch_id:"fixture-branch",host:"ep-fixture.region.aws.neon.tech",type:"read_write"}]}:String(url).endsWith("/projects/fixture")?{project:{id:"fixture",name:"App_Hours"}}:{branch:{id:"fixture-branch",project_id:"fixture",name:"Branch_Test"}}};};
  assert.equal((await verifyTestTarget(env,mock)).mode,"neon"); assert.equal(calls.length,3);
  assert.ok(calls.every(c=>c.options.method==="GET"&&c.options.redirect==="error"&&!c.url.includes(env.M02_NEON_API_KEY)));
});
