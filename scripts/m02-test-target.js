const assert = require("node:assert/strict");
const { postgresConnectionOptions } = require("../services/postgres-connection-options");
function parseTestTarget(env = process.env) {
  assert.ok(env.M02_TEST_DATABASE_URL, "M02_TEST_DATABASE_URL is required; DATABASE_URL is never used.");
  let url; try { url = new URL(env.M02_TEST_DATABASE_URL); } catch { throw new Error("Invalid synthetic test URL."); }
  postgresConnectionOptions(env.M02_TEST_DATABASE_URL);
  assert.equal(url.searchParams.has("options"), false, "Supply no startup options: the harness pins its own isolated search_path.");
  assert.equal(url.hash, "", "Fragments are not accepted.");
  const seen=new Set();
  for(const [name] of url.searchParams){assert.ok(["sslmode","channel_binding"].includes(name), "Only TLS connection parameters are accepted; host/database overrides are forbidden.");assert.ok(!seen.has(name), "Duplicate connection parameters are forbidden.");seen.add(name);}
  const database = decodeURIComponent(url.pathname.slice(1));
  if (env.M02_TEST_TARGET === "local-synthetic") {
    assert.ok(["localhost","127.0.0.1","[::1]"].includes(url.hostname), "Local synthetic target must be loopback.");
    assert.match(database, /^hours_m02_test_[a-z0-9_]+$/, "Local database name must start hours_m02_test_.");
    return { mode: "local", database, host: url.hostname };
  }
  assert.equal(env.M02_TEST_TARGET, "neon-branch-test", "Explicit M02_TEST_TARGET is required.");
  assert.match(url.hostname, /^ep-[a-z0-9-]+\.[a-z0-9.-]+\.neon\.tech$/, "Expected direct Neon endpoint.");
  assert.ok(!url.hostname.includes("-pooler."), "Use a direct endpoint.");
  assert.equal(database, "neondb", "Neon target database must be neondb.");
  for (const name of ["M02_NEON_API_KEY","M02_NEON_PROJECT_ID","M02_NEON_BRANCH_ID"]) assert.ok(env[name], name + " is required.");
  return { mode: "neon", database, host: url.hostname };
}
async function verifyTestTarget(env = process.env, fetchImpl = fetch) {
  const target = parseTestTarget(env);
  if (target.mode === "local") return target;
  async function get(route) {
    let response;
    try { response = await fetchImpl("https://console.neon.tech/api/v2" + route, {
      method: "GET", headers: { Authorization: "Bearer " + env.M02_NEON_API_KEY },
      redirect: "error", signal: AbortSignal.timeout(10000),
    }); } catch { throw new Error("Neon identity verification failed; no database connection was opened."); }
    assert.ok(response.ok, "Neon identity verification refused; no database connection was opened.");
    return response.json();
  }
  const projectId = encodeURIComponent(env.M02_NEON_PROJECT_ID), branchId = encodeURIComponent(env.M02_NEON_BRANCH_ID);
  const p = (await get("/projects/" + projectId)).project;
  assert.equal(p.id, env.M02_NEON_PROJECT_ID); assert.equal(p.name, "App_Hours", "Only App_Hours is authorized.");
  const b = (await get("/projects/" + projectId + "/branches/" + branchId)).branch;
  assert.equal(b.id, env.M02_NEON_BRANCH_ID); assert.equal(b.project_id, p.id);
  assert.equal(b.name, "Branch_Test", "Only synthetic Branch_Test is authorized; never production, backups or Branch_Test_M02.");
  const endpoints = (await get("/projects/" + projectId + "/endpoints")).endpoints;
  assert.ok(endpoints.some(e => e.branch_id === b.id && e.host === target.host && e.type === "read_write"), "URL is not the independently verified Branch_Test endpoint.");
  return target;
}
module.exports = { parseTestTarget, verifyTestTarget };
