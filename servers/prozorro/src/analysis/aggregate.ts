import type { DatabaseSync } from "node:sqlite";
import { fromEpoch, toEpoch } from "../index/db.js";
import { describe } from "./stats.js";

/**
 * Sums and comparisons over the index.
 *
 * Both tools here report coverage next to every number, because an aggregate is
 * the one place where a partial index lies convincingly: «за цим кодом витрачено
 * 4 млн» reads as a fact even when the index holds a tenth of the period.
 */

export type Dimension = "buyer" | "region" | "cpv" | "month" | "status";

export type AggregateRow = {
  key: string | null;
  label: string | null;
  procedures: number;
  total: number;
  median: number | null;
};

export type AggregateResult = {
  dimension: Dimension;
  rows: AggregateRow[];
  totals: { procedures: number; sum: number; withAmount: number };
  coverage: Coverage;
  caveats: string[];
};

export type Coverage = {
  /** Procedures in the window that already carry an amount. */
  withAmount: number;
  inWindow: number;
  share: number;
  indexPeriod: { oldest: string | null; newest: string | null };
  note?: string;
};

type Filters = {
  from?: string;
  to?: string;
  region?: string;
  buyerEdrpou?: string;
  cpvPrefix?: string;
  status?: string[];
};

function where(filters: Filters) {
  const clauses: string[] = [];
  const params: Array<string | number> = [];

  if (filters.from) {
    clauses.push("t.modified >= ?");
    params.push(toEpoch(filters.from));
  }
  if (filters.to) {
    clauses.push("t.modified <= ?");
    params.push(toEpoch(filters.to) + 86_399);
  }
  if (filters.region) {
    clauses.push("b.region like ?");
    params.push(`%${filters.region}%`);
  }
  if (filters.buyerEdrpou) {
    clauses.push("t.buyer_edrpou = ?");
    params.push(filters.buyerEdrpou);
  }
  if (filters.cpvPrefix) {
    clauses.push("t.cpv like ?");
    params.push(`${filters.cpvPrefix}%`);
  }
  if (filters.status?.length) {
    clauses.push(`t.status in (${filters.status.map(() => "?").join(", ")})`);
    params.push(...filters.status);
  }

  return { sql: clauses.length ? `where ${clauses.join(" and ")}` : "", params };
}

const GROUPING: Record<Dimension, { key: string; label: string }> = {
  buyer: { key: "t.buyer_edrpou", label: "b.name" },
  region: { key: "b.region", label: "b.region" },
  cpv: { key: "t.cpv", label: "t.cpv" },
  month: { key: "strftime('%Y-%m', t.modified, 'unixepoch')", label: "strftime('%Y-%m', t.modified, 'unixepoch')" },
  status: { key: "t.status", label: "t.status" },
};

export function aggregate(
  db: DatabaseSync,
  options: Filters & { dimension: Dimension; limit?: number },
): AggregateResult {
  const { sql, params } = where(options);
  const group = GROUPING[options.dimension];
  const limit = Math.min(Math.max(options.limit ?? 15, 1), 100);

  const rows = db
    .prepare(
      `select ${group.key} as key, ${group.label} as label,
              count(*) as procedures,
              sum(coalesce(t.value_amount, 0)) as total
       from tenders t
       left join buyers b on b.edrpou = t.buyer_edrpou
       ${sql}
       group by 1
       order by total desc
       limit ?`,
    )
    .all(...params, limit) as Array<Omit<AggregateRow, "median">>;

  // The median needs the individual amounts, so it is a second pass over the
  // same groups rather than something SQLite can hand back from the aggregate.
  const medians = new Map<string | null, number | null>();
  for (const row of rows) {
    const values = db
      .prepare(
        `select t.value_amount as amount
         from tenders t
         left join buyers b on b.edrpou = t.buyer_edrpou
         ${sql} ${sql ? "and" : "where"} ${group.key} is ? and t.value_amount > 0`,
      )
      .all(...params, row.key) as Array<{ amount: number }>;
    medians.set(row.key, describe(values.map((v) => v.amount))?.median ?? null);
  }

  return {
    dimension: options.dimension,
    rows: rows.map((row) => ({ ...row, median: medians.get(row.key) ?? null })),
    totals: totalsFor(db, sql, params),
    coverage: coverage(db, sql, params),
    caveats: [
      "Суми це очікувана вартість процедур, а не сплачені кошти: після торгів і змін до договорів цифри інші.",
      "Рахується лише те, що вже є в локальному індексі. Якщо покриття неповне, суми занижені, а не помилкові.",
    ],
  };
}

function totalsFor(db: DatabaseSync, sql: string, params: Array<string | number>) {
  const row = db
    .prepare(
      `select count(*) as procedures,
              sum(coalesce(t.value_amount, 0)) as sum,
              sum(case when t.value_amount > 0 then 1 else 0 end) as withAmount
       from tenders t
       left join buyers b on b.edrpou = t.buyer_edrpou
       ${sql}`,
    )
    .get(...params) as { procedures: number; sum: number | null; withAmount: number | null };

  return {
    procedures: row.procedures,
    sum: row.sum ?? 0,
    withAmount: row.withAmount ?? 0,
  };
}

