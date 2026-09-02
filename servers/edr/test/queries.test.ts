import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { openDatabase, upsertCompany } from "../dist/db.js";
import { getCompany, searchCompanies, sharedPeople } from "../dist/queries.js";
import { parsePersonField } from "../dist/parse.js";

let db: ReturnType<typeof openDatabase>;

beforeEach(() => {
  db = openDatabase(":memory:");
});

const company = (edrpou: string, name: string, peopleRaw: Array<[string, "founder" | "signer"]>) => ({
  edrpou,
  name,
  shortName: null,
  stan: "зареєстровано",
  people: peopleRaw.map(([raw, role]) => parsePersonField(raw, role)),
});

describe("sharedPeople", () => {
  it("знаходить спільного засновника між двома компаніями", () => {
    upsertCompany(
      db,
      company("11111111", "ТОВ АЛЬФА", [["ІВАНЕНКО ІВАН ІВАНОВИЧ - директор", "signer"]]),
    );
    upsertCompany(
      db,
      company("22222222", "ТОВ БЕТА", [["ІВАНЕНКО ІВАН ІВАНОВИЧ; частка - 500 грн.", "founder"]]),
    );

    const matches = sharedPeople(db, "11111111", "22222222");
    assert.equal(matches.length, 1);
    assert.equal(matches[0].name, "ІВАНЕНКО ІВАН ІВАНОВИЧ");
    assert.equal(matches[0].roleA, "підписант/керівник");
    assert.equal(matches[0].roleB, "засновник");
  });

  it("не показує збігів, коли людей нема спільних", () => {
    upsertCompany(db, company("11111111", "ТОВ АЛЬФА", [["ПЕТРЕНКО ПЕТРО - директор", "signer"]]));
    upsertCompany(db, company("22222222", "ТОВ БЕТА", [["СИДОРЕНКО СИДІР - директор", "signer"]]));
    assert.deepEqual(sharedPeople(db, "11111111", "22222222"), []);
  });

  it("порівняння компанії із самою собою не повертає збігів", () => {
    upsertCompany(db, company("11111111", "ТОВ АЛЬФА", [["ПЕТРЕНКО ПЕТРО - директор", "signer"]]));
    assert.deepEqual(sharedPeople(db, "11111111", "11111111"), []);
  });

  it("повторний імпорт тієї самої компанії замінює її людей, а не додає до них", () => {
    upsertCompany(db, company("11111111", "ТОВ АЛЬФА", [["ПЕТРЕНКО ПЕТРО - директор", "signer"]]));
    upsertCompany(db, company("11111111", "ТОВ АЛЬФА", [["СИДОРЕНКО СИДІР - директор", "signer"]]));
    const card = getCompany(db, "11111111");
    assert.equal(card!.people.length, 1);
    assert.equal(card!.people[0].name, "СИДОРЕНКО СИДІР");
  });
});

describe("getCompany", () => {
  it("повертає null для відсутнього ЄДРПОУ", () => {
    assert.equal(getCompany(db, "99999999"), null);
  });
});

describe("searchCompanies", () => {
  const named = (edrpou: string, name: string, shortName: string | null = null) => ({
    edrpou,
    name,
    shortName,
    stan: "зареєстровано",
    people: [],
  });

  it("знаходить компанію за назвою, коли коду ЄДРПОУ немає", () => {
    upsertCompany(db, named("11111111", 'ТОВАРИСТВО "РОМАШКА"'));
    upsertCompany(db, named("22222222", 'ТОВАРИСТВО "СОНЯШНИК"'));

    const found = searchCompanies(db, "ромашка");
    assert.equal(found.length, 1);
    assert.equal(found[0].edrpou, "11111111");
  });

  it("знаходить попри іншу граматичну форму", () => {
    // This is the whole reason the stemmer is here: a person types the word as
    // they say it, the register stores it as it was registered.
    upsertCompany(db, named("11111111", 'ПП "РОМАШКИ"'));

    assert.equal(searchCompanies(db, "ромашка").length, 1, "морфологію не враховано");
  });

  it("шукає і за скороченою назвою", () => {
    upsertCompany(db, named("11111111", "ПРИВАТНЕ ПІДПРИЄМСТВО ДІСК-ПІВДЕНЬ", 'ПП "ДІСК-ПІВДЕНЬ"'));

    assert.equal(searchCompanies(db, "діск-південь").length, 1);
  });

  it("не падає на лапках у запиті, які для FTS є синтаксисом", () => {
    upsertCompany(db, named("11111111", 'ТОВ "РОМАШКА"'));

    // A bare double quote inside a MATCH expression is a syntax error unless
    // escaped — a person pasting a name with quotes must not get a crash.
    assert.doesNotThrow(() => searchCompanies(db, 'ТОВ "РОМАШКА"'));
  });

  it("повертає порожньо на порожній запит, а не все підряд", () => {
    upsertCompany(db, named("11111111", 'ТОВ "РОМАШКА"'));
    assert.deepEqual(searchCompanies(db, "   "), []);
  });

  it("тримається межі limit", () => {
    for (let i = 1; i <= 5; i++) {
      upsertCompany(db, named(`1111111${i}`, `ТОВ "РОМАШКА ${i}"`));
    }
    assert.equal(searchCompanies(db, "ромашка", 2).length, 2);
  });
});
