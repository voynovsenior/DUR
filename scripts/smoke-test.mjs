const base = (process.env.DUR_SMOKE_BASE_URL ?? "").trim().replace(/\/+$/, "");
if (!base) {
  throw new Error("Set DUR_SMOKE_BASE_URL to the deployed HTTPS origin");
}
const parsed = new URL(base);
if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
  throw new Error("Smoke tests require HTTPS except for localhost");
}

const checks = [
  ["/healthz", body => typeof body.ok === "boolean" || typeof body.status === "string"],
  ["/v1/status", body => typeof body === "object" && body !== null],
  ["/v1/issuers", body => Array.isArray(body.issuers)],
  ["/v1/schemas", body => Array.isArray(body.schemas)],
  ["/v1/indexer/status", body => typeof body === "object" && body !== null],
];

let failed = 0;
for (const [path, validate] of checks) {
  try {
    const response = await fetch(`${base}${path}`, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    if (!validate(body)) throw new Error("unexpected_response_shape");
    process.stdout.write(`PASS ${path}\n`);
  } catch (error) {
    failed++;
    process.stderr.write(`FAIL ${path}: ${error instanceof Error ? error.message : "unknown_error"}\n`);
  }
}
if (failed > 0) process.exitCode = 1;
