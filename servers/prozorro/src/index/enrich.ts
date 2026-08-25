import type { DatabaseSync } from "node:sqlite";
import { fetchTender } from "../sources/cdb.js";
import { normalizeText } from "./normalize.js";
import { pendingEnrichment } from "./queries.js";
import { toEpoch } from "./db.js";

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
    onProgress,
    fetch = fetchTender,
  } = options;

  const update = db.prepare(UPDATE);
  const queue = pendingEnrichment(db, limit);
  const progress: EnrichProgress = { processed: 0, updated: 0, failed: 0 };

  let next = 0;

  const handle = async (row: { id: string }) => {
    progress.processed++;

    try {
      const tender = await fetch(row.id);
      const title =
        typeof tender.title === "string" ? tender.title.trim() : null;
      const items =
        (tender.items as Array<{ classification?: { id?: string } }>) ?? [];

      update.run(
        title,
        title ? normalizeText(title) : null,
        tender.value?.amount ?? null,
        tender.value?.currency ?? null,
        items[0]?.classification?.id ?? null,
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

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, 8)) }, worker),
  );

  return progress;
}
