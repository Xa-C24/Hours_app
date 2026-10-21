const path = require("node:path");

function safeErrorSummary(error) {
  const summary = {};
  const name = typeof error?.name === "string" ? error.name : "Error";
  summary.name = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(name) ? name : "Error";

  if (typeof error?.code === "string" && /^[A-Za-z0-9_-]{1,48}$/.test(error.code)) {
    summary.code = error.code;
  }
  if (Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599) {
    summary.status = error.status;
  }

  const frames = typeof error?.stack === "string" ? error.stack.split("\n").slice(1) : [];
  summary.frames = frames.slice(0, 5).flatMap((frame) => {
    const match = frame.match(/^\s*at (?:(.*?) \()?(.+?):(\d+):(\d+)\)?$/);
    if (!match) return [];
    const functionName = match[1] && /^[A-Za-z0-9_$.[\]<>-]{1,100}$/.test(match[1])
      ? match[1]
      : undefined;
    const file = path.basename(match[2]);
    if (!/^[A-Za-z0-9_.-]{1,100}$/.test(file)) return [];
    return [{
      ...(functionName ? { function: functionName } : {}),
      file,
      line: Number(match[3]),
      column: Number(match[4]),
    }];
  });
  return summary;
}

function logSafeError(event, error, logger = console.error) {
  const safeEvent = /^[a-z0-9_.-]{1,64}$/i.test(event) ? event : "server_error";
  logger(JSON.stringify({ level: "error", event: safeEvent, error: safeErrorSummary(error) }));
}

function logSecurityEvent(event, details = {}, logger = console.warn) {
  const safeEvent = /^[a-z0-9_.-]{1,64}$/i.test(event) ? event : "security_event";
  const action = details && typeof details === "object" ? details.action : undefined;
  const safeAction = typeof action === "string" && /^[a-z0-9_.-]{1,64}$/i.test(action)
    ? action
    : undefined;
  logger(JSON.stringify({
    level: "warn",
    event: safeEvent,
    ...(safeAction ? { action: safeAction } : {}),
    at: new Date().toISOString(),
  }));
}

function createHealthCheckHandler(db, options = {}) {
  const uptime = options.uptime || (() => process.uptime());
  const now = options.now || (() => new Date());
  const fallbackEngine = options.fallbackEngine || (() => "unknown");
  const logError = options.logError || ((event, error) => logSafeError(event, error));

  return async function healthCheckHandler(req, res) {
    try {
      const database = typeof db?.healthCheck === "function"
        ? await db.healthCheck()
        : { ok: false, engine: "unknown" };
      const isOk = Boolean(database && database.ok);
      return res.status(isOk ? 200 : 503).json({
        ok: isOk,
        process: { ok: true, uptime_seconds: Math.floor(uptime()) },
        database: { ok: isOk, engine: database.engine || "unknown" },
        checked_at: now().toISOString(),
      });
    } catch (error) {
      logError("health_check_failed", error);
      return res.status(503).json({
        ok: false,
        process: { ok: true, uptime_seconds: Math.floor(uptime()) },
        database: { ok: false, engine: fallbackEngine() },
        error: "database_unavailable",
        checked_at: now().toISOString(),
      });
    }
  };
}

function installGracefulShutdown({
  server,
  closeResources = async () => {},
  processObject = process,
  timeoutMs = 10_000,
  forceExitGraceMs = 1_000,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  forceExit = (code) => process.exit(code),
  logger = console,
} = {}) {
  if (!server || typeof server.close !== "function") {
    throw new TypeError("An HTTP server is required for graceful shutdown.");
  }

  let shutdownPromise = null;
  let closeResourcesPromise = null;
  const closeResourcesOnce = () => {
    if (!closeResourcesPromise) {
      closeResourcesPromise = Promise.resolve()
        .then(() => closeResources())
        .catch((error) => {
          logSafeError("shutdown_resource_close_failed", error, logger.error.bind(logger));
          processObject.exitCode = 1;
        });
    }
    return closeResourcesPromise;
  };

  function shutdown(signal) {
    if (shutdownPromise) return shutdownPromise;

    shutdownPromise = new Promise((resolve) => {
      let settled = false;
      let hardTimer;
      let forceTimer;
      let forced = false;
      let connectionsClosed = false;
      const closeRemainingConnections = () => {
        if (connectionsClosed) return;
        connectionsClosed = true;
        try {
          if (typeof server.closeAllConnections === "function") server.closeAllConnections();
        } catch (error) {
          logSafeError("shutdown_connection_close_failed", error, logger.error.bind(logger));
        }
      };
      const finish = async () => {
        if (settled) return;
        settled = true;
        if (hardTimer) clearTimer(hardTimer);
        if (forceTimer) clearTimer(forceTimer);
        await closeResourcesOnce();
        resolve({ forced: false });
      };
      const force = () => {
        if (forced) return;
        forced = true;
        if (hardTimer) clearTimer(hardTimer);
        if (forceTimer) clearTimer(forceTimer);
        closeRemainingConnections();
        if (!settled) {
          settled = true;
          resolve({ forced: true });
        }
        void closeResourcesOnce();
        forceExit(1);
      };

      logger.info(JSON.stringify({ level: "info", event: "shutdown_started", signal }));
      hardTimer = setTimer(() => {
        logger.error(JSON.stringify({ level: "error", event: "shutdown_timeout", timeout_ms: timeoutMs }));
        closeRemainingConnections();
        forceTimer = setTimer(force, forceExitGraceMs);
        void closeResourcesOnce().then(() => {
          if (!forced) {
            if (forceTimer) clearTimer(forceTimer);
            force();
          }
        });
      }, timeoutMs);

      try {
        server.close((error) => {
          if (error) logSafeError("http_server_close_failed", error, logger.error.bind(logger));
          void finish();
        });
      } catch (error) {
        logSafeError("http_server_close_failed", error, logger.error.bind(logger));
        void finish();
      }
    });

    return shutdownPromise;
  }

  const onSigterm = () => { void shutdown("SIGTERM"); };
  const onSigint = () => { void shutdown("SIGINT"); };
  processObject.on("SIGTERM", onSigterm);
  processObject.on("SIGINT", onSigint);

  return {
    shutdown,
    dispose() {
      processObject.off("SIGTERM", onSigterm);
      processObject.off("SIGINT", onSigint);
    },
  };
}

module.exports = {
  createHealthCheckHandler,
  installGracefulShutdown,
  logSafeError,
  logSecurityEvent,
  safeErrorSummary,
};
