import type { DatabaseSync } from "node:sqlite";
import { fetchTender } from "../sources/cdb.js";
import { normalizeText } from "./normalize.js";
import { pendingEnrichment } from "./queries.js";
import { toEpoch } from "./db.js";
import { summariseUnits, type Items } from "./units.js";

/**
 * The feed never carries a title, an amount or a CPV code, so a second pass
 * fetches the full record for procedures the index already knows about.
 *
 * It runs newest first: a person asking about procurement almost always means
 * something recent, and the index becomes useful long before the whole corpus
 * is covered. Every response says how much is covered so far, rather than
 * pretending an incomplete index is complete.
 */

export type EnrichProgress = {
  processed: number;
  updated: number;
  failed: number;
};

export type EnrichOptions = {
  limit?: number;
  /** This is one request per procedure, so the pause matters more than in the crawl. */
  delayMs?: number;
  /**
   * How many procedures are fetched at once. One at a time makes a backfill of
   * any size impossible; a large pool would hammer a national service. Four with
   * pacing lands around twenty requests a second, which is a backfill that
   * finishes without being rude.
   */
  concurrency?: number;
  /**
   * How many rows are pulled from the index at a time. The queue used to be
   * read in one `select ... limit N`, which was fine for the few hundred a
   * scheduled pass handles and useless for a real backfill: asking for four
   * million rows materialised four million objects before the first request
   * went out, so a run that should start in a second sat there allocating.
   * Reading a batch, draining it, then reading the next keeps memory flat and
   * lets the pass start immediately at any size — and because each row's
   * `enriched_at` is set as it goes, the next batch query simply skips it.
   */
  batchSize?: number;
  onProgress?: (progress: EnrichProgress) => void;
  fetch?: typeof fetchTender;
};

const UPDATE = `
update tenders set
  title          = ?,
  norm           = ?,
  value_amount   = ?,
  value_currency = ?,
  cpv            = ?,
  unit           = ?,
  quantity       = ?,
  unit_kind      = ?,
  status         = coalesce(?, status),
  enriched_at    = ?
where id = ?
`;

export async function enrich(
  db: DatabaseSync,
  options: EnrichOptions = {},
): Promise<EnrichProgress> {
  const {
    limit = 500,
    delayMs = 120,
    concurrency = 4,
    batchSize = 2000,
    onProgress,
    fetch = fetchTender,
  } = options;

  const update = db.prepare(UPDATE);
  const progress: EnrichProgress = { processed: 0, updated: 0, failed: 0 };

  let queue: Array<{ id: string; tender_id: string | null }> = [];
  let next = 0;

  const handle = async (row: { id: string }) => {
    progress.processed++;

    try {
      const tender = await fetch(row.id);
      const title =
        typeof tender.title === "string" ? tender.title.trim() : null;
      const items = (tender.items as Items & Array<{ classification?: { id?: string } }>) ?? [];
      const units = summariseUnits(items);

      update.run(
        title,
        title ? normalizeText(title) : null,
        tender.value?.amount ?? null,
        tender.value?.currency ?? null,
        items[0]?.classification?.id ?? null,
        units.unit,
        units.quantity,
        units.kind,
        tender.status ?? null,
        toEpoch(new Date().toISOString()),
        row.id,
      );
      progress.updated++;
    } catch {
      // A single unreachable procedure must not stop the pass: it stays unenriched
      // and comes up again on the next run.
      progress.failed++;
    }

    onProgress?.({ ...progress });
  };

  /** Each worker pulls the next procedure itself, so a slow one never blocks the rest. */
  const worker = async () => {
    while (next < queue.length) {
      const row = queue[next++];
      if (!row) break;
      await handle(row);
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  };

  const pool = Math.max(1, Math.min(concurrency, 8));

  while (progress.processed < limit) {
    const want = Math.min(batchSize, limit - progress.processed);
    queue = pendingEnrichment(db, want);
    // Nothing left to enrich: the pass is done early, which is the normal end
    // of a backfill rather than a failure.
    if (queue.length === 0) break;
    next = 0;

    await Promise.all(Array.from({ length: pool }, worker));

    // A batch that came back short means the index has no more pending rows;
    // asking again would just return empty and spin.
    if (queue.length < want) break;
  }

  return progress;
}
