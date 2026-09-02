import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { requestJson, SourceError } from "../dist/http.js";

/**
 * This server has no local index: every tool call goes straight to the live
 * register, so a single dropped connection is a failed answer to a person.
 * Until 27.08.2026 neither a timeout nor a network blip was retried here at
 * all — the same gap had already killed an unattended Prozorro crawl. These
 * tests exist so that retry path cannot quietly disappear again.
 */

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function timeoutError() {
  const error = new Error("The operation timed out.");
  error.name = "TimeoutError";
  return error;
}

/** What Node/undici throws for DNS blips, connection resets, and similar. */
function networkFailure() {
  const error = new TypeError("fetch failed");
  (error as TypeError & { cause?: unknown }).cause = new Error("ECONNRESET");
  return error;
}

describe("requestJson", () => {
  it("зрештою повертає дані після кількох таймаутів поспіль", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      if (calls < 3) throw timeoutError();
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;

    const result = await requestJson<{ ok: boolean }>("https://example.test/x");

    assert.deepEqual(result, { ok: true });
    assert.equal(calls, 3, "не повторив запит стільки разів, скільки мало бути спроб");
  });

  it("здається після вичерпання спроб на таймаут і кидає SourceError 408", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      throw timeoutError();
    }) as typeof fetch;

    await assert.rejects(
      () => requestJson("https://example.test/x"),
      (error: unknown) => {
        assert.ok(error instanceof SourceError, "помилка не SourceError");
        assert.equal(error.status, 408);
        return true;
      },
    );
    assert.equal(calls, 4, "мало бути 1 початкова спроба + 3 повтори");
  });

  it("повторює на мережевий збій (fetch failed), а не валиться одразу", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      if (calls < 3) throw networkFailure();
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;

    const result = await requestJson<{ ok: boolean }>("https://example.test/x");
    assert.deepEqual(result, { ok: true });
    assert.equal(calls, 3);
  });

  it("здається після вичерпання спроб на мережевий збій і кидає SourceError", async () => {
    globalThis.fetch = (async () => {
      throw networkFailure();
    }) as typeof fetch;

    await assert.rejects(
      () => requestJson("https://example.test/x"),
      (error: unknown) => {
        assert.ok(error instanceof SourceError, "помилка не SourceError");
        return true;
      },
    );
  });

  it("повторює на 503, як і раніше", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      if (calls < 2) return new Response("busy", { status: 503 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;

    const result = await requestJson<{ ok: boolean }>("https://example.test/x");
    assert.deepEqual(result, { ok: true });
  });

  it("не повторює на 404, бо це не тимчасова помилка", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    await assert.rejects(() => requestJson("https://example.test/x"));
    assert.equal(calls, 1, "повторив запит на постійній помилці");
  });
});
