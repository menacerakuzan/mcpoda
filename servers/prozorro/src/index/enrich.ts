import type { DatabaseSync } from "node:sqlite";
import { fetchTender } from "../sources/cdb.js";
import { normalizeText } from "./normalize.js";
import { pendingEnrichment } from "./queries.js";

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
    onProgress,
    fetch = fetchTender,
  } = options;

  const update = db.prepare(UPDATE);
  const queue = pendingEnrichment(db, limit);
  const progress: EnrichProgress = { processed: 0, updated: 0, failed: 0 };

  for (const row of queue) {
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
        new Date().toISOString(),
        row.id,
      );
      progress.updated++;
    } catch {
      // A single unreachable procedure must not stop the pass: it stays unenriched
      // and comes up again on the next run.
      progress.failed++;
    }

    onProgress?.({ ...progress });
    if (delayMs > 0)
      await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  return progress;
}
