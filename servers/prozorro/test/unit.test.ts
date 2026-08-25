import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { money, projectHit, projectTender } from "../dist/format.js";

/** Pure logic only: no network, so this stays green even when a source is down. */

/** Intl separates thousands with a non-breaking space, so comparisons normalise it. */
const plain = (value: string | null) => value?.replace(/[\u00a0\u202f]/g, " ") ?? null;

describe("money", () => {
  it("форматує суму з валютою", () => {
    assert.equal(
      plain(money({ amount: 1234567.5, currency: "UAH" })),
      "1 234 567,5 UAH",
    );
  });

  it("вважає гривню валютою за замовчуванням", () => {
    assert.equal(money({ amount: 100 }), "100 UAH");
  });

  it("не ковтає нуль", () => {
    assert.equal(money({ amount: 0, currency: "UAH" }), "0 UAH");
  });

  it("повертає null, коли суми немає", () => {
    assert.equal(money(undefined), null);
    assert.equal(money({ currency: "UAH" }), null);
  });
});

describe("projectHit", () => {
  const hit = {
    tenderID: "UA-2026-08-25-000001-a",
    title: "  Ремонт дороги  ",
    status: "active.tendering",
    value: { amount: 500000, currency: "UAH" },
    procuringEntity: {
      name: "Сільська рада",
      identifier: { id: "12345678", legalName: "Виконком сільської ради" },
      address: { region: "Одеська область", locality: "Таїрове" },
    },
  };

  it("обрізає пробіли в назві", () => {
    assert.equal(projectHit(hit).title, "Ремонт дороги");
  });

  it("витягує замовника у пласку структуру", () => {
    const card = projectHit(hit);
    assert.equal(card.buyer.edrpou, "12345678");
    assert.equal(card.buyer.region, "Одеська область");
  });

  it("бере legalName, коли назви немає", () => {
    const card = projectHit({ ...hit, procuringEntity: { ...hit.procuringEntity, name: undefined } });
    assert.equal(card.buyer.name, "Виконком сільської ради");
  });

  it("будує посилання на публічну сторінку", () => {
    assert.equal(
      projectHit(hit).url,
      "https://prozorro.gov.ua/tender/UA-2026-08-25-000001-a",
    );
  });
});

describe("projectTender", () => {
  const tender = {
    id: "0".repeat(32),
    tenderID: "UA-2026-08-25-000002-a",
    title: "Закупівля палива",
    status: "complete",
    value: { amount: 130000, currency: "UAH" },
    items: Array.from({ length: 14 }, (_, i) => ({
      description: `Позиція ${i + 1}`,
      quantity: i + 1,
      unit: { name: "літр" },
      classification: { id: "09132000-3", description: "Бензин" },
    })),
    bids: [
      {
        status: "active",
        value: { amount: 128000, currency: "UAH" },
        tenderers: [{ name: "ТОВ Перший", identifier: { id: "11111111" } }],
      },
      {
        status: "active",
        value: { amount: 129500, currency: "UAH" },
        tenderers: [{ name: "ТОВ Другий", identifier: { id: "22222222" } }],
      },
    ],
    awards: [
      {
        status: "active",
        value: { amount: 128000, currency: "UAH" },
        date: "2026-08-20T10:00:00+03:00",
        suppliers: [{ name: "ТОВ Перший", identifier: { id: "11111111" } }],
      },
      {
        status: "cancelled",
        suppliers: [{ name: "ТОВ Третій", identifier: { id: "33333333" } }],
      },
    ],
    documents: [{}, {}, {}],
  };

  it("показує щонайбільше десять позицій і каже, скільки їх насправді", () => {
    const card = projectTender(tender);
    assert.equal(card.items.length, 10);
    assert.equal(card.counts.items, 14);
    assert.match(card.note ?? "", /10 позицій з 14/);
  });

  it("не додає примітку, коли позицій мало", () => {
    const card = projectTender({ ...tender, items: tender.items.slice(0, 3) });
    assert.equal(card.note, undefined);
  });

  it("вважає переможцем лише активне рішення", () => {
    const card = projectTender(tender);
    assert.equal(card.winners.length, 1);
    assert.equal(card.winners[0].edrpou, "11111111");
  });

  it("рахує те, що лишилось за кадром", () => {
    const card = projectTender(tender);
    assert.deepEqual(card.counts, {
      items: 14,
      bids: 2,
      awards: 2,
      contracts: 0,
      documents: 3,
      cancellations: 0,
    });
  });

  it("переживає процедуру без позицій, ставок і рішень", () => {
    const card = projectTender({ id: "a".repeat(32), tenderID: "UA-1", status: "draft" });
    assert.deepEqual(card.items, []);
    assert.deepEqual(card.winners, []);
    assert.equal(card.counts.bids, 0);
    assert.equal(card.expectedValue, null);
  });
});
