import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  openDatabase,
  indexStats,
  readState,
  writeState,
  SchemaMismatch,
  SCHEMA_VERSION,
} from "../dist/index/db.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { catchUp, crawl } from "../dist/index/crawl.js";
import { lookupByTenderId, searchIndex, pendingEnrichment } from "../dist/index/queries.js";
import { enrich } from "../dist/index/enrich.js";

/** Everything runs against an in-memory database over a fake feed: no network. */

type Entry = {
  id: string;
  tenderID: string;
  dateModified: string;
  status?: string;
  procuringEntity?: {
    name?: string;
    identifier?: { id?: string };
    address?: { region?: string };
  };
};

const entry = (n: number, overrides: Partial<Entry> = {}): Entry => ({
  id: `id-${n}`,
  tenderID: `UA-2026-08-${String(n).padStart(2, "0")}-000001-a`,
  dateModified: `2026-08-${String(n).padStart(2, "0")}T10:00:00+03:00`,
  status: "complete",
  procuringEntity: {
    name: "Сільська рада",
    identifier: { id: "12345678" },
    address: { region: "Одеська область" },
  },
  ...overrides,
});

/**
 * A feed that hands out prepared pages and remembers how it was called.
 *
 * It always returns a next offset, exactly like the real source: even at the
 * head, Prozorro hands back a cursor and simply repeats the last page. Getting
 * this wrong in the fake would test a behaviour the server never meets.
 */
function fakeFeed(pages: Entry[][]) {
  const seen: Array<{ offset?: string; descending?: boolean }> = [];
  const fetchPage = async (options: { offset?: string; descending?: boolean }) => {
    seen.push({ offset: options.offset, descending: options.descending });
    const index = options.offset ? Number(options.offset) : 0;
    return {
      data: pages[index] ?? [],
      next_page: { offset: String(index + 1) },
    };
  };
  return { fetchPage: fetchPage as never, seen };
}

let db: ReturnType<typeof openDatabase>;

beforeEach(() => {
  db = openDatabase(":memory:");
});

describe("схема", () => {
  it("відмовляється відкривати індекс старої версії", () => {
    const path = join(mkdtempSync(join(tmpdir(), "proyav-")), "index.sqlite");

    const first = openDatabase(path);
    writeState(first, "schema_version", String(SCHEMA_VERSION - 1));
    first.close();

    // Silently reading a stale layout would answer questions with wrong data,
    // which is worse than refusing: the index is a cache and can be rebuilt.
    assert.throws(() => openDatabase(path), SchemaMismatch);
  });

  it("проставляє версію новому індексу", () => {
    assert.equal(readState(db, "schema_version"), String(SCHEMA_VERSION));
  });
});

