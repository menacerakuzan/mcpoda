#!/usr/bin/env node
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerTools } from "./tools/index.js";
import { INSTRUCTIONS } from "./instructions.js";
import { instrument } from "./observe.js";
import { databasePath } from "./index/db.js";
import { stats as indexStats } from "./index/asyncIndex.js";

/**
 * The same tools over HTTP instead of stdio.
 *
 * This is the deployment that matches what the project promises: a person pastes
 * a URL into their assistant and is done. No install, no crawl, no database on
 * their laptop — the index lives here, built once, and everyone reads it.
 *
 * Sessions are stateless on purpose. Every request carries everything it needs,
 * so the process can be restarted or run behind several instances without anyone
 * noticing a dropped conversation.
 */

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "0.0.0.0";

/** Requests per window, per address. A public endpoint needs a ceiling. */
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

// The map would grow forever with one entry per address seen.
setInterval(() => {
  const now = Date.now();
  for (const [address, entry] of hits) if (entry.resetAt < now) hits.delete(address);
}, RATE_WINDOW_MS).unref();

function buildServer() {
  const server = new McpServer(
    { name: "proyav-prozorro", version: "0.1.0" },
    { instructions: INSTRUCTIONS },
  );
  registerTools(instrument(server));
  return server;
}

async function handleMcp(req: IncomingMessage, res: ServerResponse) {
  // A fresh server and transport per request: nothing is shared, so one
  // conversation can never see another's state.
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req, res);
}

/**
 * Row counts, refreshed in the background and never on the request path.
 *
 * Measured on the real 30M-row index (27.08.2026): a full count(*) blocks the
 * single-threaded event loop for 25 seconds on a warm disk and minutes on a
 * loaded one, and while it runs every other request stalls with it. Three
 * earlier attempts — a TTL cache, a refresh timer, computing once at boot —
 * all still ran the query inline on the main thread at some point, and each
 * one in turn froze a live session mid-test.
 *
 * The worker thread that already serves the tools fixes this properly: the
 * count runs there, the main thread only awaits a message, and /health serves
 * whatever the last refresh produced. So a slow count now costs nobody
 * anything, and the endpoint is informative again instead of reporting a file
 * size as a stand-in.
 */
let counts: Awaited<ReturnType<typeof indexStats>> = null;
let countsAt: number | null = null;
let refreshing = false;

const COUNTS_TTL_MS = 5 * 60_000;

async function refreshCounts() {
  if (refreshing) return;
  if (countsAt && Date.now() - countsAt < COUNTS_TTL_MS) return;

  refreshing = true;
  try {
    counts = await indexStats();
    countsAt = Date.now();
  } catch (error) {
    console.error("[health] не вдалось оновити лічильники:", error);
  } finally {
    refreshing = false;
  }
}

function health(res: ServerResponse) {
  const path = databasePath();
  const file = existsSync(path) ? statSync(path) : null;

  // Kicked off, never awaited: this request answers from what is already
  // known, and the next one benefits from this refresh.
  void refreshCounts();

  res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  res.end(
    JSON.stringify(
      {
        status: "ok",
        index: file
          ? {
              tenders: counts?.tenders ?? null,
              withTitleAndValue: counts?.enriched ?? null,
              buyers: counts?.buyers ?? null,
              newest: counts?.newest ?? null,
              countsAt: countsAt ? new Date(countsAt).toISOString() : null,
              sizeBytes: file.size,
              modifiedAt: file.mtime.toISOString(),
            }
          : null,
        note: !file
          ? "Індексу немає: пошук і картки працюють, аналітика по індексу — ні."
          : counts
            ? undefined
            : "Лічильники ще рахуються у фоні, тому поки порожні. Розмір файлу вже показує, що індекс на місці.",
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
  console.error(`ПРОЯВ / Prozorro MCP слухає http://${HOST}:${PORT}/mcp`);
  // Deliberately no count(*) here either — see the comment on health() above.
  // The server must start accepting connections immediately, not after a
  // query that can take minutes on a loaded disk.
  console.error(existsSync(databasePath()) ? "індекс присутній" : "індексу немає");
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    httpServer.close(() => process.exit(0));
  });
}

// Keeping the id generator honest about what it is: sessions are disabled, and
// this exists only so the import is not mistaken for dead weight later.
void randomUUID;
