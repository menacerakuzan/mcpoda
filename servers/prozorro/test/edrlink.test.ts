import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sharedPeopleAmong, edrAvailable, resetEdrCache } from "../dist/index/edrLink.js";

/**
 * This is the signal most likely to be repeated about a named company, so the
 * two things tested hardest are the ones that stop it being wrong.
 *
 * Both were found by probing the finished 2M-company index, not by imagining
 * failure modes: the register writes placeholders like «17 ФІЗИЧНИХ ОСІБ
 * ЗГІДНО СПИСКУ» where a person should be, and a handful of state-appointed
 * liquidators sit in thousands of companies at once. Either one, reported as a
 * connection between two bidders, is a false claim about real firms.
 */

let scratch: string;
let dbPath: string;

function seed(rows: Array<{ edrpou: string; name: string; role?: string }>) {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    create table if not exists people (
      edrpou text not null,
      role text not null,
      name text not null,
      name_norm text not null,
      related_edrpou text,
      raw text not null
    );
  `);
  const insert = db.prepare(
    "insert into people(edrpou, role, name, name_norm, related_edrpou, raw) values (?, ?, ?, ?, ?, ?)",
  );
  for (const row of rows) {
    insert.run(row.edrpou, row.role ?? "signer", row.name, row.name.toUpperCase(), null, row.name);
  }
  db.close();
}

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "proyav-edrlink-"));
  dbPath = join(scratch, "edr.sqlite");
  process.env.PROYAV_EDR_DB = dbPath;
  resetEdrCache();
});

afterEach(() => {
  resetEdrCache();
  delete process.env.PROYAV_EDR_DB;
  rmSync(scratch, { recursive: true, force: true });
});

describe("міст до індексу ЄДР", () => {
  it("мовчить, коли індексу ЄДР немає взагалі", () => {
    process.env.PROYAV_EDR_DB = join(scratch, "не-існує.sqlite");
    resetEdrCache();

    assert.equal(edrAvailable(), false);
    assert.deepEqual(sharedPeopleAmong(["1", "2"]), [], "без індексу має бути тиша, а не помилка");
  });

  it("знаходить справжню спільну особу між двома компаніями", () => {
    seed([
      { edrpou: "11111111", name: "ІВАНЕНКО ІВАН ІВАНОВИЧ", role: "founder" },
      { edrpou: "22222222", name: "ІВАНЕНКО ІВАН ІВАНОВИЧ", role: "signer" },
    ]);

    const overlaps = sharedPeopleAmong(["11111111", "22222222"]);
    assert.equal(overlaps.length, 1);
    assert.equal(overlaps[0].roleA, "засновник");
    assert.equal(overlaps[0].roleB, "керівник");
  });

  it("не вважає заглушку реєстру спільною особою", () => {
    // Two unrelated companies both carrying this text read as a shared person
    // until the filter existed — found on the real index.
    seed([
      { edrpou: "11111111", name: "17 ФІЗИЧНИХ ОСІБ ЗГІДНО СПИСКУ" },
      { edrpou: "22222222", name: "17 ФІЗИЧНИХ ОСІБ ЗГІДНО СПИСКУ" },
    ]);

    assert.deepEqual(sharedPeopleAmong(["11111111", "22222222"]), []);
  });

  it("не вважає спільною особою того, хто числиться в сотнях компаній", () => {
    // A state-appointed liquidator: present in both bidders and meaning
    // nothing. The real index has one such name in 5 937 companies.
    const rows = [];
    for (let i = 0; i < 60; i++) {
      rows.push({ edrpou: `9${String(i).padStart(7, "0")}`, name: "ЛІКВІДАТОР МАСОВИЙ ПАВЛОВИЧ" });
    }
    rows.push({ edrpou: "11111111", name: "ЛІКВІДАТОР МАСОВИЙ ПАВЛОВИЧ" });
    rows.push({ edrpou: "22222222", name: "ЛІКВІДАТОР МАСОВИЙ ПАВЛОВИЧ" });
    seed(rows);

    assert.deepEqual(
      sharedPeopleAmong(["11111111", "22222222"]),
      [],
      "масову особу видано за зв'язок між учасниками",
    );
  });

  it("людина в кількох компаніях лишається сигналом, бо це звичайний власник", () => {
    // The threshold must not swallow the ordinary case: a quarter of all names
    // in the register appear in two to five companies.
    const rows = [];
    for (let i = 0; i < 4; i++) {
      rows.push({ edrpou: `8${String(i).padStart(7, "0")}`, name: "ВЛАСНИК КІЛЬКОХ ФІРМ" });
    }
    rows.push({ edrpou: "11111111", name: "ВЛАСНИК КІЛЬКОХ ФІРМ" });
    rows.push({ edrpou: "22222222", name: "ВЛАСНИК КІЛЬКОХ ФІРМ" });
    seed(rows);

    assert.equal(sharedPeopleAmong(["11111111", "22222222"]).length, 1);
  });

  it("не порівнює компанію саму з собою", () => {
    seed([{ edrpou: "11111111", name: "ІВАНЕНКО ІВАН" }]);
    assert.deepEqual(sharedPeopleAmong(["11111111", "11111111"]), []);
  });
});
