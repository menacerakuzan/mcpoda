import { fetchFeedPage, type FeedPage } from "./sources/cdb.js";

/**
 * The search service knows procedures by their UA- number, the central database
 * knows them by an internal uuid, and nothing maps between the two.
 *
 * The feed is a changes feed: every procedure sits at its LAST modification, not
 * at its creation. So we walk it backwards from now and stop as soon as entries
 * predate the day the number was issued, because a procedure cannot have been
 * modified before it existed. That makes the scan cheap for anything still alive
 * and correctly hopeless for a procedure untouched for years, which is exactly
 * the case the local index is meant to solve.
 */
export const MAX_SCAN_PAGES = 6;

export type FeedReader = (options: {
  limit?: number;
  descending?: boolean;
  offset?: string;
  fields?: readonly string[];
}) => Promise<FeedPage>;

export type ResolveOutcome =
  | { found: true; uuid: string; pagesScanned: number }
  | {
      found: false;
      reason: "bad_format" | "predates_number" | "scan_exhausted";
      pagesScanned: number;
    };

export async function resolveTenderId(
  tenderID: string,
  readFeed: FeedReader = fetchFeedPage,
): Promise<ResolveOutcome> {
  // the trailing suffix is lower case in real data ("-a"), so upper-casing the
  // whole number would make every comparison miss
  const wanted = tenderID.trim();
  const match = /^UA-(\d{4}-\d{2}-\d{2})-/i.exec(wanted);
  if (!match) return { found: false, reason: "bad_format", pagesScanned: 0 };

  const issuedAt = new Date(`${match[1]}T00:00:00Z`).getTime();
  const needle = wanted.toLowerCase();
  let offset: string | undefined;

  for (let pageIndex = 0; pageIndex < MAX_SCAN_PAGES; pageIndex++) {
    const page = await readFeed({
      limit: 1000,
      descending: true,
      offset,
      fields: ["tenderID"],
    });
    const pagesScanned = pageIndex + 1;

    const hit = page.data.find(
      (entry) => entry.tenderID?.toLowerCase() === needle,
    );
    if (hit) return { found: true, uuid: hit.id, pagesScanned };

    const oldest = page.data[page.data.length - 1]?.dateModified;
    if (oldest && new Date(oldest).getTime() < issuedAt) {
      return { found: false, reason: "predates_number", pagesScanned };
    }

    if (!page.next_page?.offset || page.data.length === 0) {
      return { found: false, reason: "scan_exhausted", pagesScanned };
    }
    offset = page.next_page.offset;
  }

  return {
    found: false,
    reason: "scan_exhausted",
    pagesScanned: MAX_SCAN_PAGES,
  };
}
