import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { openDatabase, toEpoch } from "../dist/index/db.js";
import { benchmark } from "../dist/analysis/benchmark.js";
import { describe as summarise, quantile, verdict } from "../dist/analysis/stats.js";
import { classifyUnit, summariseUnits } from "../dist/index/units.js";

/**
 * The dangerous part of the project. A wrong number here does not look wrong: it
 * looks like a confident finding about someone's procurement, and a person may
 * act on it. So the refusals are tested as carefully as the calculations.
 */

let db: ReturnType<typeof openDatabase>;

const day = 86_400;
const now = Math.floor(Date.now() / 1000);

function insert(row: {
  n: number;
  cpv?: string | null;
  unit?: string | null;
  quantity?: number | null;
  amount?: number | null;
  daysAgo?: number;
}) {
  const id = `id-${row.n}`;
  db.prepare(
    `insert into tenders (id, tender_id, modified, status, buyer_edrpou, title, value_amount, cpv, unit, quantity, unit_kind, enriched_at)
     values (?, ?, ?, 'complete', '12345678', ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    `UA-2026-01-${String(row.n).padStart(2, "0")}-000001-a`,
    now - (row.daysAgo ?? 1) * day,
    `Процедура ${row.n}`,
    row.amount ?? null,
    row.cpv === undefined ? "03220000-9" : row.cpv,
    row.unit === undefined ? "кілограм" : row.unit,
    row.quantity === undefined ? 100 : row.quantity,
    classifyUnit(row.unit === undefined ? "кілограм" : row.unit),
    now,
  );
  return `UA-2026-01-${String(row.n).padStart(2, "0")}-000001-a`;
}

/** Ten comparable procedures at 40 to 60 UAH per kilo, median 50. */
function marketOfTen() {
  for (let i = 1; i <= 10; i++) {
    insert({ n: i, amount: (40 + (i - 1) * (20 / 9)) * 100, quantity: 100 });
  }
}

beforeEach(() => {
  db = openDatabase(":memory:");
  db.prepare("insert into buyers (edrpou, name, region) values ('12345678', 'Сільрада', 'Одеська область')").run();
});

describe("статистика", () => {
  it("рахує квартилі так само, як R type 7", () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    assert.equal(quantile(sorted, 0.5), 5.5);
    assert.equal(quantile(sorted, 0.25), 3.25);
    assert.equal(quantile(sorted, 0.75), 7.75);
  });

  it("медіана не ведеться на один викид", () => {
    // this is why the tools never report a mean: one contract at fifty times the
    // going rate would move it somewhere no procedure ever was
    const normal = summarise([10, 11, 12, 13, 14])!;
    const withOutlier = summarise([10, 11, 12, 13, 14, 5000])!;

    assert.equal(normal.median, 12);
    assert.equal(withOutlier.median, 12.5, "викид зсунув медіану більш ніж на пів кроку");
  });

  it("відкидає нулі та відʼємні суми", () => {
    const d = summarise([0, -5, 10, 20, 30])!;
    assert.equal(d.count, 3);
    assert.equal(d.min, 10);
  });

  it("не має даних — не має розподілу", () => {
    assert.equal(summarise([]), null);
    assert.equal(summarise([0, -1]), null);
  });

  it("формулює висновок як привід перевірити, а не як звинувачення", () => {
    const high = verdict(2.5);
    assert.match(high.level, /перевірити/);
    assert.doesNotMatch(
      `${high.level} ${high.note}`,
      /завищен|порушен|змов|корупц/i,
      "формулювання перетворює відхилення на звинувачення",
    );
    assert.match(verdict(1.0).level, /у межах/);
  });
});

describe("одиниці виміру", () => {
  it("відрізняє вимірювані одиниці від опису роботи цілком", () => {
    assert.equal(classifyUnit("кілограм"), "measurable");
    assert.equal(classifyUnit("Штука"), "measurable");
    assert.equal(classifyUnit("послуга"), "whole");
    assert.equal(classifyUnit("обʼєкт"), "whole");
    assert.equal(classifyUnit("не знаю що це"), "unknown");
    assert.equal(classifyUnit(null), "unknown");
  });

  it("не дає кількості, коли одиниці в позиціях різні", () => {
    const mixed = summariseUnits([
      { quantity: 5, unit: { name: "кілограм" } },
      { quantity: 2, unit: { name: "штука" } },
    ]);
    assert.equal(mixed.unit, null);
    assert.equal(mixed.quantity, null);
  });

  it("складає кількість, коли одиниця одна", () => {
    const same = summariseUnits([
      { quantity: 5, unit: { name: "кілограм" } },
      { quantity: 7, unit: { name: "кілограм" } },
    ]);
    assert.equal(same.unit, "кілограм");
    assert.equal(same.quantity, 12);
  });
});

describe("порівняння ціни", () => {
  it("рахує ціну за одиницю і ставить процедуру в розподіл", () => {
    marketOfTen();
    const subject = insert({ n: 20, amount: 100 * 100, quantity: 100 }); // 100 грн/кг

    const result = benchmark(db, { tenderID: subject });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.mode, "за одиницю");
    assert.equal(result.distribution.count, 10);
    assert.equal(Math.round(result.distribution.median), 50);
    assert.equal(result.position.ratioToMedian, 2);
    assert.equal(result.position.dearerCount, 0, "дорожчих за 100 грн/кг у вибірці бути не може");
  });

  it("повторний виклик дає той самий результат", () => {
    marketOfTen();
    const subject = insert({ n: 20, amount: 100 * 100, quantity: 100 });

    const first = benchmark(db, { tenderID: subject });
    const second = benchmark(db, { tenderID: subject });
    assert.equal(JSON.stringify(first), JSON.stringify(second));
  });

  it("показує вибірку, на якій зроблено висновок", () => {
    // a verdict without the sample behind it is an opinion, not a measurement
    marketOfTen();
    const subject = insert({ n: 20, amount: 100 * 100, quantity: 100 });

    const result = benchmark(db, { tenderID: subject });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.ok(result.sample.length > 0, "вибірка порожня");
    assert.ok(result.distribution.count >= 8, "не видно, скільки процедур у вибірці");
    assert.ok(result.period.from && result.period.to, "не видно періоду вибірки");
    for (const item of result.sample) {
      assert.ok(item.tenderID, "у прикладі немає номера, його неможливо перевірити");
      assert.ok(item.date, "у прикладі немає дати");
    }
  });

  it("відмовляється рахувати, коли схожих замало", () => {
    for (let i = 1; i <= 4; i++) insert({ n: i, amount: 5000, quantity: 100 });
    const subject = insert({ n: 20, amount: 9000, quantity: 100 });

    const result = benchmark(db, { tenderID: subject });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "too_few_comparables");
    assert.match(result.message, /Медіана з такої кількості це не орієнтир/);
  });

  it("не змішує різні одиниці виміру", () => {
    // ten procedures per kilo, and the subject measured in pieces: comparing them
    // is exactly the mistake this tool exists to avoid
    marketOfTen();
    const subject = insert({ n: 20, unit: "штука", amount: 100 * 100, quantity: 100 });

    const result = benchmark(db, { tenderID: subject });
    assert.equal(result.ok, false, "порівняв кілограми зі штуками");
    if (result.ok) return;
    assert.equal(result.reason, "too_few_comparables");
  });

  it("відмовляється, коли одиниця невідома", () => {
    marketOfTen();
    const subject = insert({ n: 20, unit: "казна-що", amount: 1000, quantity: 5 });

    const result = benchmark(db, { tenderID: subject });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "no_unit");
  });

  it("відмовляється без коду CPV", () => {
    marketOfTen();
    const subject = insert({ n: 20, cpv: null, amount: 1000, quantity: 5 });

    const result = benchmark(db, { tenderID: subject });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "no_cpv");
  });

  it("каже, коли процедури немає в індексі", () => {
    const result = benchmark(db, { tenderID: "UA-2020-01-01-000001-a" });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "not_in_index");
    assert.match(result.message, /proyav_index_status/);
  });

  it("попереджає про різнорідну групу CPV", () => {
    // one code holding watermelons and parsley: the median is a weak reference
    for (let i = 1; i <= 10; i++) {
      insert({ n: i, amount: (i === 10 ? 5000 : 10) * 100, quantity: 100 });
    }
    const subject = insert({ n: 20, amount: 50 * 100, quantity: 100 });

    const result = benchmark(db, { tenderID: subject });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.homogeneity.reliable, false);
    assert.ok(
      result.caveats.some((c) => /різнорідна/.test(c)),
      "не попередив, що в групі лежать різні товари",
    );
  });

  it("не заглядає у майбутнє", () => {
    marketOfTen();
    const subject = insert({ n: 20, amount: 5000, quantity: 100 });

    const result = benchmark(db, { tenderID: subject, windowDays: 900 });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.ok(
      new Date(result.period.to).getTime() <= Date.now(),
      `період закінчується в майбутньому: ${result.period.to}`,
    );
  });

  it("порівнює загальні суми, коли одиниця описує роботу цілком", () => {
    for (let i = 1; i <= 10; i++) {
      insert({ n: i, unit: "послуга", quantity: 1, amount: 100_000 + i * 1000 });
    }
    const subject = insert({ n: 20, unit: "послуга", quantity: 1, amount: 300_000 });

    const result = benchmark(db, { tenderID: subject });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.mode, "за всю закупівлю");
    assert.equal(result.unit, null);
    assert.ok(
      result.caveats.some((c) => /Обсяг робіт/.test(c)),
      "не попередив, що обсяг робіт може відрізнятись у рази",
    );
  });
});
