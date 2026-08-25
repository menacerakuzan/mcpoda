import { requestJson } from "./http.js";

const BASE = "https://public-api.nazk.gov.ua/v2";

/**
 * The public register of declarations. Verified 25.08.2026: open, no key, and it
 * redacts the confidential fields itself — passport, tax number, УНЗР and the
 * exact address come back as `[Конфіденційна інформація]` rather than as values.
 *
 * Search is capped at ten thousand documents per query, which the service says
 * out loud in its `notice` field.
 */

export type DocumentSummary = {
  id: string;
  user_declarant_id: number;
  declaration_year: number;
  declaration_type: number;
  date: string;
  post_category?: string | null;
  post_type?: string | null;
  data?: DeclarationBody;
};

export type DeclarationBody = Record<string, unknown>;

export type Declaration = DocumentSummary & { data: DeclarationBody };

export type SearchResponse = {
  data: DocumentSummary[];
  count: number;
  notice?: string;
};

export type SearchQuery = {
  query?: string;
  declarantId?: number;
  year?: number;
  type?: number;
  page?: number;
};

export async function searchDocuments(query: SearchQuery): Promise<SearchResponse> {
  const params = new URLSearchParams({ page: String(Math.max(query.page ?? 1, 1)) });
  if (query.query) params.set("query", query.query);
  if (query.declarantId !== undefined) {
    params.set("user_declarant_id", String(query.declarantId));
  }
  if (query.year !== undefined) params.set("declaration_year", String(query.year));
  if (query.type !== undefined) params.set("declaration_type", String(query.type));

  return requestJson<SearchResponse>(`${BASE}/documents/list?${params}`);
}

export async function fetchDocument(id: string): Promise<Declaration> {
  return requestJson<Declaration>(`${BASE}/documents/${encodeURIComponent(id)}`);
}

/** The register's own numbering for kinds of declaration. */
export const DECLARATION_TYPES: Record<number, string> = {
  1: "щорічна",
  2: "перед звільненням",
  3: "після звільнення",
  4: "кандидата на посаду",
  5: "виправлена",
};

export const declarationType = (code: number) =>
  DECLARATION_TYPES[code] ?? `тип ${code}`;

/** The public page for a declaration, so a person can check the original. */
export const declarationUrl = (id: string) =>
  `https://public.nazk.gov.ua/documents/${id}`;
