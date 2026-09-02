import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Company } from "./parse.js";
import { normalizeText } from "./normalize.js";

/** The index lives on the person's own machine, same as the Prozorro one. */
export function databasePath() {
  return process.env.PROYAV_EDR_DB ?? join(homedir(), ".proyav", "edr.sqlite");
}

export const SCHEMA_VERSION = 2;

const SCHEMA = `
create table if not exists companies (
  edrpou      text primary key,
  name        text not null,
  short_name  text,
  stan        text,
  -- Stemmed name, so a search for «ромашка» also finds «РОМАШКИ» and «РОМАШЦІ».
  norm        text
);

-- Until this existed a company could only be found by its EDRPOU code, which
-- is the one thing a person asking the question never has: they know the name.
create virtual table if not exists companies_fts using fts5(
  name,
  norm,
  content='companies',
  content_rowid='rowid'
);

create trigger if not exists companies_fts_insert after insert on companies begin
  insert into companies_fts(rowid, name, norm) values (new.rowid, new.name, new.norm);
end;

create trigger if not exists companies_fts_delete after delete on companies begin
  insert into companies_fts(companies_fts, rowid, name, norm)
    values ('delete', old.rowid, old.name, old.norm);
end;

create trigger if not exists companies_fts_update after update on companies begin
  insert into companies_fts(companies_fts, rowid, name, norm)
    values ('delete', old.rowid, old.name, old.norm);
  insert into companies_fts(rowid, name, norm) values (new.rowid, new.name, new.norm);
end;

create table if not exists people (
  edrpou          text not null,
  role            text not null,
  name            text not null,
  name_norm       text not null,
  related_edrpou  text,
  raw             text not null
);

create index if not exists people_name_norm on people(name_norm);
create index if not exists people_edrpou on people(edrpou);

create table if not exists state (
  key    text primary key,
  value  text
);
`;

export class SchemaMismatch extends Error {
  constructor(readonly found: number) {
    super(
      `Індекс має схему версії ${found}, а потрібна ${SCHEMA_VERSION}. Це кеш, який відновлюється: видаліть файл індексу і зберіть заново.`,
    );
    this.name = "SchemaMismatch";
  }
}

export function openDatabase(path = databasePath()) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });

  const db = new DatabaseSync(path);
  // Order matters: switching journal mode takes an exclusive lock, so the
  // timeout has to already be set — the same bug bit the Prozorro indexer.
  db.exec("pragma busy_timeout = 15000");
  db.exec("pragma journal_mode = wal");
  db.exec("pragma synchronous = normal");

  if (tableExists(db, "companies")) {
    const version = Number(readState(db, "schema_version") ?? 1);
    if (version !== SCHEMA_VERSION) {
      db.close();
      throw new SchemaMismatch(version);
    }
  }

  db.exec(SCHEMA);
  writeState(db, "schema_version", String(SCHEMA_VERSION));
  return db;
}

function tableExists(db: DatabaseSync, name: string) {
  return Boolean(
    db
      .prepare("select 1 as found from sqlite_master where type='table' and name=?")
      .get(name),
  );
}

export function readState(db: DatabaseSync, key: string): string | null {
  if (!tableExists(db, "state")) return null;
  const row = db.prepare("select value from state where key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function writeState(db: DatabaseSync, key: string, value: string) {
  db.prepare(
    "insert into state(key, value) values (?, ?) on conflict(key) do update set value = excluded.value",
  ).run(key, value);
}

/**
 * The export is a weekly full snapshot, not a diff feed (verified against
 * data.gov.ua 26.08.2026), so importing replaces a company's rows outright
 * rather than trying to merge — there is no cursor to resume from, only a
 * "did we already run this pass" state.
 */
/**
 * The three statements an import needs, prepared once.
 *
 * They used to be prepared inside upsertCompany, which meant three fresh
 * statements per company — six million of them across a full import. That is
 * what killed a rebuild at the million mark on 27.08.2026: the process grew
 * until the OS took it, with no error in the log, just a run that stopped.
 * Preparing once and reusing is also markedly faster, since SQLite stops
 * recompiling the same SQL two million times.
 */
function statementsFor(db: DatabaseSync) {
  let cached = prepared.get(db);
  if (!cached) {
    cached = {
      company: db.prepare(
        "insert into companies(edrpou, name, short_name, stan, norm) values (?, ?, ?, ?, ?) on conflict(edrpou) do update set name = excluded.name, short_name = excluded.short_name, stan = excluded.stan, norm = excluded.norm",
      ),
      clearPeople: db.prepare("delete from people where edrpou = ?"),
      person: db.prepare(
        "insert into people(edrpou, role, name, name_norm, related_edrpou, raw) values (?, ?, ?, ?, ?, ?)",
      ),
    };
    prepared.set(db, cached);
  }
  return cached;
}

/** Keyed by connection, so a test opening its own database gets its own set. */
const prepared = new WeakMap<
  DatabaseSync,
  {
    company: ReturnType<DatabaseSync["prepare"]>;
    clearPeople: ReturnType<DatabaseSync["prepare"]>;
    person: ReturnType<DatabaseSync["prepare"]>;
  }
>();

export function upsertCompany(db: DatabaseSync, company: Company) {
  const sql = statementsFor(db);

  // Both names go into the stemmed column: people search for the short form
  // («ПП Ромашка») at least as often as the full one.
  const norm = normalizeText([company.name, company.shortName].filter(Boolean).join(" "));

  sql.company.run(company.edrpou, company.name, company.shortName, company.stan, norm);
  sql.clearPeople.run(company.edrpou);

  for (const person of company.people) {
    sql.person.run(
      company.edrpou,
      person.role,
      person.name,
      person.nameNorm,
      person.relatedEdrpou,
      person.raw,
    );
  }
}

export type IndexStats = {
  companies: number;
  people: number;
  importedAt: string | null;
};

export function indexStats(db: DatabaseSync): IndexStats {
  const { companies } = db.prepare("select count(*) as companies from companies").get() as {
    companies: number;
  };
  const { people } = db.prepare("select count(*) as people from people").get() as {
    people: number;
  };
  return { companies, people, importedAt: readState(db, "imported_at") };
}
