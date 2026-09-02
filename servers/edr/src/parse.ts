/**
 * The EDR bulk export (UO.xml, ~3.2 GB) is windows-1251, one <SUBJECT> record
 * per legal entity, and — verified 26.08.2026 by reading the raw file — some
 * SIGNER fields carry the full text of a power-of-attorney with literal line
 * breaks embedded in them. A line-based reader silently truncates those
 * records, so records are found by scanning for <SUBJECT>...</SUBJECT>
 * boundaries in the decoded text, not by splitting on newlines.
 */

export type PersonRef = {
  role: "founder" | "signer" | "beneficiary" | "member";
  name: string;
  nameNorm: string;
  relatedEdrpou: string | null;
  raw: string;
};

export type Company = {
  edrpou: string;
  name: string;
  shortName: string | null;
  stan: string | null;
  people: PersonRef[];
};

function decodeEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function field(block: string, tag: string): string | null {
  const match = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return match ? decodeEntities(match[1]).trim() : null;
}

function fieldList(block: string, container: string, tag: string): string[] {
  const containerMatch = block.match(
    new RegExp(`<${container}>([\\s\\S]*?)</${container}>`),
  );
  if (!containerMatch) return [];
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(containerMatch[1]))) {
    const text = decodeEntities(m[1]).trim();
    if (text) out.push(text);
  }
  return out;
}

