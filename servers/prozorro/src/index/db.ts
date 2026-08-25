import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * The index lives on the person's own machine. Nothing is uploaded anywhere, and
 * `node:sqlite` ships with Node, so `npx` works without a compiler on the box.
 */
export function databasePath() {
  return process.env.PROYAV_DB ?? join(homedir(), ".proyav", "prozorro.sqlite");
}

/**
 * Bumped whenever the layout changes. The index is a rebuildable cache, so a
 * mismatch is answered by rebuilding rather than by migration code that would
 * have to stay correct forever.
 */
export const SCHEMA_VERSION = 3;

/**
 * Two decisions here were made by measuring 200 000 real rows, because at twenty
 * million rows the difference is gigabytes on someone's laptop:
 *
 * buyers live in their own table — 31 870 distinct buyers were repeating their
 * 65-character names on every procedure they ever ran;
 * dates are unix seconds rather than ISO strings — 32 bytes and a fat index
 * become 8 bytes and a slim one.
 *
 * Together they took the index from 435 to 220 bytes per row. Storing the id as
 * a 16-byte blob would save another 33 and was dropped: hex ids appear in URLs,
 * logs and tool arguments, and converting at every boundary is more bug surface
 * than the saving is worth.
 */
const SCHEMA = `
create table if not exists buyers (
  edrpou  text primary key,
  name    text,
  region  text
);

create table if not exists tenders (
  id              text primary key,
  tender_id       text,
  modified        integer not null,
  status          text,
  method          text,
  buyer_edrpou    text,

  -- filled by the enrichment pass: the feed never carries these
  title           text,
  norm            text,
  value_amount    real,
  value_currency  text,
  cpv             text,
  unit            text,
  quantity        real,
  unit_kind       text,
  enriched_at     integer
);

create unique index if not exists tenders_tender_id on tenders(tender_id);
create index if not exists tenders_modified on tenders(modified);
create index if not exists tenders_buyer on tenders(buyer_edrpou);
create index if not exists tenders_pending on tenders(modified) where enriched_at is null;

-- external content: the virtual table reads from tenders, so titles are stored once
create virtual table if not exists tenders_fts using fts5(
  title,
  norm,
  content='tenders',
  content_rowid='rowid'
);

create trigger if not exists tenders_fts_insert after insert on tenders begin
  insert into tenders_fts(rowid, title, norm) values (new.rowid, new.title, new.norm);
end;

create trigger if not exists tenders_fts_delete after delete on tenders begin
  insert into tenders_fts(tenders_fts, rowid, title, norm)
    values ('delete', old.rowid, old.title, old.norm);
end;

create trigger if not exists tenders_fts_update after update on tenders begin
  insert into tenders_fts(tenders_fts, rowid, title, norm)
    values ('delete', old.rowid, old.title, old.norm);
  insert into tenders_fts(rowid, title, norm) values (new.rowid, new.title, new.norm);
end;

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
  // Order matters: switching the journal mode itself takes an exclusive lock, so
  // the timeout has to be in place before it. With the two swapped, opening the
  // database while a crawl runs fails outright with "database is locked".
  db.exec("pragma busy_timeout = 15000");
  // WAL keeps the server readable while a crawl is writing; the rest are the
  // usual trade of durability for throughput on a rebuildable cache.
  db.exec("pragma journal_mode = wal");
  db.exec("pragma synchronous = normal");

  if (tableExists(db, "tenders")) {
    const version = Number(readState(db, "schema_version") ?? 1);
    if (version !== SCHEMA_VERSION && !upgrade(db, version)) {
      db.close();
      throw new SchemaMismatch(version);
    }
  }

  db.exec(SCHEMA);
  writeState(db, "schema_version", String(SCHEMA_VERSION));
  return db;
}

/**
 * Adding columns is not a reason to make someone re-crawl for hours: the old
 * rows stay valid and the new fields simply fill in on the next enrichment pass.
 * A change that rearranges existing data would still be answered by a rebuild.
 */
function upgrade(db: DatabaseSync, from: number) {
  if (from !== 2 || SCHEMA_VERSION !== 3) return false;

  const columns = new Set(
    (db.prepare("select name from pragma_table_info('tenders')").all() as Array<{
      name: string;
    }>).map((row) => row.name),
  );

  for (const [name, type] of [
    ["unit", "text"],
    ["quantity", "real"],
    ["unit_kind", "text"],
  ] as const) {
    if (!columns.has(name)) db.exec(`alter table tenders add column ${name} ${type}`);
  }

  // The new fields are empty for everything indexed so far, so those procedures
  // go back into the enrichment queue rather than pretending to be complete.
  db.exec("update tenders set enriched_at = null where unit is null and enriched_at is not null");
  writeState(db, "schema_version", String(SCHEMA_VERSION));
  return true;
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

/** Dates travel as ISO strings everywhere outside the index and as seconds inside. */
export const toEpoch = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
export const fromEpoch = (seconds: number) => new Date(seconds * 1000).toISOString();

export type IndexStats = {
  tenders: number;
  enriched: number;
  buyers: number;
  oldest: string | null;
  newest: string | null;
  /** How far the forward pass through history has reached. */
  historyCursorDate: string | null;
  /** How far the backward pass from the head has reached. */
  recentCursorDate: string | null;
  updatedAt: string | null;
};

export function indexStats(db: DatabaseSync): IndexStats {
  const counts = db
    .prepare(
      `select count(*) as tenders,
              sum(case when enriched_at is not null then 1 else 0 end) as enriched,
              min(modified) as oldest,
              max(modified) as newest
       from tenders`,
    )
    .get() as {
    tenders: number;
    enriched: number | null;
    oldest: number | null;
    newest: number | null;
  };

  const { buyers } = db.prepare("select count(*) as buyers from buyers").get() as {
    buyers: number;
  };

  return {
    tenders: counts.tenders,
    enriched: counts.enriched ?? 0,
    buyers,
    oldest: counts.oldest ? fromEpoch(counts.oldest) : null,
    newest: counts.newest ? fromEpoch(counts.newest) : null,
    historyCursorDate: readState(db, "crawl_cursor_date"),
    recentCursorDate: readState(db, "crawl_cursor_recent_date"),
    updatedAt: readState(db, "crawl_updated_at"),
  };
}
