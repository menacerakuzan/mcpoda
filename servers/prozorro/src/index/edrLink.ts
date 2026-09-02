import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Reads the ЄДР index, when there is one, to answer a single question:
 * do two bidders in the same tender share a founder, director or beneficiary?
 *
 * Until now that check existed but had to be driven by hand — the person had to
 * notice two EDRPOU codes, call the ЄДР server twice, and compare. The signal
 * that made the whole tender check worth building was the one nobody ran.
 *
 * The coupling is deliberately one-way and narrow: this opens the other
 * server's index read-only, asks for names by EDRPOU, and knows nothing else
 * about its schema. Both indexes are local files on the same machine by design,
 * so there is no network here and nothing to configure. If the ЄДР index is
 * absent — a Prozorro-only install, which is a normal way to run this — every
 * function degrades to "no data" and the tender check behaves exactly as it did
 * before.
 */

export function edrDatabasePath() {
  return process.env.PROYAV_EDR_DB ?? join(homedir(), ".proyav", "edr.sqlite");
}

let cached: DatabaseSync | null | undefined;

function open(): DatabaseSync | null {
  if (cached !== undefined) return cached;

  const path = edrDatabasePath();
  if (!existsSync(path)) {
    cached = null;
    return cached;
  }

  try {
    // Read-only: this process must never be the one that writes to another
    // server's index, and opening read-write would also try to set pragmas.
    cached = new DatabaseSync(path, { readOnly: true });
  } catch {
    // A missing, locked or half-imported index is not a reason to fail a
    // tender check that works fine without it.
    cached = null;
  }
  return cached;
}

export type EdrPerson = { name: string; nameNorm: string; role: string };

const ROLE_LABEL: Record<string, string> = {
  founder: "засновник",
  signer: "керівник",
  beneficiary: "бенефіціар",
  member: "член керівного органу",
};

export function edrAvailable(): boolean {
  return open() !== null;
}

/** Cached per process: the same liquidator turns up across many checks. */
const spreadCache = new Map<string, number>();

function appearsInTooMany(db: DatabaseSync, nameNorm: string): boolean {
  let spread = spreadCache.get(nameNorm);
  if (spread === undefined) {
    try {
      const row = db
        .prepare("select count(distinct edrpou) as n from people where name_norm = ?")
        .get(nameNorm) as { n: number } | undefined;
      spread = row?.n ?? 0;
    } catch {
      spread = 0;
    }
    spreadCache.set(nameNorm, spread);
  }
  return spread > MASS_PERSON_THRESHOLD;
}

function peopleOf(db: DatabaseSync, edrpou: string): EdrPerson[] {
  return (
    db
      .prepare("select name, name_norm, role from people where edrpou = ?")
      .all(edrpou) as Array<{ name: string; name_norm: string; role: string }>
  ).map((row) => ({
    name: row.name,
    nameNorm: row.name_norm,
    role: ROLE_LABEL[row.role] ?? row.role,
  }));
}

export type EdrOverlap = {
  a: string;
  b: string;
  name: string;
  roleA: string;
  roleB: string;
};

/**
 * Above this many companies, a shared name stops meaning anything.
 *
 * Measured on the finished index (27.08.2026): of 2 101 544 distinct names,
 * 72% appear in one company and 25% in two to five — an ordinary owner of a
 * few firms. Only 1 467 names, 0.07%, appear in more than fifty, and those are
 * not owners at all: the top one sits in 5 937 companies and is a
 * state-appointed liquidator, the next are notaries and mass administrators.
 * Two bidders sharing such a name have nothing in common, so reporting it as a
 * connection would be a false signal about named companies — the exact harm
 * this whole check is written to avoid.
 */
const MASS_PERSON_THRESHOLD = 50;

/**
 * Placeholders the register uses instead of a person, checked here as well as
 * during import so an index built before the parser learned them stays safe.
 */
function isPlaceholder(nameNorm: string): boolean {
  if (/^\d+\s+(ФІЗИЧНИХ|ЮРИДИЧНИХ)\s+ОС(І|О)Б/.test(nameNorm)) return true;
  if (nameNorm.includes("ЗГІДНО СПИСКУ") || nameNorm.includes("ЗГІДНО ПЕРЕЛІКУ")) return true;
  if (nameNorm.startsWith("ЧЛЕНИ ")) return true;
  return [
    "ФІЗИЧНІ ОСОБИ",
    "НЕВИЗНАЧЕНА ФІЗИЧНА ОСОБА",
    "НЕВИЗНАЧЕНА ОСОБА",
    "КЕРІВНИК ПІДПРИЄМСТВА",
    "АКЦІОНЕРИ",
    "ТРУДОВИЙ КОЛЕКТИВ",
    "ВІДОМОСТІ ВІДСУТНІ",
  ].includes(nameNorm);
}

/**
 * Every pair among the given codes that shares a person by name.
 *
 * Name, not identity: the bulk export carries no stable personal id, so two
 * unrelated namesakes match here exactly as a real shared owner would. Callers
 * must carry that caveat into whatever they show a person.
 */
export function sharedPeopleAmong(edrpouList: string[]): EdrOverlap[] {
  const db = open();
  if (!db) return [];

  const codes = [...new Set(edrpouList.filter(Boolean))];
  if (codes.length < 2) return [];

  const byCode = new Map<string, EdrPerson[]>();
  for (const code of codes) {
    try {
      byCode.set(code, peopleOf(db, code));
    } catch {
      byCode.set(code, []);
    }
  }

  const overlaps: EdrOverlap[] = [];
  for (let i = 0; i < codes.length; i++) {
    for (let j = i + 1; j < codes.length; j++) {
      const a = codes[i];
      const b = codes[j];
      const left = byCode.get(a) ?? [];
      const right = byCode.get(b) ?? [];
      if (!left.length || !right.length) continue;

      const rightByNorm = new Map(right.map((p) => [p.nameNorm, p]));
      const seen = new Set<string>();

      for (const person of left) {
        const match = rightByNorm.get(person.nameNorm);
        if (!match || seen.has(person.nameNorm)) continue;
        seen.add(person.nameNorm);

        if (isPlaceholder(person.nameNorm)) continue;
        if (appearsInTooMany(db, person.nameNorm)) continue;

        overlaps.push({
          a,
          b,
          name: person.name,
          roleA: person.role,
          roleB: match.role,
        });
      }
    }
  }

  return overlaps;
}

/** Tests need a clean slate between cases. */
export function resetEdrCache() {
  spreadCache.clear();
  cached?.close();
  cached = undefined;
}
