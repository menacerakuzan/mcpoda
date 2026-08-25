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

/**
 * Insert and update are two statements on purpose. A single upsert cannot say
 * whether it inserted or updated, and the obvious workaround — counting rows
 * before and after — is a full table scan on every page. That is what dragged
 * the crawl from 2500 records a second down to 600 as the table grew.
 *
 * `insert or ignore` reports changes = 0 when the row already exists, which is
 * the same information for the price of an index lookup.
 */
const INSERT = `
insert or ignore into tenders (
  id, tender_id, date_modified, status, method, buyer_edrpou, buyer_name, region
) values (?, ?, ?, ?, ?, ?, ?, ?)
`;

const UPDATE = `
update tenders set
  tender_id     = coalesce(?, tender_id),
  date_modified = ?,
  status        = coalesce(?, status),
  method        = coalesce(?, method),
  buyer_edrpou  = coalesce(?, buyer_edrpou),
  buyer_name    = coalesce(?, buyer_name),
  region        = coalesce(?, region)
where id = ?
`;

/**
 * The daily catch-up. It picks up the forward cursor where the last run stopped,
 * so it only reads what changed since then: a procedure that was updated shows
 * up again in the feed and overwrites its row.
 *
 * This is deliberately the same code path as the history crawl. A separate
 * "incremental" implementation would drift from it and eventually miss changes.
 */
export async function catchUp(
  db: DatabaseSync,
  options: Omit<CrawlOptions, "from" | "descending"> = {},
): Promise<CrawlProgress> {
  const cursor = readState(db, "crawl_cursor");
  if (!cursor) {
    throw new Error(
      "Немає збереженого курсора: спершу зробіть повний обхід (crawl) або обхід свіжого (crawl --recent).",
    );
  }
  return crawl(db, options);
}

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

  const insert = db.prepare(INSERT);
  const update = db.prepare(UPDATE);

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

  // Prefetching the next page while writing the current one was tried and
  // dropped. Throughput swings between roughly 550 and 900 records a second on
  // identical code, so short runs cannot tell the two apart, and the plain loop
  // is the one worth keeping until there is a measurement that can. Worth
  // revisiting with a long A/B if a full pass ever needs to be faster.
  for (let page = 0; maxPages === 0 || page < maxPages; page++) {
    const feed = await fetchPage({
      limit: pageSize,
      offset: cursor,
      descending,
      fields: FEED_INLINE_FIELDS,
    });

    if (feed.data.length === 0) break;

    db.exec("begin immediate");
    let inserted = 0;
    try {
      for (const entry of feed.data) {
        const row = toRow(entry);
        const result = insert.run(...row);
        if (result.changes === 0) {
          const [id, ...rest] = row;
          update.run(...rest, id);
        } else {
          inserted++;
        }
      }
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

    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
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
