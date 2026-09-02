#!/usr/bin/env node
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";

/**
 * One public port in front of the three MCP servers, routing by path prefix.
 *
 * It exists because a client can only be handed URLs, and a free tunnel gives
 * exactly one hostname: without this, showing all three servers to someone
 * outside the network would need three simultaneous tunnels. With it,
 * `…/prozorro/mcp`, `…/nazk/mcp` and `…/edr/mcp` all live behind a single one.
 *
 * It deliberately does nothing but forward. Rate limiting stays in each server,
 * where it can count per client address — which is why the client's headers,
 * including `x-forwarded-for`, are passed through untouched. A limiter here
 * would see only its own address and throttle everyone as one.
 */

export type Routes = Record<string, number>;

export const DEFAULT_ROUTES: Routes = {
  "/prozorro": Number(process.env.PROZORRO_PORT ?? 8787),
  "/nazk": Number(process.env.NAZK_PORT ?? 8789),
  "/edr": Number(process.env.EDR_PORT ?? 8791),
};

/**
 * Longest prefix first, so a future `/edr-archive` could never be swallowed by
 * `/edr`. Matching also requires the prefix to end at a path boundary.
 */
export function matchRoute(url: string, routes: Routes): string | null {
  const candidates = Object.keys(routes).sort((a, b) => b.length - a.length);
  return (
    candidates.find((prefix) => url === prefix || url.startsWith(prefix + "/")) ?? null
  );
}

export function createGateway(routes: Routes = DEFAULT_ROUTES) {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "/";
    const prefix = matchRoute(url, routes);

    if (!prefix) {
      res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          error: "not_found",
          message: "Невідомий шлях. Кожен сервер живе за своїм префіксом.",
          routes: Object.keys(routes).map((p) => `${p}/mcp`),
        }),
      );
      return;
    }

    const upstream = httpRequest(
      {
        host: "127.0.0.1",
        port: routes[prefix],
        path: url.slice(prefix.length) || "/",
        method: req.method,
        headers: req.headers,
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
        upstreamRes.pipe(res);
      },
    );

    upstream.on("error", (error) => {
      console.error(`[gateway] ${prefix} недоступний: ${error.message}`);
      if (!res.headersSent) {
        res.writeHead(502, { "content-type": "application/json; charset=utf-8" });
        res.end(
          JSON.stringify({
            error: "upstream_unavailable",
            message: `Сервер ${prefix.slice(1)} не відповідає. Решта працюють незалежно.`,
          }),
        );
      } else {
        // Headers already went out, so the only honest signal left is cutting
        // the response short rather than ending it as if it were complete.
        res.destroy();
      }
    });

    req.pipe(upstream);
  });
}

// Only listen when run directly, so the tests can import createGateway without
// binding a port.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "")) {
  const PORT = Number(process.env.GATEWAY_PORT ?? 8888);
  const HOST = process.env.GATEWAY_HOST ?? "127.0.0.1";

  const server = createGateway();
  server.listen(PORT, HOST, () => {
    console.error(`ПРОЯВ / шлюз слухає http://${HOST}:${PORT}`);
    for (const [prefix, port] of Object.entries(DEFAULT_ROUTES)) {
      console.error(`  ${prefix}/mcp → :${port}/mcp`);
    }
  });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => server.close(() => process.exit(0)));
  }
}
