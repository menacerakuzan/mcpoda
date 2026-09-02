import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { openDatabase } from "../dist/index/db.js";
import { crawlMonitorings, detailMonitorings } from "../dist/index/audit.js";
import { monitoringsFor } from "../dist/index/queries.js";
import { checkTender } from "../dist/analysis/check.js";

/**
 * The audit findings are the only thing in this server that may be repeated as
 * fact rather than as a hint, so the distinctions are tested harder than the
 * plumbing: «не перевіряли», «перевірили і порушень немає» and «перевірка
 * триває» must never collapse into one another.
 */

let db: ReturnType<typeof openDatabase>;

beforeEach(() => {
  db = openDatabase(":memory:");
});

const feed = (pages: Array<Array<{ id: string; dateModified: string }>>) => {
  let call = 0;
  return async () => {
    const data = pages[call] ?? [];
    call++;
    return { data, next_page: call < pages.length ? { offset: `o${call}` } : undefined };
  };
};

const monitoring = (over: Record<string, unknown> = {}) => ({
  id: "m-1",
  monitoring_id: "UA-M-2026-01-01-000001",
  tender_id: "t-1",
  status: "addressed",
  reasons: ["indicator"],
  monitoringPeriod: { startDate: "2026-01-01T10:00:00+02:00" },
  conclusion: {
    violationOccurred: true,
    violationType: ["other"],
    description: "Встановлено порушення вимог статті 4.",
  },
  ...over,
});

describe("стрічка моніторингів", () => {
  it("записує все, що віддала стрічка, і рахує лише справді нові", async () => {
    const pages = [[{ id: "m-1", dateModified: "2026-01-01T10:00:00+02:00" }]];

    const first = await crawlMonitorings(db, { delayMs: 0, fetchPage: feed(pages) as never });
    assert.equal(first.inserted, 1);

    const second = await crawlMonitorings(db, { delayMs: 0, fetchPage: feed(pages) as never });
    assert.equal(second.inserted, 0, "той самий моніторинг зарахований як новий вдруге");
  });

  it("повертає змінений моніторинг у чергу на висновок", async () => {
    // A check that was running when we first saw it later gets a conclusion.
    // Without this the index would keep the stale "no conclusion yet" forever.
    await crawlMonitorings(db, {
      delayMs: 0,
      fetchPage: feed([[{ id: "m-1", dateModified: "2026-01-01T10:00:00+02:00" }]]) as never,
    });
    await detailMonitorings(db, {
      delayMs: 0,
      fetchOne: (async () => monitoring({ status: "active", conclusion: undefined })) as never,
    });

    const before = monitoringsFor(db, "t-1");
    assert.equal(before[0]?.violationOccurred, null, "незавершена перевірка має бути null");

    // Feed reports it changed.
    await crawlMonitorings(db, {
      delayMs: 0,
      fetchPage: feed([[{ id: "m-1", dateModified: "2026-02-01T10:00:00+02:00" }]]) as never,
    });
    const filled = await detailMonitorings(db, {
      delayMs: 0,
      fetchOne: (async () => monitoring()) as never,
    });

    assert.equal(filled.detailed, 1, "змінений моніторинг не потрапив у чергу повторно");
    assert.equal(monitoringsFor(db, "t-1")[0]?.violationOccurred, true);
  });

  it("не перезапитує моніторинг, який не змінювався", async () => {
    const page = [[{ id: "m-1", dateModified: "2026-01-01T10:00:00+02:00" }]];
    await crawlMonitorings(db, { delayMs: 0, fetchPage: feed(page) as never });
    await detailMonitorings(db, { delayMs: 0, fetchOne: (async () => monitoring()) as never });

    await crawlMonitorings(db, { delayMs: 0, fetchPage: feed(page) as never });
    const again = await detailMonitorings(db, {
      delayMs: 0,
      fetchOne: (async () => {
        throw new Error("джерело не мало опитуватись повторно");
      }) as never,
    });

    assert.equal(again.seen, 0);
  });

  it("переживає недоступний моніторинг і не зупиняє прохід", async () => {
    await crawlMonitorings(db, {
      delayMs: 0,
      fetchPage: feed([
        [
          { id: "m-1", dateModified: "2026-01-01T10:00:00+02:00" },
          { id: "m-2", dateModified: "2026-01-02T10:00:00+02:00" },
        ],
      ]) as never,
    });

    let calls = 0;
    const progress = await detailMonitorings(db, {
      delayMs: 0,
      fetchOne: (async (id: string) => {
        calls++;
        if (calls === 1) throw new Error("503");
        return monitoring({ id });
      }) as never,
    });

    assert.equal(progress.failed, 1);
    assert.equal(progress.detailed, 1, "прохід зупинився на першій помилці");
  });
});

describe("висновок ДАСУ у перевірці тендера", () => {
  const tender = {
    tenderID: "UA-2026-01-01-000001-a",
    procurementMethodType: "belowThreshold",
    status: "complete",
    bids: [],
  };

  it("розрізняє «не перевіряли» і «перевірили, порушень немає»", () => {
    const never = checkTender(tender as never, [], []);
    assert.equal(never.audit.checked, false);
    assert.match(never.audit.summary, /не перевіряла/);
    assert.match(
      never.audit.summary,
      /не означає, що з нею все гаразд/,
      "відсутність перевірки подана як підтвердження чистоти",
    );

    const cleared = checkTender(tender as never, [], [
      {
        monitoringId: "UA-M-1",
        status: "declined",
        reasons: ["indicator"],
        violationOccurred: false,
        violationType: [],
        description: "Порушень не встановлено.",
        startedAt: "2026-01-01T10:00:00.000Z",
      },
    ]);
    assert.equal(cleared.audit.checked, true);
    assert.match(cleared.audit.summary, /порушень не встановлено/i);
  });

  it("називає встановлене порушення рішенням органу, а не власною оцінкою", () => {
    const result = checkTender(tender as never, [], [
      {
        monitoringId: "UA-M-1",
        status: "addressed",
        reasons: ["fiscal"],
        violationOccurred: true,
        violationType: ["other"],
        description: "Встановлено порушення.",
        startedAt: "2026-01-01T10:00:00.000Z",
      },
    ]);

    assert.match(result.audit.summary, /встановила порушення/);
    assert.match(result.audit.summary, /не наша оцінка/);
  });

  it("не подає перевірку, що триває, як результат", () => {
    const result = checkTender(tender as never, [], [
      {
        monitoringId: "UA-M-1",
        status: "active",
        reasons: ["indicator"],
        violationOccurred: null,
        violationType: [],
        description: null,
        startedAt: "2026-01-01T10:00:00.000Z",
      },
    ]);

    assert.match(result.audit.summary, /трива/);
    assert.doesNotMatch(result.audit.summary, /порушень не встановлено/i);
  });

  it("пояснює різницю у вазі між сигналами і висновком ДАСУ", () => {
    const result = checkTender(tender as never, [], []);
    assert.match(result.whatThisIsNot, /signals/);
    assert.match(result.whatThisIsNot, /audit/);
    assert.match(result.whatThisIsNot, /уповноваженого встановлювати порушення/);
  });
});
