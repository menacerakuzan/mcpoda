#!/usr/bin/env node
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, statSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerTools } from "./tools/index.js";
import { INSTRUCTIONS } from "./instructions.js";
import { instrument } from "./observe.js";
import { databasePath } from "./db.js";

/**
 * The same tools over HTTP instead of stdio. Unlike Prozorro, there is no
 * crawler here to fall back on if the index is missing — the index only ever
 * comes from `npm run import` against a manually downloaded UO.xml (see
 * README.md), so a deployment with no index yet is expected on day one, not
 * a bug: the tools already report index_unavailable in that case.
 */

const PORT = Number(process.env.PORT ?? 8790);
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
    { name: "proyav-edr", version: "0.1.0" },
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

// count(*) over 2M companies / 6M people takes tens of seconds cold, longer
// under real production disk contention — node:sqlite calls are synchronous,
// so it blocks the entire event loop, including every other request. Three
// earlier attempts (a TTL cache, a refresh timer, computing once at boot)
// all still ran it inline on the main thread at some point; on the shared
// VM this ran on 27.08.2026, that froze a live colleague's session mid-test.
// The only way to keep it off the request path entirely is to not query the
// database for it at all: /health reports file presence and size instead.
function health(res: ServerResponse) {
  const path = databasePath();
  const stats = existsSync(path) ? statSync(path) : null;

  res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  res.end(
    JSON.stringify(
      {
        status: "ok",
        index: stats ? { sizeBytes: stats.size, modifiedAt: stats.mtime.toISOString() } : null,
        note: stats
          ? "Розмір файлу, не живий підрахунок рядків: count() по мільйонах рядків блокує єдиний потік Node."
          : "Індексу немає: інструменти повертають index_unavailable.",
      },
      null,
      2,
    ),
  );
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
  console.error(`ПРОЯВ / ЄДР MCP слухає http://${HOST}:${PORT}/mcp`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    httpServer.close(() => process.exit(0));
  });
}
