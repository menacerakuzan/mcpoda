import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fetchDocument, searchDocuments } from "../../dist/source.js";

/**
 * Live checks against the register. They live apart from the unit tests so that
 * `npm test` stays green when the source is down.
 *
 * Every fact below was found by probing, not by reading documentation, and the
 * failure messages say what breaks if the source changes.
 */

const TIMEOUT = 40_000;

/**
 * The register answers from Ukraine and returns 403 to GitHub's runners, so CI
 * cannot reach it. Failing there would teach everyone to ignore a red build for
 * a reason that has nothing to do with our code, and passing silently would hide
 * a real outage. So the suite checks first and skips loudly with the reason.
 */
const reachable = await (async () => {
  try {
    await searchDocuments({ query: "Петренко" });
    return { ok: true as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false as const, message };
  }
})();

const skip = reachable.ok
  ? false
  : `Реєстр недоступний з цієї машини: ${reachable.message.slice(0, 120)}. З адрес за межами України він відповідає 403.`;

describe("реєстр декларацій НАЗК", { timeout: TIMEOUT, skip }, () => {
  it("шукає за прізвищем без ключа", async () => {
    const response = await searchDocuments({ query: "Петренко" });

    assert.ok(response.data.length > 0, "пошук за поширеним прізвищем нічого не знайшов");
    const person = (response.data[0]?.data as Record<string, any>)?.step_1?.data;
    assert.match(
      String(person?.lastname ?? ""),
      /Петренко/i,
      "видача більше не відповідає запиту: перевірте параметр query",
    );
  });

  it("тримає стелю видачі на 10 000 документів", async () => {
    const response = await searchDocuments({ year: 2024 });
    assert.ok(
      response.count <= 10_000,
      `стеля змінилася: count = ${response.count}. Це добра новина, оновіть опис інструмента`,
    );
  });

  it("вимарює конфіденційні поля сам", async () => {
    // The whole minimisation design rests on this: if the register stops
    // redacting, the server has to start doing it itself.
    const response = await searchDocuments({ query: "Петренко" });
    const person = (response.data[0]?.data as Record<string, any>)?.step_1?.data ?? {};

    for (const field of ["passport", "taxNumber"]) {
      assert.match(
        String(person[field] ?? "[Конфіденційна інформація]"),
        /^\[/,
        `реєстр почав віддавати ${field} відкрито: сервер має вирізати це сам`,
      );
    }
  });

  it("віддає всі декларації однієї особи за ідентифікатором", async () => {
    const search = await searchDocuments({ query: "Петренко" });
    const declarantId = search.data[0]!.user_declarant_id;

    const history = await searchDocuments({ declarantId });

    assert.ok(history.data.length > 0, "історія декларанта порожня");
    const distinct = new Set(history.data.map((d) => d.user_declarant_id));
    assert.equal(
      distinct.size,
      1,
      "у видачі за user_declarant_id зʼявились чужі декларації: фільтр зламався",
    );
  });

  it("розкриває декларацію за ідентифікатором", async () => {
    const search = await searchDocuments({ query: "Петренко" });
    const doc = await fetchDocument(search.data[0]!.id);

    assert.equal(doc.id, search.data[0]!.id);
    assert.ok(doc.data?.step_1, "у картці зник розділ з даними декларанта");
    assert.equal(typeof doc.declaration_year, "number");
  });
});
