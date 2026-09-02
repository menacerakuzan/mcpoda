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

-- Price comparison looks for procedures with the same CPV inside a date window.
-- Without this it walked the date range and tested the code row by row, which on
-- a 550-day window over thirty million rows is what made proyav_price_benchmark
-- time out in production. Partial on purpose: only enriched rows have a CPV at
-- all, so the index stays a fraction of the table's size.
create index if not exists tenders_cpv on tenders(cpv, modified) where cpv is not null;

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

-- Держаудитслужба monitorings, keyed to the procedure they concern.
--
-- A separate table rather than columns on the tenders table, because one
-- be monitored more than once and because this fills in independently: the
-- audit feed is its own crawl against its own host. Purely additive, so an
-- index built before this existed simply gains an empty table on next open.
create table if not exists monitorings (
  id                 text primary key,
  monitoring_id      text,
  tender_id          text,
  status             text,
  reasons            text,
  violation_occurred integer,
  violation_type     text,
  description        text,
  started_at         integer,
  modified           integer not null
);

create index if not exists monitorings_tender on monitorings(tender_id);
create index if not exists monitorings_modified on monitorings(modified);
create index if not exists monitorings_pending on monitorings(modified) where description is null;
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
  /** When the two counts above were last measured. */
  countsMeasuredAt?: string | null;
};

/**
 * The two counts that cost a full pass, remembered between runs.
 *
 * SQLite keeps no row count, so `count(*)` over thirty million rows is tens of
 * seconds — enough to make proyav_index_status time out in production even
 * after every other query was made cheap. But these numbers only change when a
 * crawl or an enrichment pass runs, and those passes end anyway: so each one
 * records the result, and the tool reads it instantly.
 *
 * The stored value carries the moment it was measured, and callers show that
 * rather than implying the number is live.
 */
export function recordCounts(db: DatabaseSync) {
  const row = db
    .prepare(
      `select count(*) as tenders,
              sum(case when enriched_at is not null then 1 else 0 end) as enriched
       from tenders`,
    )
    .get() as { tenders: number; enriched: number | null };

  writeState(db, "count_tenders", String(row.tenders));
  writeState(db, "count_enriched", String(row.enriched ?? 0));
  writeState(db, "counts_measured_at", new Date().toISOString());
  return row;
}

function storedCounts(db: DatabaseSync) {
  const tenders = readState(db, "count_tenders");
  const enriched = readState(db, "count_enriched");
  const at = readState(db, "counts_measured_at");
  if (tenders === null || enriched === null) return null;
  return { tenders: Number(tenders), enriched: Number(enriched), measuredAt: at };
}

/**
 * @param cached  Serve the counts recorded by the last crawl or enrichment
 *   pass instead of counting again. A fresh count over thirty million rows
 *   costs tens of seconds, which is what made proyav_index_status time out —
 *   but a stored number goes stale the moment anything writes, so this is
 *   opt-in and never the default. Read-only callers that show the measurement
 *   time alongside the number want it; anything that has just changed the
 *   table does not.
 */
export function indexStats(db: DatabaseSync, { cached = false } = {}): IndexStats {
  const stored = cached ? storedCounts(db) : null;
  const counts = stored ?? recordCounts(db);
  const measuredAt = stored?.measuredAt ?? new Date().toISOString();

  // The period, on the other hand, is free — as long as each end is asked for
  // separately. One statement with both min() and max() gives up the index
  // seek and scans instead: 17 593 ms versus 0 ms on the real index.
  const oldest = (
    db.prepare("select min(modified) as v from tenders").get() as { v: number | null }
  ).v;
  const newest = (
    db.prepare("select max(modified) as v from tenders").get() as { v: number | null }
  ).v;

  const { buyers } = db.prepare("select count(*) as buyers from buyers").get() as {
    buyers: number;
  };

  return {
    tenders: counts.tenders,
    enriched: counts.enriched ?? 0,
    buyers,
    oldest: oldest ? fromEpoch(oldest) : null,
    newest: newest ? fromEpoch(newest) : null,
    historyCursorDate: readState(db, "crawl_cursor_date"),
    recentCursorDate: readState(db, "crawl_cursor_recent_date"),
    updatedAt: readState(db, "crawl_updated_at"),
    countsMeasuredAt: measuredAt,
  };
}
