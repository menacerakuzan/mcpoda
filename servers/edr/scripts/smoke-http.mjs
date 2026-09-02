import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

/**
 * Raises the HTTP server and talks to it the way a stranger's assistant
 * would. Runs with no index present on purpose: a deployment with no index
 * yet is the expected first-day state, not a failure, and the tools have to
 * say index_unavailable rather than crash.
 *
 * The "no index" path only holds if the path genuinely doesn't exist, so
 * this uses a fresh temp directory every run rather than a fixed path — a
 * fixed path let a previous run's database (openDatabase() creates the file
 * it opens) leak into the next one and silently flip the test green for the
 * wrong reason.
 */

const scratch = mkdtempSync(join(tmpdir(), "proyav-edr-smoke-"));
const emptyDbPath = join(scratch, "does-not-exist.sqlite");

const PORT = 8792;
const child = spawn("node", ["dist/serve.js"], {
  env: { ...process.env, PORT: String(PORT), RATE_LIMIT: "5", PROYAV_EDR_DB: emptyDbPath },
  stdio: ["ignore", "ignore", "inherit"],
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const base = `http://127.0.0.1:${PORT}`;

let failed = false;
const check = (ok, label) => {
  console.log(`${ok ? "✓" : "✖"} ${label}`);
  if (!ok) failed = true;
};

try {
  for (let i = 0; i < 30; i++) {
    try {
      await fetch(`${base}/health`);
      break;
    } catch {
      await wait(200);
    }
  }

  const health = await (await fetch(`${base}/health`)).json();
  check(health.status === "ok", "health відповідає");
  check(health.index === null, "health чесно каже про відсутність індексу");

  const client = new Client({ name: "smoke-http", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));

  const { tools } = await client.listTools();
  const names = new Set(tools.map((t) => t.name));
  const required = ["proyav_edr_company", "proyav_edr_shared_people"];
  const missing = required.filter((n) => !names.has(n));
  check(missing.length === 0, `інструменти на місці (${tools.length}), бракує: ${missing.join(", ") || "нічого"}`);

  const result = await client.callTool({
    name: "proyav_edr_company",
    arguments: { edrpou: "12345678" },
  });
  const payload = JSON.parse(result.content[0].text);
  check(payload.error === "index_unavailable", "без індексу віддає index_unavailable, а не падає");

  await client.close();
} finally {
  child.kill();
  rmSync(scratch, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
