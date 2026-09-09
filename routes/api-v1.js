const express = require("express");

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

function sendSuccess(res, data) {
  return res.json({ ok: true, data });
}

function sendError(res, status, code, message) {
  return res.status(status).json({
    ok: false,
    error: { code, message },
  });
}

function serializeClient(client) {
  return {
    id: client.id,
    companyName: client.company_name,
    companyLogo: client.company_logo || "",
  };
}

function createApiV1Router({
  authenticateCredentials,
  createMobileAuthToken,
  getClientSelection,
  getMonthData,
  getMobileAuthTokenByHash,
  getUserByUsername,
  hashMobileAuthToken,
  normalizeClientId,
  rateLimitLoginAttempt,
  revokeMobileAuthToken,
  serializeMonthDataForApi,
  touchMobileAuthToken,
}) {
  const router = express.Router();

  async function requireApiAuth(req, res, next) {
    const authorization = req.get("authorization");
    if (!authorization) {
      if (req.authUser) {
        req.apiAuthUser = req.authUser;
        req.apiAuthMode = "session";
        return next();
      }
      return sendError(res, 401, "UNAUTHENTICATED", "Authentication required");
    }
    const match = /^Bearer ([A-Za-z0-9_-]+)$/i.exec(authorization);
    if (!match) {
      return sendError(res, 401, "UNAUTHENTICATED", "Authentication required");
    }
    try {
      const tokenHash = hashMobileAuthToken(match[1]);
      const token = await getMobileAuthTokenByHash(tokenHash);
      if (!token || token.revoked_at || token.expires_at_ms <= Date.now()) {
        return sendError(res, 401, "UNAUTHENTICATED", "Authentication required");
      }
      const user = await getUserByUsername(token.username);
      if (!user) {
        return sendError(res, 401, "UNAUTHENTICATED", "Authentication required");
      }
      await touchMobileAuthToken(tokenHash);
      req.apiAuthUser = user.username;
      req.apiAuthMode = "bearer";
      req.apiAuthTokenHash = tokenHash;
      return next();
    } catch (error) {
      return next(error);
    }
  }

  router.get("/health", (req, res) => res.json({ ok: true, api: "v1" }));

  router.post("/auth/login", async (req, res, next) => {
    const rateLimit = rateLimitLoginAttempt(req);
    if (!rateLimit.allowed) {
      return sendError(res, 429, "RATE_LIMITED", "Too many login attempts");
    }
    const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    try {
      const user = await authenticateCredentials(username, password);
      if (!user) {
        return sendError(res, 401, "INVALID_CREDENTIALS", "Invalid username or password");
      }
      const token = await createMobileAuthToken(user.username);
      return sendSuccess(res, { token: token.token, expiresAt: token.expiresAt, user: { username: user.username } });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/auth/logout", requireApiAuth, async (req, res, next) => {
    if (req.apiAuthMode !== "bearer") {
      return sendError(res, 401, "UNAUTHENTICATED", "Authentication required");
    }
    try {
      await revokeMobileAuthToken(req.apiAuthTokenHash);
      return sendSuccess(res, { loggedOut: true });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/me", requireApiAuth, (req, res) => {
    return sendSuccess(res, {
      user: {
        username: req.apiAuthUser,
      },
    });
  });

  router.get("/clients", requireApiAuth, async (req, res, next) => {
    try {
      const { clients } = await getClientSelection(req.apiAuthUser, null);
      return sendSuccess(res, { clients: clients.map(serializeClient) });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/calendar", requireApiAuth, async (req, res, next) => {
    const rawMonth = typeof req.query.month === "string" ? req.query.month.trim() : "";
    const requestedClientId = normalizeClientId(req.query.clientId);

    if (!MONTH_PATTERN.test(rawMonth)) {
      return sendError(res, 400, "INVALID_MONTH", "A valid month is required");
    }
    if (req.query.clientId !== undefined && !requestedClientId) {
      return sendError(res, 400, "INVALID_CLIENT", "A valid client is required");
    }

    try {
      const { selectedClient } = await getClientSelection(req.apiAuthUser, requestedClientId);
      if (!selectedClient) {
        return sendError(res, 404, "CLIENT_NOT_FOUND", "Client not found");
      }
      if (requestedClientId && selectedClient.id !== requestedClientId) {
        return sendError(res, 404, "CLIENT_NOT_FOUND", "Client not found");
      }

      const monthData = await getMonthData(req.apiAuthUser, selectedClient.id, rawMonth);
      return sendSuccess(res, {
        client: serializeClient(selectedClient),
        calendar: serializeMonthDataForApi(rawMonth, selectedClient.id, monthData),
      });
    } catch (error) {
      return next(error);
    }
  });

  router.use((req, res) => sendError(res, 404, "NOT_FOUND", "API endpoint not found"));

  router.use((error, req, res, next) => {
    console.error("API v1 error", error);
    return sendError(res, 500, "INTERNAL_ERROR", "An unexpected error occurred");
  });

  return router;
}

module.exports = { createApiV1Router };
