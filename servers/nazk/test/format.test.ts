import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compareDeclarations,
  isRedacted,
  projectDeclaration,
  projectSummary,
} from "../dist/format.js";

/**
 * These declarations describe real people, so the tests care about two things
 * above correctness: that nothing the register kept closed leaks through, and
 * that a comparison can never quietly present edits to one document as a person
 * losing property.
 */

const declaration = (over: Record<string, unknown> = {}) => ({
  id: "doc-1",
  user_declarant_id: 42,
  declaration_year: 2024,
  declaration_type: 1,
  date: "2025-03-19T10:00:00+02:00",
  data: {
    step_1: {
      data: {
        lastname: "ПЕТРЕНКО",
        firstname: "МИКОЛА",
        middlename: "ВАСИЛЬОВИЧ",
        workPost: "депутат сільської ради",
        workPlace: "Сільська рада",
        region: "Дніпропетровська",
        passport: "[Конфіденційна інформація]",
        taxNumber: "[Конфіденційна інформація]",
        houseNum: "[Конфіденційна інформація]",
        streetType: "[Конфіденційна інформація]",
      },
    },
    step_2: {
      data: [
        { subjectRelation: "дружина", birthday: "1980-05-05", citizenship: "1" },
        { subjectRelation: "син", birthday: "2015-09-01", citizenship: "1" },
      ],
    },
    step_3: { data: [{ objectType: "Житловий будинок", totalArea: "59,7", region: "Дніпропетровська" }] },
    step_6: { data: [{ objectType: "Автомобіль", brand: "Skoda", model: "Octavia", graduationYear: "2019" }] },
    step_11: { data: [{ objectType: "Заробітна плата", sizeIncome: "120000" }] },
    step_12: { data: [{ sizeAssets: "50000" }] },
    ...over,
  },
});

describe("вимарювання", () => {
  it("розпізнає позначки реєстру", () => {
    assert.equal(isRedacted("[Конфіденційна інформація]"), true);
    assert.equal(isRedacted("[Не застосовується]"), true);
    assert.equal(isRedacted("Дніпропетровська"), false);
  });

  it("не пропускає вимаране у відповідь", () => {
    // The marker has to sit in fields the projection actually reads, otherwise
    // the test passes while the filter is broken. Found exactly that way: the
    // first version put it only in `passport`, which is never projected.
    const closed = declaration();
    const person = (closed.data.step_1 as { data: Record<string, unknown> }).data;
    person.region = "[Конфіденційна інформація]";
    person.workPost = "[Не застосовується]";
    (closed.data.step_3 as { data: Array<Record<string, unknown>> }).data[0]!.region =
      "[Конфіденційна інформація]";

    const card = projectDeclaration(closed);

    assert.doesNotMatch(
      JSON.stringify(card),
      /Конфіденційна інформація|Не застосовується/,
      "позначка реєстру просочилась у відповідь замість того, щоб стати null",
    );
    assert.equal(card.declarant.region, null);
    assert.equal(card.declarant.position, null);
    assert.equal(card.realEstate[0]?.region, null);
  });

  it("не передає адрес і дат народження родичів", () => {
    // Both are published by the register. Relaying a child's date of birth into
    // a chat adds nothing to oversight, so the projection drops it.
    const text = JSON.stringify(projectDeclaration(declaration()));

    assert.doesNotMatch(text, /2015-09-01/, "дата народження дитини потрапила у відповідь");
    assert.doesNotMatch(text, /houseNum|streetType/, "поля адреси потрапили у відповідь");
  });

  it("лишає родинні звʼязки без персональних деталей", () => {
    const card = projectDeclaration(declaration());
    assert.equal(card.family.members, 2);
    assert.deepEqual(card.family.relations, ["дружина", "син"]);
  });
});

