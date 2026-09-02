import { requestJson } from "../http.js";

/**
 * Є-data: actual payments made by the State Treasury.
 *
 * This closes the gap every money tool in this server has had to apologise for.
 * Prozorro publishes the expected value of a procedure and the contract amount;
 * it does not say what was paid. Є-data does — real transactions, by payer, by
 * recipient, with the payment purpose written on them.
 *
 * Queried live rather than indexed. A single buyer generates hundreds of
 * transactions a quarter and the country generates millions, so there is
 * nothing to gain from copying it locally when the source already filters by
 * organisation and date.
 *
 * Three properties were found by probing on 27.08.2026, and each one would
 * silently produce wrong answers if ignored:
 *
 * 1. HTTPS does not work on this host — the API answers over plain HTTP only.
 *    The data is public, so nothing secret travels, but it is worth knowing.
 *
 * 2. The parameter names are snake_case (`payers_edrpous`, `recipt_edrpous`).
 *    The camelCase forms a reader would guess — `payersEdrpous`,
 *    `recipientEdrpous` — are *silently ignored*, and the API returns
 *    unfiltered transactions instead of an error. The first probe here looked
 *    like it had found a buyer's payments and had in fact returned a ministry
 *    on the other side of the country. Anything built on the wrong spelling
 *    would answer confidently about the wrong organisation.
 *
 * 3. The date range is capped at 92 days per request, so any longer period has
 *    to be walked in windows.
 */

const BASE = "http://api.spending.gov.ua/api/v2/api/transactions/";

/** The source refuses anything wider, so callers are chunked to fit. */
export const MAX_RANGE_DAYS = 92;

export type Transaction = {
  id: number;
  trans_date?: string;
  doc_date?: string;
  amount?: number;
  currency?: string;
  payer_edrpou?: string;
  payer_name?: string;
  recipt_edrpou?: string;
  recipt_name?: string;
  payment_details?: string;
  kekv?: string | number;
  contractNumber?: string | null;
};

export type PaymentSide = "payer" | "recipient";

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Splits a period into windows the source will accept, oldest first.
 *
 * Exported because the tools need to tell a person how many requests their
 * question turned into, and because it is the part most worth testing: an
 * off-by-one here silently drops a day of payments.
 */
export function dateWindows(
  from: string,
  to: string,
  maxDays = MAX_RANGE_DAYS,
): Array<{ from: string; to: string }> {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error(`Дати мають бути у форматі РРРР-ММ-ДД, отримано «${from}» і «${to}».`);
  }
  if (start > end) {
    throw new Error("Початок періоду пізніший за кінець.");
  }

  const windows: Array<{ from: string; to: string }> = [];
  const cursor = new Date(start);

  while (cursor <= end) {
    const windowEnd = new Date(cursor);
    // Inclusive range: a 92-day window spans the start day plus 91 more.
    windowEnd.setUTCDate(windowEnd.getUTCDate() + maxDays - 1);
    windows.push({
      from: isoDay(cursor),
      to: isoDay(windowEnd > end ? end : windowEnd),
    });
    cursor.setUTCDate(cursor.getUTCDate() + maxDays);
  }

  return windows;
}

/** One window of transactions for one organisation, on the side asked for. */
export async function fetchTransactions(options: {
  edrpou: string;
  side: PaymentSide;
  from: string;
  to: string;
}): Promise<Transaction[]> {
  const params = new URLSearchParams();
  params.set("startdate", options.from);
  params.set("enddate", options.to);
  // Spelling matters: see the note at the top of this file.
  params.set(
    options.side === "payer" ? "payers_edrpous" : "recipt_edrpous",
    options.edrpou,
  );

  const response = await requestJson<Transaction[] | { errorMessage?: string }>(
    `${BASE}?${params}`,
  );

  if (!Array.isArray(response)) {
    throw new Error(
      response.errorMessage ?? "Є-data повернула несподівану відповідь замість переліку транзакцій.",
    );
  }
  return response;
}
