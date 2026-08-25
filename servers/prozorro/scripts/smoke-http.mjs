import { spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

/** Raises the HTTP server and talks to it the way a stranger's assistant would. */

const PORT = 8788;
const child = spawn("node", ["dist/serve.js"], {
  env: { ...process.env, PORT: String(PORT), RATE_LIMIT: "5" },
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

  const client = new Client({ name: "smoke-http", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));

  const { tools } = await client.listTools();
  check(tools.length === 5, `${tools.length} інструментів через HTTP`);

  const result = await client.callTool({
    name: "proyav_search_tenders",
    arguments: { text: "ремонт даху", limit: 2 },
  });
  const payload = JSON.parse(result.content[0].text);
  check(payload.results?.length > 0, `пошук повернув ${payload.results?.length ?? 0} карток`);

  await client.close();

  // The endpoint is public, so the ceiling has to actually hold.
  const codes = [];
  for (let i = 0; i < 8; i++) {
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: i, method: "tools/list" }),
    });
    codes.push(res.status);
  }
  check(codes.includes(429), `обмеження частоти спрацювало: ${codes.join(",")}`);

  const missing = await fetch(`${base}/nowhere`);
  check(missing.status === 404, "невідомий шлях віддає 404");
} finally {
  child.kill();
}

process.exit(failed ? 1 : 0);
