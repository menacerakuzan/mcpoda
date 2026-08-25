import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_SCAN_PAGES, resolveTenderId } from "../dist/resolve.js";

/**
 * The resolver is the one piece of logic with a real bug history: an early
 * version upper-cased the whole number, and since the suffix is lower case in
 * real data ("-a") every comparison missed silently. A fake feed lets the rules
 * be checked without touching the source.
 */

type Entry = { id: string; tenderID?: string; dateModified: string };

/** Builds a reader over prepared pages and counts how many were requested. */
function feedOf(pages: Entry[][]) {
  const calls: Array<string | undefined> = [];
  const read = async ({ offset }: { offset?: string }) => {
    calls.push(offset);
    const index = offset ? Number(offset) : 0;
    const data = pages[index] ?? [];
    return {
      data,
      next_page: index + 1 < pages.length ? { offset: String(index + 1) } : undefined,
    };
  };
  return { read, calls };
}

const entry = (tenderID: string, date: string, id = tenderID.toLowerCase()): Entry => ({
  id,
  tenderID,
  dateModified: `${date}T12:00:00+03:00`,
});

describe("resolveTenderId", () => {
  it("знаходить процедуру на першій сторінці", async () => {
    const { read, calls } = feedOf([
      [entry("UA-2026-08-25-000001-a", "2026-08-25", "uuid-1")],
    ]);

    const outcome = await resolveTenderId("UA-2026-08-25-000001-a", read);

    assert.equal(outcome.found, true);
    assert.equal(outcome.found && outcome.uuid, "uuid-1");
    assert.equal(outcome.pagesScanned, 1);
    assert.equal(calls.length, 1);
  });

  it("не залежить від регістру суфікса", async () => {
    const { read } = feedOf([
      [entry("UA-2026-08-25-000001-a", "2026-08-25", "uuid-1")],
    ]);

    const outcome = await resolveTenderId("ua-2026-08-25-000001-A", read);

    assert.equal(outcome.found, true, "порівняння знову стало чутливим до регістру");
  });

  it("ігнорує зайві пробіли навколо номера", async () => {
    const { read } = feedOf([
      [entry("UA-2026-08-25-000001-a", "2026-08-25", "uuid-1")],
    ]);

    const outcome = await resolveTenderId("  UA-2026-08-25-000001-a  ", read);
    assert.equal(outcome.found, true);
  });

  it("йде на наступну сторінку, коли на поточній немає", async () => {
    const { read, calls } = feedOf([
      [entry("UA-2026-08-25-000009-a", "2026-08-25", "інший")],
      [entry("UA-2026-08-25-000001-a", "2026-08-25", "uuid-1")],
    ]);

    const outcome = await resolveTenderId("UA-2026-08-25-000001-a", read);

    assert.equal(outcome.found && outcome.uuid, "uuid-1");
    assert.equal(outcome.pagesScanned, 2);
    assert.deepEqual(calls, [undefined, "1"]);
  });

  it("зупиняється, щойно стрічка старша за дату видачі номера", async () => {
    // a procedure cannot have been modified before it existed, so anything older
    // than its own number means it is not in the recent part of the feed
    const { read, calls } = feedOf([
      [entry("UA-2026-08-01-000009-a", "2026-08-01", "старий")],
      [entry("UA-2026-08-25-000001-a", "2026-08-25", "uuid-1")],
    ]);

    const outcome = await resolveTenderId("UA-2026-08-25-000001-a", read);

    assert.equal(outcome.found, false);
    assert.equal(outcome.found === false && outcome.reason, "predates_number");
    assert.equal(calls.length, 1, "сканування не зупинилось і читає зайві сторінки");
  });

  it("не сканує нескінченно", async () => {
    const pages = Array.from({ length: MAX_SCAN_PAGES + 5 }, () => [
      entry("UA-2026-08-25-000009-a", "2026-08-25", "інший"),
    ]);
    const { read, calls } = feedOf(pages);

    const outcome = await resolveTenderId("UA-2026-08-25-000001-a", read);

    assert.equal(outcome.found, false);
    assert.equal(outcome.found === false && outcome.reason, "scan_exhausted");
    assert.equal(calls.length, MAX_SCAN_PAGES);
  });

  it("відхиляє те, що не схоже на номер процедури", async () => {
    const { read, calls } = feedOf([[]]);

    for (const bad of ["", "просто текст", "2026-08-25", "UA-XX-08-25-1-a"]) {
      const outcome = await resolveTenderId(bad, read);
      assert.equal(outcome.found, false, `«${bad}» пройшло як номер`);
      assert.equal(outcome.found === false && outcome.reason, "bad_format");
    }
    assert.equal(calls.length, 0, "на явно хибний номер сервер усе одно пішов у мережу");
  });

  it("переживає порожню стрічку", async () => {
    const { read } = feedOf([[]]);
    const outcome = await resolveTenderId("UA-2026-08-25-000001-a", read);
    assert.equal(outcome.found, false);
  });
});
