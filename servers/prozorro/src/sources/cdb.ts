import { requestJson } from "../http.js";

const CDB_BASE = "https://public.api.openprocurement.org/api/2.5";

/**
 * The central database behind Prozorro. It has no full-text search: it exposes a
 * chronological feed of every change plus a detail endpoint per procedure.
 *
 * Verified 2026-08-25: the feed honours `limit` up to 1000, `descending=1`, and
 * `opt_fields` — but only for a small whitelist. `status`, `tenderID`,
 * `procuringEntity` and `procurementMethodType` come back inline; `title`,
 * `value`, `items` and `awards` are silently dropped and need the detail call.
 */
export const FEED_INLINE_FIELDS = [
  "status",
  "tenderID",
  "procuringEntity",
  "procurementMethodType",
] as const;

export type FeedEntry = {
  id: string;
  dateModified: string;
  tenderID?: string;
  status?: string;
  procurementMethodType?: string;
  procuringEntity?: {
    name?: string;
    identifier?: { id?: string; legalName?: string };
    address?: { region?: string; locality?: string };
  };
};

export type FeedPage = {
  data: FeedEntry[];
  next_page?: { offset?: string; uri?: string };
};

export async function fetchFeedPage(options: {
  limit?: number;
  descending?: boolean;
  offset?: string;
  fields?: readonly string[];
}): Promise<FeedPage> {
  const params = new URLSearchParams({
    limit: String(Math.min(Math.max(options.limit ?? 100, 1), 1000)),
  });
  if (options.descending) params.set("descending", "1");
  if (options.offset) params.set("offset", options.offset);
  const fields = options.fields ?? FEED_INLINE_FIELDS;
  if (fields.length) params.set("opt_fields", fields.join(","));

  return requestJson<FeedPage>(`${CDB_BASE}/tenders?${params}`);
}

export type Tender = Record<string, unknown> & {
  id: string;
  tenderID?: string;
  title?: string;
  description?: string;
  status?: string;
  value?: { amount?: number; currency?: string; valueAddedTaxIncluded?: boolean };
  procurementMethodType?: string;
  dateModified?: string;
  tenderPeriod?: { startDate?: string; endDate?: string };
  procuringEntity?: unknown;
  items?: unknown[];
  awards?: unknown[];
  contracts?: unknown[];
  bids?: unknown[];
  documents?: unknown[];
  cancellations?: unknown[];
};

export async function fetchTender(uuid: string): Promise<Tender> {
  const { data } = await requestJson<{ data: Tender }>(`${CDB_BASE}/tenders/${uuid}`);
  return data;
}

/** The public page for a procedure, useful to hand a person a link to check. */
export function tenderWebUrl(tenderID: string) {
  return `https://prozorro.gov.ua/tender/${tenderID}`;
}
