import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  findSignals,
  mailDomain,
  normalizeAddress,
  normalizePhone,
  describeCompetition,
  type Bidder,
} from "../dist/analysis/connections.js";
import { checkTender } from "../dist/analysis/check.js";

/**
 * The most dangerous file in the project. A false signal here does not look like
 * a bug: it looks like a finding about a named company, and someone may repeat it
 * publicly. So the wording is tested as strictly as the logic.
 */

const bidder = (over: Partial<Bidder> & { edrpou: string }): Bidder => ({
  name: `ТОВ ${over.edrpou}`,
  phone: null,
  email: null,
  address: null,
  contactName: null,
  submittedAt: null,
  amount: 1000,
  status: "active",
  ...over,
});

describe("нормалізація", () => {
  it("зводить різні записи одного телефону", () => {
    const forms = ["+380971112233", "380971112233", "0971112233", "(097) 111-22-33"];
    const normalized = new Set(forms.map(normalizePhone));
    assert.equal(normalized.size, 1, `розійшлись: ${[...normalized].join(" | ")}`);
  });

  it("ігнорує огризки замість номера", () => {
    assert.equal(normalizePhone("123"), null);
    assert.equal(normalizePhone(""), null);
    assert.equal(normalizePhone(null), null);
  });

  it("зводить адресу, записану по-різному", () => {
    assert.equal(
      normalizeAddress("м. Київ, вул. Хрещатик, буд. 22"),
      normalizeAddress("Київ вулиця Хрещатик будинок 22"),
    );
  });

  it("не вважає адресою назву міста", () => {
    // «київ» alone would match thousands of unrelated companies
    assert.equal(normalizeAddress("Київ"), null);
    assert.equal(normalizeAddress("м. Львів"), null);
  });

  it("бере домен пошти", () => {
    assert.equal(mailDomain("ivan@firma.com.ua"), "firma.com.ua");
    assert.equal(mailDomain("не пошта"), null);
  });
});

describe("сигнали", () => {
  it("бачить спільний телефон у різних записах", () => {
    const signals = findSignals([
      bidder({ edrpou: "1", phone: "+380971112233" }),
      bidder({ edrpou: "2", phone: "0971112233" }),
    ]);
    assert.equal(signals.filter((s) => s.kind === "shared_phone").length, 1);
  });

  it("не рахує gmail за спільний домен", () => {
    // half the country writes from gmail: flagging it would bury every real signal
    for (const domain of ["gmail.com", "ukr.net", "i.ua", "outlook.com"]) {
      const signals = findSignals([
        bidder({ edrpou: "1", email: `a@${domain}` }),
        bidder({ edrpou: "2", email: `b@${domain}` }),
      ]);
      assert.equal(
        signals.length,
        0,
        `публічний домен ${domain} видано за сигнал`,
      );
    }
  });

  it("бачить спільний власний домен", () => {
    const signals = findSignals([
      bidder({ edrpou: "1", email: "a@firma.com.ua" }),
      bidder({ edrpou: "2", email: "b@firma.com.ua" }),
    ]);
    assert.equal(signals[0]?.kind, "shared_mail_domain");
  });

  it("не порівнює компанію саму з собою", () => {
    // the same EDRPOU twice is a data quirk, not a connection
    const signals = findSignals([
      bidder({ edrpou: "1", phone: "0971112233" }),
      bidder({ edrpou: "1", phone: "0971112233" }),
    ]);
    assert.equal(signals.length, 0);
  });

  it("мовчить, коли контактів немає", () => {
    assert.equal(findSignals([bidder({ edrpou: "1" }), bidder({ edrpou: "2" })]).length, 0);
  });

  it("позначає близьку подачу лише в межах вікна", () => {
    const near = findSignals([
      bidder({ edrpou: "1", submittedAt: "2026-08-01T12:00:00Z" }),
      bidder({ edrpou: "2", submittedAt: "2026-08-01T12:10:00Z" }),
    ]);
    const far = findSignals([
      bidder({ edrpou: "1", submittedAt: "2026-08-01T12:00:00Z" }),
      bidder({ edrpou: "2", submittedAt: "2026-08-01T18:00:00Z" }),
    ]);

    assert.equal(near.length, 1);
    assert.equal(far.length, 0);
  });

  it("кожен сигнал несе буденне пояснення", () => {
    const signals = findSignals([
      bidder({
        edrpou: "1",
        phone: "0971112233",
        email: "a@firma.com.ua",
        address: "Київ, вул. Хрещатик 22",
        contactName: "Іван Петренко",
        submittedAt: "2026-08-01T12:00:00Z",
      }),
      bidder({
        edrpou: "2",
        phone: "+380971112233",
        email: "b@firma.com.ua",
        address: "м. Київ вул. Хрещатик буд. 22",
        contactName: "Іван Петренко",
        submittedAt: "2026-08-01T12:05:00Z",
      }),
    ]);

    assert.equal(signals.length, 5, "не всі види сигналів спрацювали");
    for (const signal of signals) {
      assert.ok(
        signal.innocent && signal.innocent.length > 40,
        `сигнал ${signal.kind} лишився без пояснення, чому він може нічого не означати`,
      );
    }
  });

  it("жоден сигнал не звинувачує", () => {
    const signals = findSignals([
      bidder({ edrpou: "1", phone: "0971112233", contactName: "Іван" }),
      bidder({ edrpou: "2", phone: "0971112233", contactName: "Іван" }),
    ]);

    for (const signal of signals) {
      assert.doesNotMatch(
        `${signal.detail} ${signal.innocent}`,
        /змов|порушен|корупц|незаконн|шахрай/i,
        `сигнал ${signal.kind} перетворився на звинувачення`,
      );
    }
  });
});

