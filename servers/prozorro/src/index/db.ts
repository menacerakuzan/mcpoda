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

const SCHEMA = `
create table if not exists tenders (
  id              text primary key,
  tender_id       text,
  date_modified   text not null,
  status          text,
  method          text,
  buyer_edrpou    text,
  buyer_name      text,
  region          text,

  -- filled by the enrichment pass: the feed never carries these
  title           text,
  norm            text,
  value_amount    real,
  value_currency  text,
  cpv             text,
  enriched_at     text
);

create unique index if not exists tenders_tender_id on tenders(tender_id);
create index if not exists tenders_modified on tenders(date_modified);
create index if not exists tenders_buyer on tenders(buyer_edrpou);
create index if not exists tenders_cpv on tenders(cpv);
create index if not exists tenders_pending on tenders(enriched_at) where enriched_at is null;

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
  db.exec(SCHEMA);
  return db;
}

export function readState(db: DatabaseSync, key: string): string | null {
  const row = db.prepare("select value from state where key = ?").get(key) as
    { value: string } | undefined;
  return row?.value ?? null;
}

export function writeState(db: DatabaseSync, key: string, value: string) {
  db.prepare(
    "insert into state(key, value) values (?, ?) on conflict(key) do update set value = excluded.value",
  ).run(key, value);
}

export type IndexStats = {
  tenders: number;
  enriched: number;
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
              min(date_modified) as oldest,
              max(date_modified) as newest
       from tenders`,
    )
    .get() as {
    tenders: number;
    enriched: number | null;
    oldest: string | null;
    newest: string | null;
  };

  return {
    tenders: counts.tenders,
    enriched: counts.enriched ?? 0,
    oldest: counts.oldest,
    newest: counts.newest,
    historyCursorDate: readState(db, "crawl_cursor_date"),
    recentCursorDate: readState(db, "crawl_cursor_recent_date"),
    updatedAt: readState(db, "crawl_updated_at"),
  };
}
