import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { openDatabase } from "../dist/index/db.js";
import { aggregate, compareBuyers } from "../dist/analysis/aggregate.js";

/**
 * An aggregate is the one place where a partial index lies convincingly:
 * «витрачено 4 млн» reads as a fact even when the index holds a tenth of the
 * period. So coverage is tested as strictly as the sums.
 */

let db: ReturnType<typeof openDatabase>;
const day = 86_400;
const now = Math.floor(Date.now() / 1000);

function buyer(edrpou: string, name: string, region: string) {
  db.prepare("insert or ignore into buyers (edrpou, name, region) values (?, ?, ?)").run(
    edrpou,
    name,
    region,
  );
}

function tender(row: {
  n: number;
  edrpou?: string;
  amount?: number | null;
  cpv?: string;
  unit?: string | null;
  quantity?: number | null;
  daysAgo?: number;
  status?: string;
}) {
  db.prepare(
    `insert into tenders (id, tender_id, modified, status, buyer_edrpou, title, value_amount, cpv, unit, quantity, unit_kind, enriched_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'measurable', ?)`,
  ).run(
    `id-${row.n}`,
    `UA-2026-01-${String(row.n).padStart(3, "0")}-a`,
    now - (row.daysAgo ?? 1) * day,
    row.status ?? "complete",
    row.edrpou ?? "11111111",
    `Процедура ${row.n}`,
    row.amount === undefined ? 1000 : row.amount,
    row.cpv ?? "03220000-9",
    row.unit === undefined ? "кілограм" : row.unit,
    row.quantity === undefined ? 10 : row.quantity,
    now,
  );
}

beforeEach(() => {
  db = openDatabase(":memory:");
  buyer("11111111", "Перша рада", "Одеська область");
  buyer("22222222", "Друга рада", "Львівська область");
});

describe("aggregate", () => {
  it("сумує за замовниками і рахує медіану кожного", () => {
    tender({ n: 1, amount: 100 });
    tender({ n: 2, amount: 300 });
    tender({ n: 3, edrpou: "22222222", amount: 50 });

    const result = aggregate(db, { dimension: "buyer" });

    assert.equal(result.rows.length, 2);
    assert.equal(result.rows[0]?.label, "Перша рада");
    assert.equal(result.rows[0]?.total, 400);
    assert.equal(result.rows[0]?.median, 200);
    assert.equal(result.rows[1]?.total, 50);
  });

  it("групує за місяцями", () => {
    tender({ n: 1, daysAgo: 1, amount: 10 });
    tender({ n: 2, daysAgo: 2, amount: 20 });
    tender({ n: 3, daysAgo: 400, amount: 30 });

    // Explicit period: without one the default window would leave the older
    // procedure out, and this test is about grouping, not about the window.
    const result = aggregate(db, { dimension: "month", from: "2000-01-01" });
    assert.equal(result.rows.length, 2, "процедури з різних років злились в один рядок");
  });

  it("без періоду бере останні місяці, а не всю історію", () => {
    // Summing everything ever indexed took 288 seconds on the real index and
    // returned the least trustworthy number available: coverage across eleven
    // years is a few percent. A missing period now means the recent past.
    tender({ n: 1, daysAgo: 1, amount: 10 });
    tender({ n: 2, daysAgo: 400, amount: 999 });

    const result = aggregate(db, { dimension: "month" });

    assert.equal(result.totals.procedures, 1, "у підсумок потрапила процедура поза вікном");
    assert.ok(
      result.caveats.some((c) => /Період не задано/.test(c)),
      "вікно підставлено мовчки, без попередження",
    );
  });

  it("не підставляє вікно, коли період задано явно", () => {
    tender({ n: 1, daysAgo: 1, amount: 10 });
    tender({ n: 2, daysAgo: 400, amount: 999 });

    const result = aggregate(db, { dimension: "month", from: "2000-01-01" });

    assert.equal(result.totals.procedures, 2);
    assert.ok(
      !result.caveats.some((c) => /Період не задано/.test(c)),
      "попередження про вікно з'явилось там, де період задано",
    );
  });

  it("застосовує фільтри до вибірки", () => {
    tender({ n: 1, amount: 100 });
    tender({ n: 2, edrpou: "22222222", amount: 200 });

    assert.equal(aggregate(db, { dimension: "buyer", region: "Львів" }).rows.length, 1);
    assert.equal(aggregate(db, { dimension: "buyer", cpvPrefix: "9999" }).rows.length, 0);
    assert.equal(
      aggregate(db, { dimension: "buyer", from: new Date((now + day) * 1000).toISOString().slice(0, 10) }).rows.length,
      0,
      "фільтр за датою пропустив процедури з минулого",
    );
  });

  it("попереджає, коли суму має меншість процедур", () => {
    tender({ n: 1, amount: 1000 });
    for (let i = 2; i <= 10; i++) tender({ n: i, amount: null });

    const result = aggregate(db, { dimension: "buyer" });

    assert.equal(result.coverage.withAmount, 1);
    assert.equal(result.coverage.inWindow, 10);
    assert.ok(result.coverage.note, "неповне покриття лишилось без попередження");
    assert.match(result.coverage.note!, /нижня межа/);
  });

  it("не дає назвати підсумком те, де суму має мізерна частка", () => {
    // The real index measured 27.08.2026: 4 500 amounts across 30 033 519
    // rows. At that ratio the old wording ("нижня межа") was too mild — it
    // still invites presenting the number as a total — and the share itself
    // rounded to 0.000, which reads as no data rather than a thin slice.
    // The ratio has to be as thin as production (1 : 6 674) — at 1 : 100 the
    // old toFixed(3) still shows 0.010 and the bug hides.
    tender({ n: 1, amount: 1000 });
    for (let i = 2; i <= 3000; i++) tender({ n: i, amount: null });

    const result = aggregate(db, { dimension: "buyer" });

    assert.ok(result.coverage.share > 0, "частка округлилась у нуль і перестала щось означати");
    assert.ok(result.coverage.note, "мізерне покриття лишилось без попередження");
    assert.match(result.coverage.note!, /надто мало/);
  });

  it("мовчить про покриття, коли воно повне", () => {
    tender({ n: 1, amount: 100 });
    tender({ n: 2, amount: 200 });

    const result = aggregate(db, { dimension: "buyer" });
    assert.equal(result.coverage.share, 1);
    assert.equal(result.coverage.note, undefined);
  });

  it("завжди нагадує, що це очікувана вартість", () => {
    tender({ n: 1, amount: 100 });
    const result = aggregate(db, { dimension: "buyer" });
    assert.ok(result.caveats.some((c) => /очікувана вартість/.test(c)));
  });
});

