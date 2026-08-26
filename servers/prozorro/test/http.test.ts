import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { requestJson, SourceError } from "../dist/http.js";

/**
 * The bug this guards against was found the hard way: an unattended overnight
 * crawl died after twelve million requests on a single network timeout, because
 * a timeout threw immediately instead of going through the same retry path as a
 * 503. A job meant to run for hours has to survive a blip that lasts a few
 * seconds longer than one request.
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

  it("здається після вичерпання спроб і кидає SourceError", async () => {
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
