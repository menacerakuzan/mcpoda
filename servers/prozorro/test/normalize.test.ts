import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeQuery,
  normalizeText,
  normalizeWord,
  tokenize,
} from "../dist/index/normalize.js";

/**
 * The stemmer is judged by one question: do the forms a person types and the
 * forms a procurement title uses collapse to the same string? Correct
 * linguistics is not the goal, consistent collapsing is.
 */

const collapses = (...forms: string[]) => {
  const stems = new Set(forms.map(normalizeWord));
  assert.equal(
    stems.size,
    1,
    `форми розійшлися: ${forms.join(", ")} -> ${[...stems].join(" | ")}`,
  );
};

describe("normalizeWord: відмінювання", () => {
  it("зводить відмінки іменників", () => {
    collapses("послуга", "послуги", "послуг", "послугами", "послугах");
    collapses("робота", "роботи", "роботами");
    collapses("паливо", "палива", "паливом");
  });

  it("зводить чергування о та і в закритому складі", () => {
    // дорога → доріг, робота → робіт, місто → міст
    collapses("дорога", "дороги", "доріг");
    collapses("робота", "робіт");
    collapses("місто", "міста", "міст");
  });

  it("зводить чергування приголосних перед і", () => {
    // дорога → дорозі, рука → руці
    collapses("дорога", "дорозі");
    collapses("вулиця", "вулиці", "вулиць");
  });

  it("не залежить від мʼякого знака", () => {
    collapses("автомобіль", "автомобілі", "автомобілів");
  });

  it("не залежить від апострофа і ґ", () => {
    assert.equal(normalizeWord("зʼїзд"), normalizeWord("зїзд"));
    assert.equal(normalizeWord("ґанок"), normalizeWord("ганок"));
  });

  it("зберігає корінь коротких слів", () => {
    // stripping «ремонт» to «рем» would match half the corpus
    assert.ok(normalizeWord("ремонт").length >= 5);
    collapses("ремонт", "ремонту", "ремонтом", "ремонті");
  });
});

describe("normalizeWord: відоме обмеження", () => {
  it("не зводить вставну голосну в родовому множини", () => {
    // лікарня → лікарень: the fleeting «е» appears inside the stem. A rule that
    // removed it would also merge unrelated words (молоко and мілкий land on the
    // same string), so the trade is made the other way: the original title stays
    // indexed alongside the stems, and a literal query still finds it.
    assert.notEqual(normalizeWord("лікарня"), normalizeWord("лікарень"));
  });
});

describe("tokenize", () => {
  it("ріже по розділових знаках і викидає односимвольні токени", () => {
    assert.deepEqual(tokenize("Ремонт дороги по вул. Лаби, 5"), [
      "ремонт",
      "дороги",
      "по",
      "вул",
      "лаби",
    ]);
  });

  it("зберігає числа", () => {
    assert.ok(tokenize("код ДК 021:2015").includes("2015"));
  });
});

describe("normalizeQuery", () => {
  it("однаково обробляє запит і текст", () => {
    const text = normalizeText("Капітальний ремонт доріг");
    const query = normalizeQuery("ремонт дороги");

    for (const token of query.split(" ")) {
      assert.ok(
        text.split(" ").includes(token),
        `токен запиту «${token}» не знайшовся у тексті «${text}»`,
      );
    }
  });

  it("не чіпає коди та номери", () => {
    // stemming «45233142-6» would destroy the only thing that makes it findable
    assert.ok(normalizeQuery("CPV 45233142-6").includes("45233142"));
    assert.ok(
      normalizeQuery("UA-2026-08-25-000001-a").includes("ua"),
      "номер процедури має лишатись шуканим",
    );
  });
});