describe("відтворюваність", () => {
  it("однакові суми не міняють порядок від виклику до виклику", () => {
    // Honest note: this one passes with or without the explicit tiebreaker in the
    // query, checked by removing it. SQLite's GROUP BY always emits rows ordered
    // by the grouping key, so ties are stable today by accident of the engine
    // rather than by promise. The tiebreaker stays because SQL guarantees nothing
    // here and a future index or plan change would be silent; the test stays as a
    // canary for that day, not as proof of a bug that was fixed.
    for (let i = 1; i <= 10; i++) {
      db.prepare("insert or ignore into buyers (edrpou, name, region) values (?, ?, 'Область')").run(
        String(i).padStart(8, "0"),
        `Рада ${i}`,
      );
      tender({ n: i, edrpou: String(i).padStart(8, "0"), amount: 1000 });
    }

    const runs = new Set(
      Array.from({ length: 5 }, () =>
        aggregate(db, { dimension: "buyer", limit: 4 })
          .rows.map((r) => r.key)
          .join(","),
      ),
    );

    assert.equal(runs.size, 1, `порядок плаває: ${[...runs].join(" | ")}`);
  });

  it("той самий запит дає ті самі числа", () => {
    tender({ n: 1, amount: 100 });
    tender({ n: 2, amount: 300 });

    const first = JSON.stringify(aggregate(db, { dimension: "buyer" }).rows);
    const second = JSON.stringify(aggregate(db, { dimension: "buyer" }).rows);
    assert.equal(first, second);
  });
});

describe("compareBuyers", () => {
  it("порівнює ціну за одиницю між замовниками", () => {
    // Перша рада: 10 і 20 грн/кг, Друга: 100 грн/кг
    tender({ n: 1, amount: 100, quantity: 10 });
    tender({ n: 2, amount: 200, quantity: 10 });
    tender({ n: 3, edrpou: "22222222", amount: 1000, quantity: 10 });

    const result = compareBuyers(db, { cpv: "03220000-9", unit: "кілограм" });
    assert.ok(!("error" in result));
    if ("error" in result) return;

    assert.equal(result.mode, "за одиницю");
    assert.equal(result.buyers[0]?.name, "Друга рада");
    assert.equal(result.buyers[0]?.median, 100);
    assert.equal(result.buyers[1]?.median, 15);
    assert.equal(result.buyers[1]?.procedures, 2);
  });

  it("без одиниці порівнює суми і каже про це", () => {
    tender({ n: 1, amount: 100, quantity: 1 });
    tender({ n: 2, edrpou: "22222222", amount: 500, quantity: 100 });

    const result = compareBuyers(db, { cpv: "03220000-9" });
    assert.ok(!("error" in result));
    if ("error" in result) return;

    assert.equal(result.mode, "за всю закупівлю");
    assert.ok(
      result.caveats.some((c) => /краще вказати unit/.test(c)),
      "не порадив уточнити одиницю виміру",
    );
  });

  it("не змішує різні одиниці", () => {
    tender({ n: 1, amount: 100, quantity: 10 });
    tender({ n: 2, edrpou: "22222222", unit: "штука", amount: 900, quantity: 10 });

    const result = compareBuyers(db, { cpv: "03220000-9", unit: "кілограм" });
    assert.ok(!("error" in result));
    if ("error" in result) return;

    assert.equal(result.buyers.length, 1, "у вибірку потрапив замовник з іншою одиницею");
  });

  it("каже, коли даних немає, замість порожньої таблиці", () => {
    const result = compareBuyers(db, { cpv: "99999999-9" });
    assert.ok("error" in result);
    if (!("error" in result)) return;
    assert.equal(result.error, "no_data");
    assert.match(result.message, /proyav_index_status/);
  });

  it("нагадує, що одна процедура це не показник", () => {
    tender({ n: 1, amount: 100, quantity: 10 });
    const result = compareBuyers(db, { cpv: "03220000-9", unit: "кілограм" });
    assert.ok(!("error" in result));
    if ("error" in result) return;
    assert.ok(result.caveats.some((c) => /не показник/.test(c)));
  });
});