describe("проєкція", () => {
  it("збирає ПІБ і посаду", () => {
    const card = projectDeclaration(declaration());
    assert.equal(card.declarant.name, "ПЕТРЕНКО МИКОЛА ВАСИЛЬОВИЧ");
    assert.equal(card.declarant.position, "депутат сільської ради");
  });

  it("сумує доходи і активи", () => {
    const card = projectDeclaration(declaration());
    assert.equal(card.income.total, 120000);
    assert.equal(card.money.total, 50000);
  });

  it("читає числа з комою як десятковим роздільником", () => {
    const card = projectDeclaration(declaration());
    assert.equal(card.realEstate[0]?.area, 59.7);
  });

  it("переживає порожні розділи", () => {
    const card = projectDeclaration({ ...declaration(), data: { step_1: { data: {} } } });
    assert.deepEqual(card.realEstate, []);
    assert.equal(card.income.total, null);
    assert.equal(card.family.members, 0);
  });

  it("завжди несе застереження про межі висновків", () => {
    assert.match(projectDeclaration(declaration()).disclaimer, /питання, а не факт/);
  });

  it("будує коротку картку для пошуку", () => {
    const summary = projectSummary(declaration());
    assert.equal(summary.name, "ПЕТРЕНКО МИКОЛА ВАСИЛЬОВИЧ");
    assert.equal(summary.year, 2024);
    assert.equal(summary.type, "щорічна");
  });
});

describe("порівняння", () => {
  const older = declaration();
  const newer = {
    ...declaration(),
    id: "doc-2",
    declaration_year: 2025,
    date: "2026-03-17T10:00:00+02:00",
    data: {
      ...declaration().data,
      step_3: { data: [] },
      step_11: { data: [{ objectType: "Заробітна плата", sizeIncome: "150000" }] },
    },
  };

  it("рахує зміну доходу", () => {
    const result = compareDeclarations(older, newer);
    assert.ok(!("error" in result));
    if ("error" in result) return;
    assert.deepEqual(result.income, { before: 120000, after: 150000, change: 30000 });
  });

  it("показує, що зникло, і не називає це приховуванням", () => {
    const result = compareDeclarations(older, newer);
    assert.ok(!("error" in result));
    if ("error" in result) return;

    assert.equal(result.realEstate.disappeared.length, 1);
    assert.ok(result.caveats.some((c) => /не означає його приховування/.test(c)));
    assert.doesNotMatch(
      JSON.stringify(result.caveats),
      /приховав|незадеклар|необґрунтован/i,
      "застереження перетворилось на звинувачення",
    );
  });

  it("відмовляється порівнювати різних людей", () => {
    const stranger = { ...newer, user_declarant_id: 999 };
    const result = compareDeclarations(older, stranger);
    assert.ok("error" in result);
    if (!("error" in result)) return;
    assert.equal(result.error, "different_people");
  });

  it("попереджає, коли взято замінену декларацію", () => {
    // The real case this guards: one declarant filed 2024 twice, and the two
    // filings differ by 150 property objects. Comparing the superseded one
    // produces a sentence about a person losing property that never happened.
    const siblings = [
      { id: "doc-1", year: 2024, submitted: "2025-03-19T10:00:00+02:00" },
      { id: "doc-3", year: 2024, submitted: "2026-07-18T10:00:00+03:00" },
      { id: "doc-2", year: 2025, submitted: "2026-03-17T10:00:00+02:00" },
    ];

    const result = compareDeclarations(older, newer, siblings);
    assert.ok(!("error" in result));
    if ("error" in result) return;

    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0]!, /не є останньою/);
    assert.match(result.warnings[0]!, /2026-07-18/);
  });

  it("попереджає, коли обидві декларації за один рік", () => {
    const twin = { ...newer, declaration_year: 2024 };
    const result = compareDeclarations(older, twin);
    assert.ok(!("error" in result));
    if ("error" in result) return;

    assert.ok(
      result.warnings.some((w) => /Обидві декларації за 2024 рік/.test(w)),
      "різницю між правками одного документа видано за зміну за період",
    );
  });

  it("мовчить, коли обрано чинні декларації різних років", () => {
    const siblings = [
      { id: "doc-1", year: 2024, submitted: "2025-03-19T10:00:00+02:00" },
      { id: "doc-2", year: 2025, submitted: "2026-03-17T10:00:00+02:00" },
    ];
    const result = compareDeclarations(older, newer, siblings);
    assert.ok(!("error" in result));
    if ("error" in result) return;
    assert.deepEqual(result.warnings, []);
  });
});