/** For matching, not display: case folded, punctuation and doubled spaces gone. */
export function normalizeName(name: string): string {
  return name
    .toUpperCase()
    .replace(/['"«»()]/g, "")
    .replace(/[.,;]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The register stores founders/signers/beneficiaries as free text, not
 * structured fields (confirmed against UO_schema.xsd, 26.08.2026): a name,
 * an optional 8-digit EDRPOU when the founder is itself a legal entity, and
 * a role or share tacked on with " - " or "; ". Some SIGNER entries also
 * embed a full power-of-attorney description in parentheses before the role.
 * This extracts a best-effort name for matching; it is not a full parse of
 * the sentence, and does not need to be — matching only needs the name.
 *
 * When a company has no beneficiary, the register fills BENEFICIARY with an
 * explanation instead of leaving it empty — found the hard way while
 * checking real import output: "причина відсутності: відсутні фізичні
 * особи..." was showing up as a "shared person" across hundreds of unrelated
 * companies, because every one of them recites some variant of the same
 * boilerplate. Confirmed against a real 300 MB slice of UO.xml, 26.08.2026.
 */
const ABSENCE_EXPLANATION = /^причина відсутності/i;

/**
 * The register also uses stand-ins for "we don't have an itemised list of
 * individuals here" — a co-op founded by its members, a company whose
 * founder history predates digitisation, a joint-stock company's shareholders
 * as a class rather than a roster. Found by surveying the most-repeated
 * names in a real 300 MB import: these recur across hundreds of unrelated
 * companies and would otherwise flood proyav_edr_shared_people with false
 * "shared person" hits between entities with nothing in common. Real
 * organisations (ministries, city councils) are not filtered — those are
 * genuine shared founders, e.g. state-owned enterprises, and that overlap
 * is itself a real (if unsurprising) signal.
 */
const GENERIC_PLACEHOLDER_NAMES = new Set([
  "ФІЗИЧНІ ОСОБИ",
  "НЕВИЗНАЧЕНА ФІЗИЧНА ОСОБА",
  "НЕВИЗНАЧЕНА ОСОБА",
  "КЕРІВНИК ПІДПРИЄМСТВА",
  "АКЦІОНЕРИ",
  "ТРУДОВИЙ КОЛЕКТИВ",
  "ВІДОМОСТІ ВІДСУТНІ",
]);

function isGenericPlaceholder(name: string): boolean {
  const norm = normalizeName(name);
  if (GENERIC_PLACEHOLDER_NAMES.has(norm)) return true;
  // "ЧЛЕНИ X" — "members of X" (a union, a party, a co-op) names a class of
  // people, not one of them.
  if (norm.startsWith("ЧЛЕНИ ")) return true;
  // "17 ФІЗИЧНИХ ОСІБ ЗГІДНО СПИСКУ" — a count and a reference to a list that
  // is not in the export. Found while probing the finished index: two unrelated
  // companies both said this, and it read as a shared person.
  if (/^\d+\s+(ФІЗИЧНИХ|ЮРИДИЧНИХ)\s+ОС(І|О)Б/.test(norm)) return true;
  if (norm.includes("ЗГІДНО СПИСКУ") || norm.includes("ЗГІДНО ПЕРЕЛІКУ")) return true;
  // A bare bracketed tag, like the redaction markers NAZK's own register
  // uses, e.g. "[ЗАСНОВНИК]" standing in for a founder never itemised.
  if (/^\[.*\]$/.test(name.trim())) return true;
  // No letters at all — "0 0" and similar filler with nothing to match on.
  if (!/[a-zA-Zа-яА-ЯіІїЇєЄґҐ]/.test(name)) return true;
  return false;
}

export function parsePersonField(
  raw: string,
  role: PersonRef["role"],
): PersonRef | null {
  if (ABSENCE_EXPLANATION.test(raw.trim())) return null;

  const withoutParens = raw.replace(/\([\s\S]*?\)+/g, " ");
  const nameSegment = withoutParens.split(/[;]/)[0]?.trim() ?? withoutParens;
  const name = nameSegment.split(/\s+-\s+/)[0]?.trim() || raw.trim();
  if (isGenericPlaceholder(name)) return null;

  const edrpouMatch = raw.match(/\b\d{8}\b/);

  return {
    role,
    name,
    nameNorm: normalizeName(name),
    relatedEdrpou: edrpouMatch ? edrpouMatch[0] : null,
    raw: raw.trim(),
  };
}

export function parseSubjectBlock(block: string): Company | null {
  const edrpou = field(block, "EDRPOU");
  const name = field(block, "NAME");
  if (!edrpou || !name) return null;

  const people: PersonRef[] = [
    ...fieldList(block, "FOUNDERS", "FOUNDER").map((r) => parsePersonField(r, "founder")),
    ...fieldList(block, "SIGNERS", "SIGNER").map((r) => parsePersonField(r, "signer")),
    ...fieldList(block, "BENEFICIARIES", "BENEFICIARY").map((r) =>
      parsePersonField(r, "beneficiary"),
    ),
    ...fieldList(block, "MEMBERS", "MEMBER").map((r) => parsePersonField(r, "member")),
  ].filter((p): p is PersonRef => p !== null && p.name.length > 1);

  return {
    edrpou,
    name,
    shortName: field(block, "SHORT_NAME"),
    stan: field(block, "STAN"),
    people,
  };
}

/**
 * Streams decoded windows-1251 text chunks in, yields one Company per
 * completed <SUBJECT>...</SUBJECT> block found in the running buffer. The
 * buffer only ever holds the unprocessed tail, so memory stays flat over a
 * multi-gigabyte file regardless of how long any single record runs.
 */
export class SubjectStream {
  #buffer = "";

  push(chunk: string): Company[] {
    this.#buffer += chunk;
    const out: Company[] = [];

    for (;;) {
      const start = this.#buffer.indexOf("<SUBJECT>");
      if (start === -1) {
        // No open tag pending: keep only a short tail in case one is split
        // across the chunk boundary.
        if (this.#buffer.length > 32) {
          this.#buffer = this.#buffer.slice(-32);
        }
        break;
      }
      const end = this.#buffer.indexOf("</SUBJECT>", start);
      if (end === -1) {
        this.#buffer = this.#buffer.slice(start);
        break;
      }
      const block = this.#buffer.slice(start, end + "</SUBJECT>".length);
      this.#buffer = this.#buffer.slice(end + "</SUBJECT>".length);
      const company = parseSubjectBlock(block);
      if (company) out.push(company);
    }

    return out;
  }
}
