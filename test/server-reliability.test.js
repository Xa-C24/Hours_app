const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const {
  createHealthCheckHandler,
  installGracefulShutdown,
  logSafeError,
  logSecurityEvent,
} = require("../services/server-reliability");

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function fakeTimers() {
  const timers = [];
  return {
    timers,
    setTimer(callback, delay) {
      const timer = { callback, delay, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer(timer) { timer.cleared = true; },
  };
}

function silentLogger() {
  return { info() {}, warn() {}, error() {} };
}

test("health check preserves the healthy response contract", async () => {
  const handler = createHealthCheckHandler(
    { async healthCheck() { return { ok: true, engine: "postgres" }; } },
    { uptime: () => 42.8, now: () => new Date("2026-10-21T10:00:00.000Z") }
  );
  const res = responseRecorder();

  await handler({}, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    ok: true,
    process: { ok: true, uptime_seconds: 42 },
    database: { ok: true, engine: "postgres" },
    checked_at: "2026-10-21T10:00:00.000Z",
  });
});

test("health check reports degraded database and unavailable errors without details", async () => {
  const degraded = responseRecorder();
  await createHealthCheckHandler(
    { async healthCheck() { return { ok: false, engine: "sqlite" }; } },
    { uptime: () => 1, now: () => new Date(0) }
  )({}, degraded);
  assert.equal(degraded.statusCode, 503);
  assert.equal(degraded.body.database.ok, false);
  assert.equal(degraded.body.database.engine, "sqlite");

  const unavailable = responseRecorder();
  const loggedErrors = [];
  const databaseError = new Error("postgresql://user:secret@host/db customer@example.test");
  databaseError.code = "ECONNREFUSED";
  await createHealthCheckHandler(
    { async healthCheck() { throw databaseError; } },
    {
      uptime: () => 2,
      now: () => new Date(0),
      fallbackEngine: () => "postgres",
      logError: (event, error) => logSafeError(event, error, (line) => loggedErrors.push(line)),
    }
  )({}, unavailable);
  assert.equal(unavailable.statusCode, 503);
  assert.equal(unavailable.body.error, "database_unavailable");
  assert.equal(JSON.stringify(unavailable.body).includes("secret"), false);
  assert.equal(JSON.stringify(unavailable.body).includes("customer@example.test"), false);
  assert.match(loggedErrors[0], /ECONNREFUSED/);
  assert.equal(loggedErrors[0].includes("secret"), false);
  assert.equal(loggedErrors[0].includes("customer@example.test"), false);
});

test("health check without a database probe fails closed", async () => {
  const res = responseRecorder();
  await createHealthCheckHandler({}, { uptime: () => 0, now: () => new Date(0) })({}, res);
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body.database, { ok: false, engine: "unknown" });
});

test("graceful shutdown drains in-flight requests and closes resources once", async () => {
  const processObject = new EventEmitter();
  const timers = fakeTimers();
  let closeCallback;
  let closeCalls = 0;
  let resourceCloseCalls = 0;
  const server = { close(callback) { closeCalls += 1; closeCallback = callback; } };
  const controller = installGracefulShutdown({
    server,
    closeResources: async () => { resourceCloseCalls += 1; },
    processObject,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    logger: silentLogger(),
    forceExit() { assert.fail("normal shutdown must not force exit"); },
  });

  processObject.emit("SIGTERM");
  processObject.emit("SIGINT");
  assert.equal(closeCalls, 1);
  assert.equal(resourceCloseCalls, 0);
  assert.equal(timers.timers[0].delay, 10_000);

  closeCallback();
  await controller.shutdown("SIGTERM");
  assert.equal(resourceCloseCalls, 1);
  assert.equal(timers.timers[0].cleared, true);
  controller.dispose();
});

