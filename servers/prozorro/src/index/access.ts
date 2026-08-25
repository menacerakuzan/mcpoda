import type { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import {
  databasePath,
  indexStats,
  openDatabase,
  type IndexStats,
} from "./db.js";
import { lookupByTenderId, searchIndex, type IndexSearch } from "./queries.js";

/**
 * The index is optional. A person who has just installed the server has no
 * database yet, and the tools must still work — slower, and with the known gaps,
 * but without a wall of setup instructions. So everything here degrades to null
 * rather than throwing, and the tools say which route they took.
 */

let cached: Index | null | undefined;

export type Index = {
  path: string;
  stats(): IndexStats;
  lookup(tenderID: string): ReturnType<typeof lookupByTenderId>;
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
  } catch {
    // A corrupt or locked database must not take the server down with it.
    cached = null;
    return cached;
  }

  cached = {
    path,
    stats: () => indexStats(db),
    lookup: (tenderID) => lookupByTenderId(db, tenderID),
    search: (query) => searchIndex(db, query),
    close: () => db.close(),
  };
  return cached;
}

/** Tests need a clean slate between cases. */
export function resetIndexCache() {
  cached?.close();
  cached = undefined;
}
