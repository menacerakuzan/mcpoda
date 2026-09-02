import type { DatabaseSync } from "node:sqlite";
import { normalizeQuery } from "./normalize.js";

const ROLE_LABEL: Record<string, string> = {
  founder: "засновник",
  signer: "підписант/керівник",
  beneficiary: "кінцевий бенефіціарний власник",
  member: "член керівного органу",
};

export type CompanyCard = {
  edrpou: string;
  name: string;
  shortName: string | null;
  stan: string | null;
  people: Array<{ role: string; name: string; relatedEdrpou: string | null }>;
};

export function getCompany(db: DatabaseSync, edrpou: string): CompanyCard | null {
  const company = db
    .prepare("select edrpou, name, short_name, stan from companies where edrpou = ?")
    .get(edrpou) as
    | { edrpou: string; name: string; short_name: string | null; stan: string | null }
    | undefined;
  if (!company) return null;

  const people = db
    .prepare("select role, name, related_edrpou from people where edrpou = ?")
    .all(edrpou) as Array<{ role: string; name: string; related_edrpou: string | null }>;

  return {
    edrpou: company.edrpou,
    name: company.name,
    shortName: company.short_name,
    stan: company.stan,
    people: people.map((p) => ({
      role: ROLE_LABEL[p.role] ?? p.role,
      name: p.name,
      relatedEdrpou: p.related_edrpou,
    })),
  };
}

export type CompanyHit = {
  edrpou: string;
  name: string;
  shortName: string | null;
  stan: string | null;
};

/**
 * Find companies by name. The index has always held the names; until now the
 * only way in was an EDRPOU code, which is precisely what a person asking the
 * question does not have — they know «Діск-Південь», not 36611683.
 *
 * Matching runs over the stemmed column as well as the literal one, so a
 * query in one grammatical form finds a name written in another.
 */
export function searchCompanies(
  db: DatabaseSync,
  query: string,
  limit = 20,
): CompanyHit[] {
  const normalized = normalizeQuery(query);
  if (!normalized) return [];

  // FTS5 wants double quotes for a phrase; single quotes are SQL string
  // syntax and produce a syntax error inside a MATCH expression.
  const terms = normalized
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => `"${term.replace(/"/g, '""')}"`)
    .join(" ");
  if (!terms) return [];

  return db
    .prepare(
      `select c.edrpou, c.name, c.short_name, c.stan
       from companies_fts f
       join companies c on c.rowid = f.rowid
       where companies_fts match ?
       order by rank
       limit ?`,
    )
    .all(terms, limit)
    .map((row) => {
      const r = row as { edrpou: string; name: string; short_name: string | null; stan: string | null };
      return { edrpou: r.edrpou, name: r.name, shortName: r.short_name, stan: r.stan };
    });
}

export type SharedPerson = {
  name: string;
  roleA: string;
  roleB: string;
};

/**
 * Finds names that appear among founders/signers/beneficiaries/members of
 * both companies. This is a name match, not an identity match: the register
 * does not carry a stable person id in the bulk export, so two namesakes
 * with no relation to each other will match here too. Every caller of this
 * is expected to surface that caveat, the same way check_tender attaches an
 * innocent explanation to every bidder-connection signal.
 */
export function sharedPeople(
  db: DatabaseSync,
  edrpouA: string,
  edrpouB: string,
): SharedPerson[] {
  if (edrpouA === edrpouB) return [];

  const rowsA = db
    .prepare("select role, name, name_norm from people where edrpou = ?")
    .all(edrpouA) as Array<{ role: string; name: string; name_norm: string }>;
  const rowsB = db
    .prepare("select role, name, name_norm from people where edrpou = ?")
    .all(edrpouB) as Array<{ role: string; name: string; name_norm: string }>;

  const byNormB = new Map<string, { role: string; name: string }>();
  for (const row of rowsB) {
    if (!byNormB.has(row.name_norm)) byNormB.set(row.name_norm, row);
  }

  const seen = new Set<string>();
  const out: SharedPerson[] = [];
  for (const row of rowsA) {
    const match = byNormB.get(row.name_norm);
    if (!match || seen.has(row.name_norm)) continue;
    seen.add(row.name_norm);
    out.push({
      name: row.name,
      roleA: ROLE_LABEL[row.role] ?? row.role,
      roleB: ROLE_LABEL[match.role] ?? match.role,
    });
  }
  return out;
}
