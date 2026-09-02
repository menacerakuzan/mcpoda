import type { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import {
  databasePath,
  indexStats,
  openDatabase,
  type IndexStats,
  SchemaMismatch,
} from "./db.js";
import { lookupByTenderId, monitoringsFor, searchIndex, type IndexSearch } from "./queries.js";
import { benchmark } from "../analysis/benchmark.js";
import { aggregate, compareBuyers } from "../analysis/aggregate.js";

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
  aggregate(options: Parameters<typeof aggregate>[1]): ReturnType<typeof aggregate>;
  compareBuyers(
    options: Parameters<typeof compareBuyers>[1],
  ): ReturnType<typeof compareBuyers>;
  search(query: IndexSearch): ReturnType<typeof searchIndex>;
  monitorings(tenderUuid: string): ReturnType<typeof monitoringsFor>;
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
    stats: () => indexStats(db, { cached: true }),
    lookup: (tenderID) => lookupByTenderId(db, tenderID),
    benchmark: (options) => benchmark(db, options),
    aggregate: (options) => aggregate(db, options),
    compareBuyers: (options) => compareBuyers(db, options),
    search: (query) => searchIndex(db, query),
    monitorings: (tenderUuid) => monitoringsFor(db, tenderUuid),
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
