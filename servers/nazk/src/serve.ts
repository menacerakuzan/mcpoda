#!/usr/bin/env node
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerTools } from "./tools/index.js";
import { INSTRUCTIONS } from "./instructions.js";
import { instrument } from "./observe.js";

/**
 * The same tools over HTTP instead of stdio: a person pastes a URL into their
 * assistant and is done, no install. Unlike Prozorro, there is no local index
 * here — every call already goes straight to public-api.nazk.gov.ua — so this
 * server exists purely to remove the npx install step, not to add speed.
 */

const PORT = Number(process.env.PORT ?? 8789);
const HOST = process.env.HOST ?? "0.0.0.0";

const RATE_LIMIT = Number(process.env.RATE_LIMIT ?? 240);
const RATE_WINDOW_MS = 60_000;

const hits = new Map<string, { count: number; resetAt: number }>();

function overLimit(address: string) {
  const now = Date.now();
  const entry = hits.get(address);

  if (!entry || entry.resetAt < now) {
    hits.set(address, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }

  entry.count++;
  return entry.count > RATE_LIMIT;
}

setInterval(() => {
  const now = Date.now();
  for (const [address, entry] of hits) if (entry.resetAt < now) hits.delete(address);
}, RATE_WINDOW_MS).unref();

function buildServer() {
  const server = new McpServer(
    { name: "proyav-nazk", version: "0.1.0" },
    { instructions: INSTRUCTIONS },
  );
  registerTools(instrument(server));
  return server;
}

async function handleMcp(req: IncomingMessage, res: ServerResponse) {
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req, res);
}

function health(res: ServerResponse) {
  res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ status: "ok" }, null, 2));
}

const httpServer = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const address =
    (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ??
    req.socket.remoteAddress ??
    "unknown";

  if (url.pathname === "/health") return health(res);

  if (url.pathname !== "/mcp") {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    return res.end("Not found. MCP endpoint: /mcp");
  }

  if (overLimit(address)) {
    res.writeHead(429, {
      "content-type": "application/json; charset=utf-8",
      "retry-after": "60",
    });
    return res.end(
      JSON.stringify({
        error: "rate_limited",
        message: `Перевищено ${RATE_LIMIT} запитів за хвилину. Спробуйте за хвилину.`,
      }),
    );
  }

  handleMcp(req, res).catch((error) => {
    console.error("[mcp]", error);
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "internal" }));
    }
  });
});

httpServer.listen(PORT, HOST, () => {
  console.error(`ПРОЯВ / НАЗК MCP слухає http://${HOST}:${PORT}/mcp`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    httpServer.close(() => process.exit(0));
  });
}
