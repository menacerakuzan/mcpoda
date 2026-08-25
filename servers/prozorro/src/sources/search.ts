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
  perPage?: number;
};

export async function searchTenders(
  query: SearchQuery,
): Promise<SearchResponse> {
  const body: Record<string, unknown> = {
    text: query.text,
    per_page: Math.min(Math.max(query.perPage ?? 20, 1), 100),
    // the validator demands page >= 1 even though responses report page 0
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
