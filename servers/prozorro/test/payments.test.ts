import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dateWindows, MAX_RANGE_DAYS } from "../dist/sources/edata.js";
import { summarisePayments } from "../dist/analysis/payments.js";

/**
 * Є-data answers about money that actually moved, so a quiet error here does
 * not look like a bug — it looks like a number about a named organisation.
 * The two things guarded hardest are the ones that would produce exactly that:
 * a date window that drops days, and a summary that attributes payments to the
 * wrong side of the transfer.
 */

const tx = (over: Record<string, unknown> = {}) => ({
  id: 1,
  trans_date: "2026-06-10",
  amount: 100,
  currency: "UAH",
  payer_edrpou: "00022585",
  payer_name: "ОДА",
  recipt_edrpou: "36611683",
  recipt_name: "ТОВ ПІДРЯДНИК",
  payment_details: "оплата за роботи",
  ...over,
});

describe("вікна дат", () => {
  it("не розбиває період, що вміщується в обмеження джерела", () => {
    const windows = dateWindows("2026-06-01", "2026-06-30");
    assert.equal(windows.length, 1);
    assert.deepEqual(windows[0], { from: "2026-06-01", to: "2026-06-30" });
  });

  it("розбиває довгий період і не губить жодного дня", () => {
    // A gap between windows would silently drop payments, and the total would
    // still look plausible — the worst kind of wrong answer here.
    const windows = dateWindows("2026-01-01", "2026-12-31");
    assert.ok(windows.length > 1, "рік не розбито на вікна");

    assert.equal(windows[0].from, "2026-01-01");
    assert.equal(windows[windows.length - 1].to, "2026-12-31");

    for (let i = 1; i < windows.length; i++) {
      const previousEnd = new Date(`${windows[i - 1].to}T00:00:00Z`);
      const nextStart = new Date(`${windows[i].from}T00:00:00Z`);
      const gapDays = (nextStart.getTime() - previousEnd.getTime()) / 86_400_000;
      assert.equal(gapDays, 1, `між вікнами ${i - 1} і ${i} загублено дні`);
    }
  });

  it("жодне вікно не ширше за дозволене джерелом", () => {
    for (const w of dateWindows("2020-01-01", "2026-12-31")) {
      const days =
        (new Date(`${w.to}T00:00:00Z`).getTime() - new Date(`${w.from}T00:00:00Z`).getTime()) /
          86_400_000 +
        1;
      assert.ok(days <= MAX_RANGE_DAYS, `вікно ${w.from}..${w.to} має ${days} днів`);
    }
  });

  it("відмовляється від перевернутого періоду замість тихої порожньої відповіді", () => {
    assert.throws(() => dateWindows("2026-08-01", "2026-06-01"), /Початок періоду пізніший/);
  });

  it("відмовляється від дати не в тому форматі", () => {
    assert.throws(() => dateWindows("01.06.2026", "30.06.2026"), /РРРР-ММ-ДД/);
  });
});

describe("підсумок платежів", () => {
  it("для отримувача рахує контрагентами тих, хто платив", async () => {
    const result = await summarisePayments({
      edrpou: "36611683",
      side: "recipient",
      from: "2026-06-01",
      to: "2026-06-30",
      fetch: (async () => [tx(), tx({ amount: 50 })]) as never,
    });

    assert.equal(result.transactions, 2);
    assert.equal(result.total, 150);
    assert.equal(result.counterparts[0].edrpou, "00022585", "контрагентом взято не платника");
  });

  it("для платника рахує контрагентами тих, хто отримував", async () => {
    const result = await summarisePayments({
      edrpou: "00022585",
      side: "payer",
      from: "2026-06-01",
      to: "2026-06-30",
      fetch: (async () => [tx()]) as never,
    });

    assert.equal(result.counterparts[0].edrpou, "36611683", "контрагентом взято не отримувача");
  });

  it("складає всі вікна, а не лише перше", async () => {
    let calls = 0;
    const result = await summarisePayments({
      edrpou: "36611683",
      side: "recipient",
      from: "2026-01-01",
      to: "2026-12-31",
      fetch: (async () => {
        calls++;
        return [tx({ amount: 10 })];
      }) as never,
    });

    assert.ok(calls > 1, "довгий період не був розбитий на запити");
    assert.equal(result.transactions, calls, "частина вікон загубилась при складанні");
    assert.equal(result.total, calls * 10);
  });

  it("завжди попереджає, що платіж не дорівнює вартості робіт", async () => {
    const result = await summarisePayments({
      edrpou: "36611683",
      side: "recipient",
      from: "2026-06-01",
      to: "2026-06-30",
      fetch: (async () => [tx()]) as never,
    });

    assert.ok(result.caveats.some((c) => /аванс/i.test(c)));
    assert.ok(result.caveats.some((c) => /не всі видатки проходять через казначейство/i.test(c)));
  });

  it("порожній період не подається як «нічого не отримувала»", async () => {
    const result = await summarisePayments({
      edrpou: "36611683",
      side: "recipient",
      from: "2026-06-01",
      to: "2026-06-30",
      fetch: (async () => []) as never,
    });

    assert.equal(result.total, 0);
    assert.ok(
      result.caveats.some((c) => /не означає/i.test(c)),
      "порожня відповідь подана як факт відсутності платежів",
    );
  });
});