describe("crawl", () => {
  it("записує те, що стрічка віддає без додаткових запитів", async () => {
    const { fetchPage } = fakeFeed([[entry(1), entry(2)]]);

    const progress = await crawl(db, { fetchPage, delayMs: 0, pageSize: 2 });

    assert.equal(progress.inserted, 2);
    const row = lookupByTenderId(db, "UA-2026-08-01-000001-a");
    assert.equal(row?.id, "id-1");
    assert.equal(row?.buyer_edrpou, "12345678");
    assert.equal(row?.region, "Одеська область");
  });

  it("не дублює процедуру, яку стрічка показала вдруге", async () => {
    const { fetchPage } = fakeFeed([
      [entry(1)],
      [entry(1, { dateModified: "2026-08-09T10:00:00+03:00", status: "cancelled" })],
    ]);

    const progress = await crawl(db, { fetchPage, delayMs: 0, pageSize: 1 });

    assert.equal(progress.inserted, 1, "та сама процедура вставилась двічі");
    assert.equal(progress.updated, 1);
    const row = lookupByTenderId(db, "UA-2026-08-01-000001-a");
    assert.equal(row?.status, "cancelled", "оновлення не перезаписало статус");
  });

  it("продовжує з збереженого курсора", async () => {
    const pages = [[entry(1)], [entry(2)], [entry(3)]];

    await crawl(db, { ...fakeFeed(pages), delayMs: 0, pageSize: 1, maxPages: 1 });
    assert.equal(indexStats(db).tenders, 1);

    const second = fakeFeed(pages);
    await crawl(db, { fetchPage: second.fetchPage, delayMs: 0, pageSize: 1, maxPages: 1 });

    assert.equal(second.seen[0]?.offset, "1", "другий запуск почав спочатку");
    assert.equal(indexStats(db).tenders, 2);
  });

  it("тримає окремі курсори для історії та свіжого", async () => {
    const pages = [[entry(1)], [entry(2)]];

    await crawl(db, { ...fakeFeed(pages), delayMs: 0, pageSize: 1, maxPages: 1 });
    await crawl(db, {
      ...fakeFeed(pages),
      delayMs: 0,
      pageSize: 1,
      maxPages: 1,
      descending: true,
    });

    assert.ok(readState(db, "crawl_cursor"), "курсор історії не збережено");
    assert.ok(readState(db, "crawl_cursor_recent"), "курсор свіжого не збережено");
    assert.notEqual(
      readState(db, "crawl_cursor"),
      null,
      "режими перетерли курсори один одного",
    );
  });

  it("зупиняється на короткій сторінці, бо це кінець стрічки", async () => {
    const { fetchPage, seen } = fakeFeed([[entry(1)], [entry(2), entry(3)]]);

    await crawl(db, { fetchPage, delayMs: 0, pageSize: 2 });

    assert.equal(seen.length, 1, "краулер читав далі після короткої сторінки");
  });
});

describe("catchUp", () => {
  it("відмовляється працювати без збереженого курсора", async () => {
    await assert.rejects(
      () => catchUp(db, { delayMs: 0 }),
      /курсора/,
      "догін без курсора мовчки почав би з 2015 року",
    );
  });

  it("читає лише те, що зʼявилось після минулого проходу", async () => {
    const pages = [[entry(1)], [entry(2)]];

    await crawl(db, { ...fakeFeed(pages), delayMs: 0, pageSize: 1, maxPages: 1 });

    const second = fakeFeed(pages);
    const progress = await catchUp(db, {
      fetchPage: second.fetchPage,
      delayMs: 0,
      pageSize: 1,
    });

    assert.equal(second.seen[0]?.offset, "1", "догін почав з початку стрічки");
    assert.equal(progress.inserted, 1);
  });

  it("оновлює процедуру, яку змінили після індексації", async () => {
    await crawl(db, {
      ...fakeFeed([[entry(1, { status: "active.tendering" })]]),
      delayMs: 0,
      pageSize: 1,
      maxPages: 1,
    });

    await catchUp(db, {
      ...fakeFeed([
        [],
        [entry(1, { status: "complete", dateModified: "2026-08-30T10:00:00+03:00" })],
      ]),
      delayMs: 0,
      pageSize: 1,
    });

    const row = lookupByTenderId(db, "UA-2026-08-01-000001-a");
    assert.equal(row?.status, "complete", "зміна статусу не доїхала в індекс");
  });
});

