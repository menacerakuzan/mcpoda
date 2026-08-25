import { requestJson } from "../http.js";

const SEARCH_URL = "https://prozorro.gov.ua/api/search/tenders";

/**
 * The public search service behind prozorro.gov.ua. Verified 2026-08-25:
 * POST only, `text` must be a non-empty string, `status` accepts an array of
 * procedure statuses, results are capped at 10 000 matches regardless of paging.
 * No key and no registration, which is why it is our default entry point.
 */
export type SearchHit = {
  tenderID: string;
  title: string;
  status: string;
  value?: {
    amount?: number;
    currency?: string;
    valueAddedTaxIncluded?: boolean;
  };
  procuringEntity?: {
    name?: string;
    kind?: string;
    identifier?: { id?: string; legalName?: string };
    address?: { region?: string; locality?: string };
  };
};

export type SearchResponse = {
  page: number;
  per_page: number;
  total: number;
  data: SearchHit[];
};

export type SearchQuery = {
  text: string;
  status?: string[];
  page?: number;
};

/**
 * The service always returns exactly 20 records: `per_page` is accepted and then
 * ignored, and the response echoes 20 whatever you send. Page size is therefore
 * a constant here, and anything larger is assembled from consecutive pages.
 */
export const SOURCE_PAGE_SIZE = 20;

export async function searchTenders(
  query: SearchQuery,
): Promise<SearchResponse> {
  const body: Record<string, unknown> = {
    text: query.text,
    // paging is 1-based: the validator rejects 0, and the response echoes back
    // whatever page was asked for
    page: Math.max(query.page ?? 1, 1),
  };
  if (query.status?.length) body.status = query.status;

  return requestJson<SearchResponse>(SEARCH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** The known procedure statuses, kept here so tool schemas can enumerate them. */
export const TENDER_STATUSES = [
  "active.tendering",
  "active.enquiries",
  "active.auction",
  "active.qualification",
  "active.awarded",
  "complete",
  "cancelled",
  "unsuccessful",
] as const;