test("graceful shutdown handles unavailable resources and repeated calls", async () => {
  const processObject = new EventEmitter();
  const timers = fakeTimers();
  let closeCalls = 0;
  const server = { close(callback) { closeCalls += 1; callback(); } };
  const controller = installGracefulShutdown({
    server,
    processObject,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    logger: silentLogger(),
    forceExit() { assert.fail("normal shutdown must not force exit"); },
  });

  const first = controller.shutdown("SIGTERM");
  const second = controller.shutdown("SIGINT");
  assert.equal(first, second);
  await first;
  assert.equal(closeCalls, 1);
  controller.dispose();
});

test("a resource close failure is contained and marks the process for failure", async () => {
  const processObject = new EventEmitter();
  const timers = fakeTimers();
  const errors = [];
  const controller = installGracefulShutdown({
    server: { close(callback) { callback(); } },
    closeResources: async () => { throw new Error("connection string contains password=secret"); },
    processObject,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    logger: { info() {}, warn() {}, error(line) { errors.push(line); } },
    forceExit() { assert.fail("normal close failure must not force exit"); },
  });

  await controller.shutdown("SIGTERM");
  assert.equal(processObject.exitCode, 1);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].includes("secret"), false);
  controller.dispose();
});

test("shutdown deadline drops remaining connections, closes resources and exits nonzero", async () => {
  const processObject = new EventEmitter();
  const timers = fakeTimers();
  let closeAllCalls = 0;
  let resourceCloseCalls = 0;
  const exitCodes = [];
  const server = {
    close() {},
    closeAllConnections() { closeAllCalls += 1; },
  };
  const controller = installGracefulShutdown({
    server,
    closeResources: async () => { resourceCloseCalls += 1; },
    processObject,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    forceExit: (code) => exitCodes.push(code),
    logger: silentLogger(),
  });

  const shutdown = controller.shutdown("SIGTERM");
  timers.timers.find((timer) => timer.delay === 10_000).callback();
  await shutdown;
  await Promise.resolve();

  assert.equal(closeAllCalls, 1);
  assert.equal(resourceCloseCalls, 1);
  assert.deepEqual(exitCodes, [1]);
  controller.dispose();
});

test("shutdown forcibly exits if resource cleanup itself does not finish", async () => {
  const processObject = new EventEmitter();
  const timers = fakeTimers();
  let closeAllCalls = 0;
  const exitCodes = [];
  const server = { close() {}, closeAllConnections() { closeAllCalls += 1; } };
  const controller = installGracefulShutdown({
    server,
    closeResources: () => new Promise(() => {}),
    processObject,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    forceExit: (code) => exitCodes.push(code),
    logger: silentLogger(),
  });

  controller.shutdown("SIGTERM");
  timers.timers.find((timer) => timer.delay === 10_000).callback();
  timers.timers.find((timer) => timer.delay === 1_000).callback();

  assert.equal(closeAllCalls, 1);
  assert.deepEqual(exitCodes, [1]);
  controller.dispose();
});

test("safe error logs retain diagnostic codes and frames without messages or secrets", () => {
  const lines = [];
  const error = new Error("password=hunter2 token=abc customer@example.test SELECT * FROM clients");
  error.code = "ECONNREFUSED";
  logSafeError("api_v1_request_failed", error, (line) => lines.push(line));

  const output = lines.join("\n");
  assert.match(output, /ECONNREFUSED/);
  assert.match(output, /server-reliability\.test\.js/);
  for (const secret of ["hunter2", "abc", "customer@example.test", "SELECT * FROM clients", "password="]) {
    assert.equal(output.includes(secret), false);
  }
});

test("security event logs omit usernames, IP addresses and tokens", () => {
  const lines = [];
  logSecurityEvent("rate_limit_reached", {
    action: "login",
    username: "synthetic-user",
    ip: "192.0.2.10",
    token: "synthetic-token",
  }, (line) => lines.push(line));

  assert.equal(lines.length, 1);
  assert.match(lines[0], /rate_limit_reached/);
  assert.match(lines[0], /login/);
  for (const value of ["synthetic-user", "192.0.2.10", "synthetic-token"]) {
    assert.equal(lines[0].includes(value), false);
  }
});