describe("конкуренція", () => {
  it("помічає єдиного учасника", () => {
    const result = describeCompetition([bidder({ edrpou: "1" })], 1000, 1000);
    assert.equal(result.singleBidder, true);
    assert.ok(result.notes.some((n) => /один учасник/.test(n)));
  });

  it("рахує, наскільки торги збили ціну", () => {
    const result = describeCompetition(
      [bidder({ edrpou: "1" }), bidder({ edrpou: "2" })],
      1000,
      600,
    );
    assert.equal(result.priceDrop, 0.4);
    assert.equal(result.singleBidder, false);
  });

  it("не рахує учасників зі скасованими пропозиціями", () => {
    const result = describeCompetition(
      [bidder({ edrpou: "1" }), bidder({ edrpou: "2", status: "invalid" })],
      1000,
      1000,
    );
    assert.equal(result.bidders, 1);
  });
});

describe("перевірка тендера", () => {
  const base = {
    id: "a".repeat(32),
    tenderID: "UA-2026-08-01-000001-a",
    title: "Тестова закупівля",
    value: { amount: 1000, currency: "UAH" },
  };

  it("пояснює, що у звіті про договір учасників немає за визначенням", () => {
    const result = checkTender({
      ...base,
      procurementMethodType: "reporting",
      status: "complete",
    });

    assert.equal(result.signals.length, 0);
    assert.ok(
      result.limitations.some((l) => /звіт про укладений договір/.test(l)),
      "не пояснив, чому перевірка не застосовна",
    );
    assert.ok(result.limitations.some((l) => /трьох чвертей/.test(l)));
  });

  it("пояснює, що до кваліфікації учасників не розкрито", () => {
    const result = checkTender({
      ...base,
      procurementMethodType: "aboveThreshold",
      status: "active.tendering",
    });

    assert.ok(
      result.limitations.some((l) => /ще не розкрито/.test(l)),
      "мовчки повернув порожнечу замість пояснення",
    );
    assert.ok(
      result.limitations.some((l) => /ускладнити змову/.test(l)),
      "не пояснив, що приховування учасників це захід проти змови, а не помилка",
    );
  });

  it("шукає збіги, коли учасників розкрито", () => {
    const result = checkTender({
      ...base,
      procurementMethodType: "belowThreshold",
      status: "complete",
      bids: [
        {
          date: "2026-08-01T12:00:00Z",
          value: { amount: 900 },
          tenderers: [
            {
              name: "ТОВ Перший",
              identifier: { id: "11111111" },
              contactPoint: { telephone: "0971112233", email: "a@firma.com.ua" },
              address: { locality: "Київ", streetAddress: "вул. Хрещатик 22" },
            },
          ],
        },
        {
          date: "2026-08-01T12:04:00Z",
          value: { amount: 950 },
          tenderers: [
            {
              name: "ТОВ Другий",
              identifier: { id: "22222222" },
              contactPoint: { telephone: "+380971112233", email: "b@firma.com.ua" },
              address: { locality: "Київ", streetAddress: "вул. Хрещатик 22" },
            },
          ],
        },
      ],
      awards: [
        {
          status: "active",
          value: { amount: 900, currency: "UAH" },
          suppliers: [{ name: "ТОВ Перший", identifier: { id: "11111111" } }],
        },
      ],
    });

    assert.equal(result.limitations.length, 0, "перевірка була можлива, але щось відмовило");
    assert.equal(result.participants.length, 2);
    assert.equal(result.winner?.edrpou, "11111111");
    assert.equal(result.competition?.priceDrop, 0.1);

    const kinds = result.signals.map((s) => s.kind);
    assert.ok(kinds.includes("shared_phone"));
    assert.ok(kinds.includes("shared_address"));
  });

  it("завжди каже, чим ця перевірка не є", () => {
    const result = checkTender({ ...base, status: "complete" });
    assert.match(result.whatThisIsNot, /не висновок про порушення/);
  });
});
