function postgresConnectionOptions(connectionString) {
  let url;
  try { url = new URL(connectionString); } catch (_) { throw new Error("Invalid PostgreSQL connection URL."); }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("Invalid PostgreSQL URL protocol.");
  const local = ["localhost", "127.0.0.1", "[::1]", "host.docker.internal"].includes(url.hostname);
  // pg connection-string TLS options can override the explicit ssl object.
  // Reject those overrides instead of silently weakening verification.
  for (const [name, value] of url.searchParams) {
    if (name.toLowerCase().startsWith("ssl")) {
      if (name !== "sslmode" || !["require", "verify-ca", "verify-full"].includes(value)) {
        throw new Error("Unsupported PostgreSQL TLS option. Use verified TLS and NODE_EXTRA_CA_CERTS for a private CA.");
      }
    }
  }
  const explicitTls = url.searchParams.has("sslmode");
  url.searchParams.delete("sslmode");
  return { connectionString: url.toString(), ssl: local && !explicitTls ? false : { rejectUnauthorized: true } };
}
module.exports = { postgresConnectionOptions };