export function coverage(
  db: DatabaseSync,
  sql: string,
  params: Array<string | number>,
): Coverage {
  const row = db
    .prepare(
      `select count(*) as inWindow,
              sum(case when t.value_amount > 0 then 1 else 0 end) as withAmount
       from tenders t
       left join buyers b on b.edrpou = t.buyer_edrpou
       ${sql}`,
    )
    .get(...params) as { inWindow: number; withAmount: number | null };

  const period = db
    .prepare("select min(modified) as oldest, max(modified) as newest from tenders")
    .get() as { oldest: number | null; newest: number | null };

  const withAmount = row.withAmount ?? 0;
  const share = row.inWindow ? withAmount / row.inWindow : 0;

  return {
    withAmount,
    inWindow: row.inWindow,
    share: Number(share.toFixed(3)),
    indexPeriod: {
      oldest: period.oldest ? fromEpoch(period.oldest).slice(0, 10) : null,
      newest: period.newest ? fromEpoch(period.newest).slice(0, 10) : null,
    },
    note:
      share < 0.5
        ? `Сума порахована лише за ${withAmount} процедурами з ${row.inWindow}: решта ще не має суми в індексі. Це нижня межа, а не повна цифра.`
        : undefined,
  };
}

export type BuyerComparison = {
  cpv: string;
  unit: string | null;
  mode: "за одиницю" | "за всю закупівлю";
  period: { from: string | null; to: string | null };
  buyers: Array<{
    edrpou: string | null;
    name: string | null;
    region: string | null;
    procedures: number;
    median: number | null;
    min: number | null;
    max: number | null;
  }>;
  coverage: Coverage;
  caveats: string[];
};

/**
 * The question a громада actually asks: what did the neighbours pay for the same
 * thing? Same CPV, same unit, one row per buyer.
 */
export function compareBuyers(
  db: DatabaseSync,
  options: { cpv: string; unit?: string; from?: string; to?: string; region?: string; limit?: number },
): BuyerComparison | { error: string; message: string } {
  const filters: Filters = {
    from: options.from,
    to: options.to,
    region: options.region,
    cpvPrefix: options.cpv,
  };
  const { sql, params } = where(filters);
  const perUnit = Boolean(options.unit);

  const unitClause = perUnit ? " and t.unit = ? and t.quantity > 0" : "";
  const unitParams = perUnit ? [options.unit!] : [];

  const rows = db
    .prepare(
      `select t.buyer_edrpou as edrpou, b.name as name, b.region as region,
              t.value_amount as amount, t.quantity as quantity
       from tenders t
       left join buyers b on b.edrpou = t.buyer_edrpou
       ${sql} ${sql ? "and" : "where"} t.value_amount > 0${unitClause}`,
    )
    .all(...params, ...unitParams) as Array<{
    edrpou: string | null;
    name: string | null;
    region: string | null;
    amount: number;
    quantity: number | null;
  }>;

  if (rows.length === 0) {
    return {
      error: "no_data",
      message: `За кодом ${options.cpv}${perUnit ? ` в одиницях «${options.unit}»` : ""} в індексі немає закупівель із сумою. Перевірте proyav_index_status: можливо, індекс ще не дійшов до цього періоду.`,
    };
  }

  const byBuyer = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = row.edrpou ?? "невідомий";
    const bucket = byBuyer.get(key) ?? [];
    bucket.push(row);
    byBuyer.set(key, bucket);
  }

  const buyers = [...byBuyer.entries()]
    .map(([edrpou, group]) => {
      const values = group
        .map((row) => (perUnit && row.quantity ? row.amount / row.quantity : row.amount))
        .filter((v) => v > 0);
      const stats = describe(values);
      return {
        edrpou: edrpou === "невідомий" ? null : edrpou,
        name: group[0]?.name ?? null,
        region: group[0]?.region ?? null,
        procedures: values.length,
        median: stats?.median ?? null,
        min: stats?.min ?? null,
        max: stats?.max ?? null,
      };
    })
    .sort((a, b) => (b.median ?? 0) - (a.median ?? 0))
    .slice(0, Math.min(options.limit ?? 20, 100));

  return {
    cpv: options.cpv,
    unit: options.unit ?? null,
    mode: perUnit ? "за одиницю" : "за всю закупівлю",
    period: { from: options.from ?? null, to: options.to ?? null },
    buyers,
    coverage: coverage(db, sql, params),
    caveats: [
      perUnit
        ? `Порівнюються ціни за одиницю «${options.unit}». Закупівлі з іншими одиницями до вибірки не входять.`
        : "Порівнюються загальні суми процедур. Обсяг у різних замовників може відрізнятись у рази, тому без одиниці виміру це порівняння грубе: краще вказати unit.",
      "Один замовник з однією процедурою це не показник: дивіться на кількість процедур у кожному рядку.",
      "Різниця в ціні між замовниками може пояснюватись логістикою, обсягом і термінами. Це привід запитати, а не висновок.",
    ],
  };
}
