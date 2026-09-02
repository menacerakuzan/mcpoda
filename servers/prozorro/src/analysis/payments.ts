import {
  dateWindows,
  fetchTransactions,
  type PaymentSide,
  type Transaction,
} from "../sources/edata.js";

/**
 * Actual treasury payments for one organisation, summarised.
 *
 * The raw feed is a list of bank transfers; what a person asks is «скільки
 * насправді заплатили» and «кому». So this returns the total, the counterparts
 * ranked by amount, and only a handful of example transactions — a quarter can
 * be hundreds of rows and none of them mean anything individually.
 */

export type Counterpart = {
  edrpou: string | null;
  name: string | null;
  total: number;
  transactions: number;
};

export type PaymentSummary = {
  edrpou: string;
  side: PaymentSide;
  period: { from: string; to: string };
  windowsRequested: number;
  transactions: number;
  total: number;
  currency: string;
  counterparts: Counterpart[];
  examples: Array<{
    date: string | null;
    amount: number;
    counterpart: string | null;
    purpose: string | null;
  }>;
  caveats: string[];
};

const money = (value: number) =>
  new Intl.NumberFormat("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);

export async function summarisePayments(options: {
  edrpou: string;
  side: PaymentSide;
  from: string;
  to: string;
  topCounterparts?: number;
  examples?: number;
  fetch?: typeof fetchTransactions;
}): Promise<PaymentSummary> {
  const {
    edrpou,
    side,
    from,
    to,
    topCounterparts = 15,
    examples = 5,
    fetch = fetchTransactions,
  } = options;

  const windows = dateWindows(from, to);
  const rows: Transaction[] = [];

  for (const window of windows) {
    const batch = await fetch({ edrpou, side, from: window.from, to: window.to });
    rows.push(...batch);
  }

  // The other side of the transfer: for payments a buyer made, that is who
  // received the money, and the reverse for a supplier.
  const counterEdrpou = (t: Transaction) =>
    side === "payer" ? t.recipt_edrpou : t.payer_edrpou;
  const counterName = (t: Transaction) =>
    side === "payer" ? t.recipt_name : t.payer_name;

  const byCounterpart = new Map<string, Counterpart>();
  let total = 0;

  for (const row of rows) {
    const amount = row.amount ?? 0;
    total += amount;

    const key = counterEdrpou(row) ?? counterName(row) ?? "невідомо";
    const existing = byCounterpart.get(key);
    if (existing) {
      existing.total += amount;
      existing.transactions++;
    } else {
      byCounterpart.set(key, {
        edrpou: counterEdrpou(row) ?? null,
        name: counterName(row) ?? null,
        total: amount,
        transactions: 1,
      });
    }
  }

  const counterparts = [...byCounterpart.values()]
    .sort((a, b) => b.total - a.total)
    .slice(0, topCounterparts)
    .map((c) => ({ ...c, total: Number(c.total.toFixed(2)) }));

  const caveats = [
    "Це рух коштів через Державну казначейську службу, а не сума договорів. Платіж може бути авансом, частковою оплатою або оплатою за договором минулих років.",
    "Не всі видатки проходять через казначейство: підприємства, що не обслуговуються в ньому, тут не видно.",
    "Призначення платежу заповнює платник вільним текстом, тому воно буває скороченим до нечитабельного.",
  ];

  if (windows.length > 1) {
    caveats.push(
      `Джерело віддає максимум ${windows.length === 1 ? "" : "92 дні "}за запит, тому період розбито на ${windows.length} вікон.`,
    );
  }
  if (rows.length === 0) {
    caveats.push(
      "За цей період платежів не знайдено. Це не означає, що організація нічого не отримувала: перевірте період і код ЄДРПОУ.",
    );
  }

  return {
    edrpou,
    side,
    period: { from, to },
    windowsRequested: windows.length,
    transactions: rows.length,
    total: Number(total.toFixed(2)),
    currency: rows[0]?.currency ?? "UAH",
    counterparts,
    examples: rows
      .slice()
      .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))
      .slice(0, examples)
      .map((t) => ({
        date: t.trans_date ?? t.doc_date ?? null,
        amount: Number((t.amount ?? 0).toFixed(2)),
        counterpart: counterName(t) ?? counterEdrpou(t) ?? null,
        purpose: t.payment_details?.trim() || null,
      })),
    caveats,
  };
}

export { money };
