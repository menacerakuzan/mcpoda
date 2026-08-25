import type { DatabaseSync } from "node:sqlite";
import {
  fetchFeedPage,
  FEED_INLINE_FIELDS,
  type FeedEntry,
} from "../sources/cdb.js";
import { readState, writeState } from "./db.js";

/**
 * Walks the change feed forward and records what it gives away for free:
 * the internal id, the UA- number, the buyer and the status. That alone closes
 * the gap the sources leave open — no other route maps a number to an id.
 *
 * The cursor lives in the database, so a run that is interrupted after four
 * hours resumes at the same page rather than starting over. Titles and amounts
 * are never in the feed and are filled by the enrichment pass.
 */

export type CrawlProgress = {
  pages: number;
  entries: number;
  inserted: number;
  updated: number;
  cursorDate: string | null;
};

export type CrawlOptions = {
  /** Stop after this many pages. Zero means keep going until the feed ends. */
  maxPages?: number;
  pageSize?: number;
  /**
   * Pause between pages. This is a government service, and a full pass is tens
   * of thousands of requests: politeness is part of the design, not an option.
   */
  delayMs?: number;
  /** Start over from this date instead of the saved cursor. */
  from?: string;
  /**
   * Walk the feed backwards from the head. The full history takes hours, and a
   * person asking about procurement almost always means something recent, so
   * this mode makes the index useful first and complete later.
   */
  descending?: boolean;
  onProgress?: (progress: CrawlProgress) => void;
  fetchPage?: typeof fetchFeedPage;
};

const UPSERT = `
insert into tenders (
  id, tender_id, date_modified, status, method, buyer_edrpou, buyer_name, region
) values (?, ?, ?, ?, ?, ?, ?, ?)
on conflict(id) do update set
  tender_id     = coalesce(excluded.tender_id, tenders.tender_id),
  date_modified = excluded.date_modified,
  status        = coalesce(excluded.status, tenders.status),
  method        = coalesce(excluded.method, tenders.method),
  buyer_edrpou  = coalesce(excluded.buyer_edrpou, tenders.buyer_edrpou),
  buyer_name    = coalesce(excluded.buyer_name, tenders.buyer_name),
  region        = coalesce(excluded.region, tenders.region)
`;

export async function crawl(
  db: DatabaseSync,
  options: CrawlOptions = {},
): Promise<CrawlProgress> {
  const {
    maxPages = 0,
    pageSize = 1000,
    delayMs = 150,
    from,
    descending = false,
    onProgress,
    fetchPage = fetchFeedPage,
  } = options;

  const upsert = db.prepare(UPSERT);
  const countRow = () =>
    (db.prepare("select count(*) as n from tenders").get() as { n: number }).n;

  // The two directions keep separate cursors: mixing them would make each one
  // skip whatever the other had already passed.
  const cursorKey = descending ? "crawl_cursor_recent" : "crawl_cursor";
  let cursor = from ?? readState(db, cursorKey) ?? undefined;
  const progress: CrawlProgress = {
    pages: 0,
    entries: 0,
    inserted: 0,
    updated: 0,
    cursorDate: null,
  };

  for (let page = 0; maxPages === 0 || page < maxPages; page++) {
    const feed = await fetchPage({
      limit: pageSize,
      offset: cursor,
      descending,
      fields: FEED_INLINE_FIELDS,
    });

    if (feed.data.length === 0) break;

    // Counting inside the transaction keeps the numbers honest: a concurrent
    // writer would otherwise make "new rows" come out negative.
    db.exec("begin immediate");
    let inserted = 0;
    try {
      const before = countRow();
      for (const entry of feed.data) upsert.run(...toRow(entry));
      inserted = countRow() - before;
      db.exec("commit");
    } catch (error) {
      db.exec("rollback");
      throw error;
    }

    progress.pages++;
    progress.entries += feed.data.length;
    progress.inserted += inserted;
    progress.updated += feed.data.length - inserted;
    progress.cursorDate = feed.data[feed.data.length - 1]?.dateModified ?? null;

    // Save after every page: an interrupted crawl must not repeat work, and it
    // must not skip any either.
    const next = feed.next_page?.offset;
    if (next) {
      writeState(db, cursorKey, next);
      if (progress.cursorDate) {
        writeState(db, `${cursorKey}_date`, progress.cursorDate);
      }
      writeState(db, "crawl_updated_at", new Date().toISOString());
    }

    onProgress?.({ ...progress });

    // The feed hands back a cursor even at the head, where it returns the same
    // last page forever. A short page means we have caught up.
    if (!next || feed.data.length < pageSize) break;
    cursor = next;

    if (delayMs > 0)
      await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  return progress;
}

function toRow(entry: FeedEntry) {
  return [
    entry.id,
    entry.tenderID ?? null,
    entry.dateModified,
    entry.status ?? null,
    entry.procurementMethodType ?? null,
    entry.procuringEntity?.identifier?.id ?? null,
    entry.procuringEntity?.name ??
      entry.procuringEntity?.identifier?.legalName ??
      null,
    entry.procuringEntity?.address?.region ?? null,
  ] as const;
}
