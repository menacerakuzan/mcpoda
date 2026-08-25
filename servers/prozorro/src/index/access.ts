import type { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import {
  databasePath,
  indexStats,
  openDatabase,
  type IndexStats,
  SchemaMismatch,
} from "./db.js";
import { lookupByTenderId, searchIndex, type IndexSearch } from "./queries.js";
import { benchmark } from "../analysis/benchmark.js";

/**
 * The index is optional. A person who has just installed the server has no
 * database yet, and the tools must still work — slower, and with the known gaps,
 * but without a wall of setup instructions. So everything here degrades to null
 * rather than throwing, and the tools say which route they took.
 */

let cached: Index | null | undefined;
let lastError: string | null = null;

/** Why the index is unavailable, when the reason is worth telling the person. */
export const indexUnavailableReason = () => lastError;

export type Index = {
  path: string;
  stats(): IndexStats;
  lookup(tenderID: string): ReturnType<typeof lookupByTenderId>;
  benchmark(options: Parameters<typeof benchmark>[1]): ReturnType<typeof benchmark>;
  search(query: IndexSearch): ReturnType<typeof searchIndex>;
  close(): void;
};

export function getIndex(): Index | null {
  if (cached !== undefined) return cached;

  const path = databasePath();
  if (!existsSync(path)) {
    cached = null;
    return cached;
  }

  let db: DatabaseSync;
  try {
    db = openDatabase(path);
  } catch (error) {
    // A stale, corrupt or locked index must not take the server down with it:
    // the tools fall back to querying the sources directly.
    lastError =
      error instanceof SchemaMismatch ? error.message : null;
    cached = null;
    return cached;
  }

  cached = {
    path,
    stats: () => indexStats(db),
    lookup: (tenderID) => lookupByTenderId(db, tenderID),
    benchmark: (options) => benchmark(db, options),
    search: (query) => searchIndex(db, query),
    close: () => db.close(),
  };
  return cached;
}

/** Convenience for tools: null when there is no index to read. */
export function benchmarkTender(options: Parameters<typeof benchmark>[1]) {
  return getIndex()?.benchmark(options) ?? null;
}

/** Tests need a clean slate between cases. */
export function resetIndexCache() {
  cached?.close();
  cached = undefined;
  lastError = null;
}
