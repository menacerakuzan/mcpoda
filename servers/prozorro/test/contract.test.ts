import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { searchTenders, SOURCE_PAGE_SIZE } from "../dist/sources/search.js";
import { fetchFeedPage, fetchTender } from "../dist/sources/cdb.js";
import { requestJson } from "../dist/http.js";

const SEARCH_URL = "https://prozorro.gov.ua/api/search/tenders";

/**
 * The typed client only forwards fields the server actually uses, so probing how
 * the source treats other parameters has to go over raw HTTP.
 */
const rawSearch = (body: Record<string, unknown>) =>
  requestJson<{ total: number; data: Array<{ tenderID?: string }> }>(SEARCH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

/**
 * These hit the live sources on purpose, and they import from `dist` rather than
 * `src`: what ships is what gets checked.
 *
 * Both APIs are undocumented, and every fact below was discovered by probing
 * rather than reading a spec. If a source changes, the failure has to be loud
 * and specific: the alternative is the server quietly returning nothing and the
 * assistant telling a person there are no procurements, which is the worst
 * possible outcome for a transparency tool.
 *
 * Run: npm run test:contract
 */

const TIMEOUT = 40_000;

describe("пошуковий сервіс prozorro.gov.ua", { timeout: TIMEOUT }, () => {
  it("повертає рівно 20 записів і ігнорує прохання про інший розмір", async () => {
    const response = await searchTenders({ text: "ремонт" });

    assert.equal(
      response.data.length,
      SOURCE_PAGE_SIZE,
      "розмір сторінки змінився: перевірте SOURCE_PAGE_SIZE і логіку набору limit",
    );
    assert.equal(response.per_page, SOURCE_PAGE_SIZE);
  });

  it("нумерує сторінки з одиниці й віддає page луною", async () => {
    const [first, second] = await Promise.all([
      searchTenders({ text: "ремонт", page: 1 }),
      searchTenders({ text: "ремонт", page: 2 }),
    ]);

    assert.equal(first.page, 1, "джерело перестало повертати надісланий page");
    assert.equal(second.page, 2);
    assert.notEqual(
      first.data[0]?.tenderID,
      second.data[0]?.tenderID,
      "сторінки перестали відрізнятись: пагінація зламана",
    );
  });

  it("відхиляє порожній текст", async () => {
    await assert.rejects(
      () => searchTenders({ text: "" }),
      /422|The text must be a string/,
      "порожній текст почав прийматися: опис інструмента більше не відповідає джерелу",
    );
  });

  it("фільтрує за статусом", async () => {
    const response = await searchTenders({
      text: "ремонт дороги",
      status: ["active.tendering"],
    });

    assert.ok(response.data.length > 0, "за статусом нічого не знайшлось");
    for (const hit of response.data) {
      assert.equal(
        hit.status,
        "active.tendering",
        "фільтр за статусом перестав працювати",
      );
    }
  });

  it("мовчки ігнорує cpv та edrpou", async () => {
    // Both are accepted and then dropped: the response is identical to a query
    // without them. The server therefore never sends them and filters on its
    // own side. If this test fails, the source has grown real filters and the
    // index can stop doing that work.
    const plain = await rawSearch({ text: "ремонт дороги", page: 1 });
    const withFilters = await rawSearch({
      text: "ремонт дороги",
      page: 1,
      cpv: ["45233142-6"],
      edrpou: ["00000000"],
    });

    assert.equal(
      withFilters.total,
      plain.total,
      "джерело почало враховувати cpv або edrpou: приберіть фільтрацію на своєму боці",
    );
    assert.equal(
      withFilters.data[0]?.tenderID,
      plain.data[0]?.tenderID,
      "видача з фільтрами відрізняється: джерело їх більше не ігнорує",
    );
  });

  it("не приймає region як назву області", async () => {
    // The parameter exists but expects an opaque numeric code and behaves
    // inconsistently, so the server filters by region name itself.
    await assert.rejects(
      () => rawSearch({ text: "ремонт", page: 1, region: "Одеська область" }),
      /422|region/i,
      "region почав приймати назву області: фільтрацію можна віддати джерелу",
    );
  });

  it("тримає стелю видачі на 10 000 збігів", async () => {
    const response = await searchTenders({ text: "послуги" });
    assert.ok(
      response.total <= 10_000,
      `стеля змінилася: total = ${response.total}. Це добра новина, оновіть опис інструмента`,
    );
  });

  it("віддає поля, на які спирається проєкція", async () => {
    const [hit] = (await searchTenders({ text: "ремонт дороги" })).data;

    assert.ok(hit, "порожня видача на запит, який завжди щось знаходив");
    assert.equal(typeof hit.tenderID, "string");
    assert.equal(typeof hit.title, "string");
    assert.equal(typeof hit.status, "string");
    assert.ok(
      hit.procuringEntity?.identifier?.id,
      "зник ЄДРПОУ замовника: ламається фільтр за регіоном і картка",
    );
    assert.ok(
      hit.procuringEntity?.address?.region,
      "зник регіон замовника: фільтр за регіоном працює саме на цьому полі",
    );
  });
});

describe("стрічка змін CDB", { timeout: TIMEOUT }, () => {
  it("віддає до 1000 записів за сторінку", async () => {
    const page = await fetchFeedPage({ limit: 1000, fields: ["tenderID"] });
    assert.equal(
      page.data.length,
      1000,
      "стеля сторінки змінилась: краулер треба переналаштувати",
    );
  });

  it("приймає offset у вигляді дати", async () => {
    const page = await fetchFeedPage({ limit: 5, offset: "2026-06-15" });
    const first = page.data[0]?.dateModified;

    assert.ok(first, "стрічка не повернула dateModified");
    assert.ok(
      new Date(first).getTime() >= new Date("2026-06-15T00:00:00Z").getTime(),
      "offset датою перестав працювати: на цьому тримається резолв номера",
    );
  });

  it("іде у зворотному порядку з descending", async () => {
    const page = await fetchFeedPage({ limit: 10, descending: true });
    const dates = page.data.map((entry) => new Date(entry.dateModified).getTime());

    for (let i = 1; i < dates.length; i++) {
      assert.ok(dates[i] <= dates[i - 1], "порядок у descending порушено");
    }
  });

  it("інлайнить лише дозволені поля і ніколи title чи value", async () => {
    const page = await fetchFeedPage({
      limit: 1,
      descending: true,
      fields: ["status", "tenderID", "procuringEntity", "procurementMethodType"],
    });
    const [entry] = page.data;

    assert.ok(entry, "стрічка порожня");
    assert.ok(entry.tenderID, "tenderID зник зі стрічки: ламається резолв номера");
    assert.ok(entry.status, "status зник зі стрічки");
    assert.ok(entry.procuringEntity, "procuringEntity зник зі стрічки");

    const loose = entry as Record<string, unknown>;
    assert.equal(
      loose.title,
      undefined,
      "стрічка почала віддавати title: збагачення карток можна спростити",
    );
    assert.equal(
      loose.value,
      undefined,
      "стрічка почала віддавати value: збагачення карток можна спростити",
    );
  });
});

describe("картка процедури CDB", { timeout: TIMEOUT }, () => {
  it("розкривається за внутрішнім id зі стрічки", async () => {
    const page = await fetchFeedPage({ limit: 1, descending: true });
    const entry = page.data[0];
    assert.ok(entry, "стрічка порожня");

    const tender = await fetchTender(entry.id);

    assert.equal(tender.id, entry.id);
    assert.equal(typeof tender.tenderID, "string");
    assert.equal(typeof tender.status, "string");
    assert.ok(
      "title" in tender,
      "у картці зник title: проєкція розрахована саме на нього",
    );
  });
});
