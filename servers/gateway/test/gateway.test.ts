import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createServer, type Server } from "node:http";
import { createGateway, matchRoute } from "../dist/gateway.js";

/**
 * The gateway is the single thing standing between every client and all three
 * servers: if it misroutes or hangs, nothing works and the failure looks like
 * the servers' fault. It ran for a day with no tests at all — these cover the
 * paths that actually break in production, not just the happy one.
 */

/** Stands in for one MCP server: echoes back what it was asked. */
function fakeUpstream(name: string): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            upstream: name,
            path: req.url,
            method: req.method,
            forwardedFor: req.headers["x-forwarded-for"] ?? null,
            body: body || null,
          }),
        );
      });
    });
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, port: (server.address() as { port: number }).port });
    });
  });
}

let prozorro: Awaited<ReturnType<typeof fakeUpstream>>;
let nazk: Awaited<ReturnType<typeof fakeUpstream>>;
let gateway: Server;
let base: string;
/** A port nothing listens on, to stand in for a server that is down. */
let deadPort: number;

before(async () => {
  prozorro = await fakeUpstream("prozorro");
  nazk = await fakeUpstream("nazk");

  // Claim a port, then release it: nothing is listening there afterwards.
  const throwaway = await fakeUpstream("dead");
  deadPort = throwaway.port;
  await new Promise((r) => throwaway.server.close(r));

  gateway = createGateway({
    "/prozorro": prozorro.port,
    "/nazk": nazk.port,
    "/edr": deadPort,
  });
  await new Promise<void>((resolve) =>
    gateway.listen(0, "127.0.0.1", () => resolve()),
  );
  base = `http://127.0.0.1:${(gateway.address() as { port: number }).port}`;
});

after(async () => {
  await new Promise((r) => gateway.close(r));
  await new Promise((r) => prozorro.server.close(r));
  await new Promise((r) => nazk.server.close(r));
});

describe("matchRoute", () => {
  const routes = { "/edr": 1, "/edr-archive": 2, "/nazk": 3 };

  it("бере найдовший збіг, а не перший-ліпший", () => {
    assert.equal(matchRoute("/edr-archive/mcp", routes), "/edr-archive");
  });

  it("вимагає межу шляху, а не будь-який початок рядка", () => {
    assert.equal(matchRoute("/edrpou", routes), null);
  });

  it("приймає точний префікс без хвоста", () => {
    assert.equal(matchRoute("/nazk", routes), "/nazk");
  });
});

describe("шлюз", () => {
  it("веде кожен префікс до свого сервера і зрізає префікс зі шляху", async () => {
    const res = await fetch(`${base}/prozorro/mcp`);
    const body = await res.json();

    assert.equal(body.upstream, "prozorro");
    assert.equal(body.path, "/mcp", "префікс не зрізано, сервер отримав чужий шлях");
  });

  it("не плутає сервери між собою", async () => {
    const body = await (await fetch(`${base}/nazk/health`)).json();
    assert.equal(body.upstream, "nazk");
    assert.equal(body.path, "/health");
  });

  it("передає метод і тіло запиту без змін", async () => {
    const payload = JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 1 });
    const body = await (
      await fetch(`${base}/prozorro/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: payload,
      })
    ).json();

    assert.equal(body.method, "POST");
    assert.equal(body.body, payload, "тіло запиту не дійшло до сервера цілим");
  });

  it("пропускає x-forwarded-for, бо на ньому тримається облік частоти", async () => {
    // Each server counts requests per client address. If the gateway dropped
    // this header, every request would look like it came from the gateway
    // itself and one busy client would exhaust the limit for everyone.
    const body = await (
      await fetch(`${base}/prozorro/mcp`, {
        headers: { "x-forwarded-for": "203.0.113.7" },
      })
    ).json();

    assert.equal(body.forwardedFor, "203.0.113.7");
  });

  it("віддає 404 зі списком маршрутів на невідомий шлях", async () => {
    const res = await fetch(`${base}/nowhere`);
    assert.equal(res.status, 404);

    const body = await res.json();
    assert.equal(body.error, "not_found");
    assert.deepEqual(body.routes, ["/prozorro/mcp", "/nazk/mcp", "/edr/mcp"]);
  });

  it("віддає 502, коли сервер за префіксом лежить, і не зависає", async () => {
    const res = await fetch(`${base}/edr/mcp`);
    assert.equal(res.status, 502);

    const body = await res.json();
    assert.equal(body.error, "upstream_unavailable");
  });

  it("падіння одного сервера не чіпає решту", async () => {
    await fetch(`${base}/edr/mcp`).catch(() => {});
    const body = await (await fetch(`${base}/prozorro/mcp`)).json();
    assert.equal(body.upstream, "prozorro", "живий сервер постраждав від сусіднього збою");
  });
});
