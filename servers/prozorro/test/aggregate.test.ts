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

    const result = aggregate(db, { dimension: "month" });
    assert.equal(result.rows.length, 2, "процедури з різних років злились в один рядок");
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
