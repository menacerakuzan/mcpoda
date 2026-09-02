import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  REQUIRED_SCHEMA_FIELDS,
  UO_DUMP_URL,
  UO_SCHEMA_URL,
  DATASET_PAGE,
} from "../../dist/source.js";

/**
 * Live checks against the Ministry's open-data dump. Kept apart from the unit
 * tests so `npm test` stays green when the source is down.
 *
 * The point is the failure this server is otherwise blind to: the parser reads
 * a free-text XML format by heuristic, and if a field is renamed or the file
 * moves, nothing throws — the import just produces fewer companies, or none,
 * and the tools answer "not found" forever. So the schema, not the data, is
 * what gets checked: it is three kilobytes, and it is where a breaking change
 * shows up first.
 */

const TIMEOUT = 60_000;

const reachable = await (async () => {
  try {
    const res = await fetch(UO_SCHEMA_URL, {
      method: "HEAD",
      signal: AbortSignal.timeout(20_000),
    });
    return res.ok
      ? { ok: true as const }
      : { ok: false as const, message: `HTTP ${res.status}` };
  } catch (error) {
    return {
      ok: false as const,
      message: error instanceof Error ? error.message : String(error),
    };
  }
})();

const skip = reachable.ok
  ? false
  : `Дамп ЄДР недоступний із цієї машини: ${reachable.message.slice(0, 120)}. Перевірте ${DATASET_PAGE}.`;

/**
 * The schema archive holds one deflated file, and no dependency is needed to
 * read it — but the sizes must come from the central directory, not the local
 * header. This archive sets general-purpose flag bit 3, which means the local
 * header carries zeroes and the real sizes sit in a data descriptor after the
 * data. Inflating "everything after the header" then fails on the trailing
 * descriptor and directory as junk.
 */
async function readSingleFileZip(url: string): Promise<string> {
  const buffer = new Uint8Array(await (await fetch(url)).arrayBuffer());
  const view = new DataView(buffer.buffer);

  // End of central directory: fixed 22-byte record at the tail when, as here,
  // there is no zip comment.
  let eocd = buffer.length - 22;
  while (eocd >= 0 && view.getUint32(eocd, true) !== 0x06054b50) eocd--;
  assert.ok(eocd >= 0, "це не zip-архів: не знайдено кінець центрального каталогу");

  const directory = view.getUint32(eocd + 16, true);
  assert.equal(
    view.getUint32(directory, true),
    0x02014b50,
    "пошкоджений zip: підпис центрального каталогу не збігся",
  );

  const method = view.getUint16(directory + 10, true);
  const compressedSize = view.getUint32(directory + 20, true);
  const localHeader = view.getUint32(directory + 42, true);

  const nameLength = view.getUint16(localHeader + 26, true);
  const extraLength = view.getUint16(localHeader + 28, true);
  const start = localHeader + 30 + nameLength + extraLength;
  const body = buffer.slice(start, start + compressedSize);

  if (method === 0) return new TextDecoder("utf-8").decode(body);

  assert.equal(method, 8, `несподіваний метод стиснення zip: ${method}`);
  const stream = new Blob([body]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new TextDecoder("utf-8").decode(
    new Uint8Array(await new Response(stream).arrayBuffer()),
  );
}

describe("відкриті дані ЄДР", { timeout: TIMEOUT, skip }, () => {
  it("посилання на повний дамп ще живе і віддає файл потрібного порядку", async () => {
    const res = await fetch(UO_DUMP_URL, {
      method: "HEAD",
      signal: AbortSignal.timeout(20_000),
    });

    assert.ok(res.ok, `дамп недоступний: HTTP ${res.status}. Перевірте ${DATASET_PAGE}`);

    const size = Number(res.headers.get("content-length") ?? 0);
    assert.ok(
      size > 100_000_000,
      `дамп важить ${size} байт замість сотень мегабайт — схоже, за посиланням тепер не той файл`,
    );
  });

  it("схема досі оголошує всі поля, які читає парсер", async () => {
    const xsd = await readSingleFileZip(UO_SCHEMA_URL);

    const missing = REQUIRED_SCHEMA_FIELDS.filter(
      (field) => !xsd.includes(`name="${field}"`),
    );

    assert.deepEqual(
      missing,
      [],
      `реєстр більше не оголошує ці поля: ${missing.join(", ")}. Парсер мовчки поверне менше даних, доки parse.ts не оновлять.`,
    );
  });

  it("засновники й бенефіціари лишаються вільним текстом, а не структурою", async () => {
    // The whole of parsePersonField exists because these are one string per
    // person, not nested elements. If the register ever structures them, the
    // heuristic should be replaced rather than kept — and this is how we find
    // out that it can be.
    const xsd = await readSingleFileZip(UO_SCHEMA_URL);

    assert.match(
      xsd,
      /<xs:element name="FOUNDER" type="xs:string"/,
      "FOUNDER більше не простий рядок: евристику parsePersonField час замінити на нормальний розбір",
    );
    assert.match(
      xsd,
      /<xs:element name="BENEFICIARY" type="xs:string"/,
      "BENEFICIARY більше не простий рядок: те саме стосується розбору бенефіціарів",
    );
  });
});