describe("searchIndex", () => {
  beforeEach(async () => {
    const { fetchPage } = fakeFeed([
      [
        entry(1),
        entry(2, {
          id: "id-2",
          procuringEntity: {
            name: "Міськрада",
            identifier: { id: "87654321" },
            address: { region: "Львівська область" },
          },
        }),
      ],
    ]);
    await crawl(db, { fetchPage, delayMs: 0, pageSize: 2 });

    await enrich(db, {
      delayMs: 0,
      fetch: (async (id: string) =>
        id === "id-1"
          ? {
              id,
              title: "Капітальний ремонт дороги",
              value: { amount: 500000, currency: "UAH" },
              items: [{ classification: { id: "45233142-6" } }],
              status: "complete",
            }
          : {
              id,
              title: "Закупівля палива",
              value: { amount: 90000, currency: "UAH" },
              items: [{ classification: { id: "09132000-3" } }],
              status: "complete",
            }) as never,
    });
  });

  it("знаходить за іншою формою слова", () => {
    // the source cannot do this: «доріг» and «дорозі» are separate tokens there
    for (const text of ["дорога", "доріг", "дорозі"]) {
      const result = searchIndex(db, { text });
      assert.equal(result.total, 1, `«${text}» не знайшло процедуру про дорогу`);
      assert.equal(result.rows[0]?.tender_id, "UA-2026-08-01-000001-a");
    }
  });

  it("фільтрує за ЄДРПОУ замовника, чого джерело не вміє", () => {
    const result = searchIndex(db, { buyerEdrpou: "87654321" });
    assert.equal(result.total, 1);
    assert.equal(result.rows[0]?.buyer_name, "Міськрада");
  });

  it("фільтрує за початком коду CPV", () => {
    assert.equal(searchIndex(db, { cpvPrefix: "45233" }).total, 1);
    assert.equal(searchIndex(db, { cpvPrefix: "09" }).total, 1);
    assert.equal(searchIndex(db, { cpvPrefix: "99" }).total, 0);
  });

  it("фільтрує за сумою і регіоном", () => {
    assert.equal(searchIndex(db, { minValue: 100000 }).total, 1);
    assert.equal(searchIndex(db, { region: "Львів" }).total, 1);
    assert.equal(searchIndex(db, { region: "Одеськ", maxValue: 100000 }).total, 0);
  });

  it("повідомляє, яка частка індексу має назву й суму", () => {
    const result = searchIndex(db, {});
    assert.equal(result.enrichedShare, 1);
  });

  it("не ламається на лапках і апострофах у запиті", () => {
    // an unescaped quote turns the whole query into an FTS5 syntax error
    for (const text of ['ремонт "дороги"', "зв'язку", 'лапка " всередині']) {
      assert.doesNotThrow(() => searchIndex(db, { text }), `запит «${text}» впав`);
    }
  });
});

describe("enrich", () => {
  it("бере найновіші й не повертається до вже оброблених", async () => {
    const { fetchPage } = fakeFeed([[entry(1), entry(2)]]);
    await crawl(db, { fetchPage, delayMs: 0, pageSize: 2 });

    const seen: string[] = [];
    const fetch = (async (id: string) => {
      seen.push(id);
      return { id, title: "Назва", value: { amount: 1 }, items: [] };
    }) as never;

    await enrich(db, { limit: 1, delayMs: 0, fetch });
    assert.deepEqual(seen, ["id-2"], "збагачення пішло не з найновішої процедури");

    await enrich(db, { limit: 1, delayMs: 0, fetch });
    assert.deepEqual(seen, ["id-2", "id-1"], "збагачення повернулось до вже обробленої");

    assert.equal(pendingEnrichment(db, 10).length, 0);
  });

  it("не перевищує заданої паралельності", async () => {
    // This is a national service: a pool that quietly grows would turn a backfill
    // into a flood.
    const { fetchPage } = fakeFeed([
      Array.from({ length: 12 }, (_, i) => entry(i + 1, { id: `id-${i + 1}` })),
    ]);
    await crawl(db, { fetchPage, delayMs: 0, pageSize: 12 });

    let inFlight = 0;
    let peak = 0;
    const fetch = (async (id: string) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return { id, title: "Назва", value: { amount: 1 }, items: [] };
    }) as never;

    await enrich(db, { limit: 12, delayMs: 0, concurrency: 3, fetch });

    assert.ok(peak <= 3, `одночасно виконувалось ${peak} запитів замість 3`);
    assert.ok(peak > 1, "паралельність не працює: запити йшли по одному");
  });

  it("переживає недоступну процедуру й не зупиняє прохід", async () => {
    const { fetchPage } = fakeFeed([[entry(1), entry(2)]]);
    await crawl(db, { fetchPage, delayMs: 0, pageSize: 2 });

    const fetch = (async (id: string) => {
      if (id === "id-2") throw new Error("503");
      return { id, title: "Назва", value: { amount: 1 }, items: [] };
    }) as never;

    const progress = await enrich(db, { limit: 10, delayMs: 0, fetch });

    assert.equal(progress.failed, 1);
    assert.equal(progress.updated, 1);
    assert.equal(
      pendingEnrichment(db, 10).length,
      1,
      "процедура, яку не вдалося взяти, має лишитись у черзі",
    );
  });
});
