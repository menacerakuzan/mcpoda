import type { DatabaseSync } from "node:sqlite";
import { readState, writeState, toEpoch } from "./db.js";
import {
  fetchMonitoring,
  fetchMonitoringFeed,
  type Monitoring,
} from "../sources/audit.js";

/**
 * Builds the local table of Держаудитслужба monitorings.
 *
 * Two passes, same shape as the procurement index and for the same reason: the
 * feed carries only an id and a timestamp, so the conclusion — the part worth
 * having — needs a request per monitoring. The difference is scale. There are
 * tens of thousands of monitorings against thirty million procedures, so the
 * whole thing finishes in an hour rather than a day, and both passes can run
 * in one command without anyone having to plan around it.
 */

export type AuditProgress = {
  pages: number;
  seen: number;
  inserted: number;
  detailed: number;
  failed: number;
  cursorDate: string | null;
};

const CURSOR = "audit_cursor";
const CURSOR_DATE = "audit_cursor_date";

const insertShallow = `insert or ignore into monitorings (id, modified) values (?, ?)`;

/**
 * A monitoring that changed since we last saw it goes back into the detail
 * queue by having its description cleared.
 *
 * This is what makes a running check eventually become a concluded one in the
 * index. Without it, an `active` monitoring would be recorded once as "no
 * conclusion yet" and stay that way forever, even after the audit service
 * published its finding — the index would quietly hold the wrong answer about
 * a real procurement.
 */
const touchShallow = `
update monitorings
   set description = case when modified <> ? then null else description end,
       modified = ?
 where id = ?
`;

const upsertFull = `
update monitorings set
  monitoring_id      = ?,
  tender_id          = ?,
  status             = ?,
  reasons            = ?,
  violation_occurred = ?,
  violation_type     = ?,
  description        = ?,
  started_at         = ?
where id = ?
`;

export type AuditOptions = {
  maxPages?: number;
  pageSize?: number;
  delayMs?: number;
  /** How many detail requests are in flight at once. Capped at eight. */
  concurrency?: number;
  onProgress?: (progress: AuditProgress) => void;
  fetchPage?: typeof fetchMonitoringFeed;
  fetchOne?: typeof fetchMonitoring;
};

/** Walks the change feed and records every monitoring id it has not seen. */
export async function crawlMonitorings(
  db: DatabaseSync,
  options: AuditOptions = {},
): Promise<AuditProgress> {
  const {
    maxPages = 0,
    pageSize = 1000,
    delayMs = 150,
    onProgress,
    fetchPage = fetchMonitoringFeed,
  } = options;

  const insert = db.prepare(insertShallow);
  const touch = db.prepare(touchShallow);
  const progress: AuditProgress = {
    pages: 0,
    seen: 0,
    inserted: 0,
    detailed: 0,
    failed: 0,
    cursorDate: readState(db, CURSOR_DATE),
  };

  let offset = readState(db, CURSOR) ?? undefined;

  for (;;) {
    if (maxPages && progress.pages >= maxPages) break;

    const page = await fetchPage({ offset, limit: pageSize });
    const rows = page.data ?? [];
    if (rows.length === 0) break;

    for (const row of rows) {
      const modified = toEpoch(row.dateModified);
      const result = insert.run(row.id, modified);
      progress.seen++;
      if (result.changes === 1) progress.inserted++;
      else touch.run(modified, modified, row.id);
      progress.cursorDate = row.dateModified;
    }

    progress.pages++;
    offset = page.next_page?.offset;
    // No next offset means the feed has nothing further to give.
    if (!offset) break;

    writeState(db, CURSOR, offset);
    if (progress.cursorDate) writeState(db, CURSOR_DATE, progress.cursorDate);
    onProgress?.({ ...progress });

    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  if (offset) writeState(db, CURSOR, offset);
  if (progress.cursorDate) writeState(db, CURSOR_DATE, progress.cursorDate);
  return progress;
}

function pendingDetail(db: DatabaseSync, limit: number): Array<{ id: string }> {
  return db
    .prepare(
      // Newest first: a recent conclusion is what someone is most likely to ask
      // about, and an unfinished pass still leaves the useful part covered.
      "select id from monitorings where description is null order by modified desc limit ?",
    )
    .all(limit) as Array<{ id: string }>;
}

/**
 * Fills in the conclusion for monitorings the feed pass only recorded by id.
 *
 * A monitoring still in progress has no conclusion yet, and that is not a
 * failure — it is recorded with its status so the answer can say «перевірка
 * триває» rather than pretending there is nothing.
 */
export async function detailMonitorings(
  db: DatabaseSync,
  options: AuditOptions & { limit?: number } = {},
): Promise<AuditProgress> {
  const {
    limit = 2000,
    delayMs = 120,
    concurrency = 8,
    onProgress,
    fetchOne = fetchMonitoring,
  } = options;

  const update = db.prepare(upsertFull);
  const progress: AuditProgress = {
    pages: 0,
    seen: 0,
    inserted: 0,
    detailed: 0,
    failed: 0,
    cursorDate: null,
  };

  const queue = pendingDetail(db, limit);
  let next = 0;

  /**
   * Measured on the real feed 27.08.2026: 82 467 monitorings exist, and one at
   * a time meant nearly six hours for a first pass. Eight in flight brings that
   * under an hour — the same pool the procurement enrichment uses, and the same
   * ceiling, because this is a national service and a backfill has no business
   * turning into a flood.
   */
  const worker = async () => {
    while (next < queue.length) {
      const row = queue[next++];
      if (!row) break;

      progress.seen++;
      try {
        const monitoring = await fetchOne(row.id);
        writeMonitoring(update, monitoring);
        progress.detailed++;
      } catch {
        // One unreachable record must not stop the pass: it stays pending and
        // comes up again next run.
        progress.failed++;
      }
      onProgress?.({ ...progress });
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  };

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, 8)) }, worker),
  );

  return progress;
}

export function writeMonitoring(
  update: ReturnType<DatabaseSync["prepare"]>,
  monitoring: Monitoring,
) {
  const conclusion = monitoring.conclusion;

  update.run(
    monitoring.monitoring_id ?? null,
    monitoring.tender_id ?? null,
    monitoring.status ?? null,
    monitoring.reasons?.length ? monitoring.reasons.join(",") : null,
    // Stored as 0/1/null: null means the check has not concluded, which is a
    // different answer from "no violation" and must not collapse into it.
    conclusion?.violationOccurred === undefined
      ? null
      : conclusion.violationOccurred
        ? 1
        : 0,
    conclusion?.violationType?.length ? conclusion.violationType.join(",") : null,
    // A non-null description is what marks a record as detailed, so a concluded
    // monitoring with an empty description still gets a placeholder rather than
    // being fetched forever.
    conclusion?.description?.trim() ||
      (conclusion ? "(висновок без опису)" : "(висновку ще немає)"),
    monitoring.monitoringPeriod?.startDate
      ? toEpoch(monitoring.monitoringPeriod.startDate)
      : null,
    monitoring.id,
  );
}
