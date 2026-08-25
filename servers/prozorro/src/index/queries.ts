import type { DatabaseSync } from "node:sqlite";
import { normalizeQuery } from "./normalize.js";

/** Reads over the local index. Nothing here touches the network. */

export type IndexedTender = {
  id: string;
  tender_id: string | null;
  date_modified: string;
  status: string | null;
  method: string | null;
  buyer_edrpou: string | null;
  buyer_name: string | null;
  region: string | null;
  title: string | null;
  value_amount: number | null;
  value_currency: string | null;
  cpv: string | null;
};

const COLUMNS = `
  id, tender_id, date_modified, status, method,
  buyer_edrpou, buyer_name, region,
  title, value_amount, value_currency, cpv
`;

/**
 * The whole reason the index exists: the sources give no way to turn a UA-
 * number into the internal id, and scanning the feed for an old procedure is
 * hopeless. Here it is a primary key lookup.
 */
export function lookupByTenderId(
  db: DatabaseSync,
  tenderID: string,
): IndexedTender | null {
  const row = db
    .prepare(
      `select ${COLUMNS} from tenders where tender_id = ? collate nocase limit 1`,
    )
    .get(tenderID.trim()) as IndexedTender | undefined;
  return row ?? null;
}

export type IndexSearch = {
  text?: string;
  status?: string[];
  region?: string;
  buyerEdrpou?: string;
  cpvPrefix?: string;
  minValue?: number;
  maxValue?: number;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
};

export type IndexSearchResult = {
  rows: IndexedTender[];
  total: number;
  /** How much of the corpus can actually answer a text query yet. */
  enrichedShare: number;
};

/**
 * Full text runs over two columns: the original title, so a literal phrase still
 * matches, and the stemmed form, so «дорога» finds «доріг». A query that only
 * hits one of them still comes back.
 */
export function searchIndex(
  db: DatabaseSync,
  query: IndexSearch,
): IndexSearchResult {
  const where: string[] = [];
  const params: Array<string | number> = [];

  if (query.text?.trim()) {
    const normalized = normalizeQuery(query.text);
    const literal = query.text.trim().toLowerCase();
    // FTS5 treats bare punctuation as syntax, so both sides are quoted
    const match = `title : ${quote(literal)} OR norm : ${quote(normalized)}`;
    where.push(
      `t.rowid in (select rowid from tenders_fts where tenders_fts match ?)`,
    );
    params.push(match);
  }

  if (query.status?.length) {
    where.push(`t.status in (${query.status.map(() => "?").join(", ")})`);
    params.push(...query.status);
  }
  if (query.region) {
    where.push("t.region like ?");
    params.push(`%${query.region}%`);
  }
  if (query.buyerEdrpou) {
    where.push("t.buyer_edrpou = ?");
    params.push(query.buyerEdrpou);
  }
  if (query.cpvPrefix) {
    where.push("t.cpv like ?");
    params.push(`${query.cpvPrefix}%`);
  }
  if (query.minValue !== undefined) {
    where.push("t.value_amount >= ?");
    params.push(query.minValue);
  }
  if (query.maxValue !== undefined) {
    where.push("t.value_amount <= ?");
    params.push(query.maxValue);
  }
  if (query.from) {
    where.push("t.date_modified >= ?");
    params.push(query.from);
  }
  if (query.to) {
    where.push("t.date_modified <= ?");
    params.push(query.to);
  }

  const clause = where.length ? `where ${where.join(" and ")}` : "";
  const limit = Math.min(Math.max(query.limit ?? 20, 1), 200);
  const offset = Math.max(query.offset ?? 0, 0);

  const rows = db
    .prepare(
      `select ${COLUMNS} from tenders t ${clause}
       order by t.date_modified desc
       limit ? offset ?`,
    )
    .all(...params, limit, offset) as IndexedTender[];

  const { total } = db
    .prepare(`select count(*) as total from tenders t ${clause}`)
    .get(...params) as { total: number };

  const share = db
    .prepare(
      `select count(*) as all_rows,
              sum(case when enriched_at is not null then 1 else 0 end) as done
       from tenders`,
    )
    .get() as { all_rows: number; done: number | null };

  return {
    rows,
    total,
    enrichedShare: share.all_rows ? (share.done ?? 0) / share.all_rows : 0,
  };
}

/**
 * FTS5 quotes phrases with double quotes, not the single quotes SQL uses, and an
 * inner double quote is escaped by doubling it. Getting this wrong turns every
 * query into a syntax error rather than a bad result, so it lives in one place.
 */
function quote(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

/** The next procedures worth fetching in full, newest first. */
export function pendingEnrichment(
  db: DatabaseSync,
  limit: number,
): Array<{ id: string; tender_id: string | null }> {
  return db
    .prepare(
      `select id, tender_id from tenders
       where enriched_at is null
       order by date_modified desc
       limit ?`,
    )
    .all(limit) as Array<{ id: string; tender_id: string | null }>;
}
