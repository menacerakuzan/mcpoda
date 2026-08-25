import type { DatabaseSync } from "node:sqlite";
import { fromEpoch, toEpoch } from "../index/db.js";
import { classifyUnit } from "../index/units.js";
import { describe, locate, verdict, type Distribution } from "./stats.js";

/**
 * Compares one procedure against the ones like it.
 *
 * Two rules keep this from producing confident nonsense. Comparables must share
 * the unit of measure, because a kilometre of road and a square metre of road
 * are different numbers wearing the same words. And a comparison is refused
 * outright when there is not enough to compare against — a "median" of three
 * procedures is a rumour, not a benchmark.
 */

export type Comparable = {
  tenderID: string | null;
  title: string | null;
  buyer: string | null;
  region: string | null;
  date: string;
  total: number;
  quantity: number | null;
  unitPrice: number | null;
};

export type BenchmarkRefusal = {
  ok: false;
  reason:
    | "not_in_index"
    | "not_enriched"
    | "no_unit"
    | "no_cpv"
    | "too_few_comparables";
  message: string;
  details?: Record<string, unknown>;
};

export type BenchmarkResult = {
  ok: true;
  subject: Comparable & { cpv: string | null; unit: string | null; status: string | null };
  /** measurable units compare price per unit, whole units compare totals */
  mode: "за одиницю" | "за всю закупівлю";
  unit: string | null;
  cpv: string;
  period: { from: string; to: string };
  distribution: Distribution;
  position: { ratioToMedian: number; percentile: number; cheaperCount: number; dearerCount: number };
  reading: { level: string; note: string };
  sample: Comparable[];
  /** How mixed the comparison group is, so the median is read with the right weight. */
  homogeneity: { spread: number; quartileRatio: number; reliable: boolean };
  caveats: string[];
};

const MIN_COMPARABLES = 8;
const DEFAULT_WINDOW_DAYS = 550;

type Row = {
  id: string;
  tender_id: string | null;
  title: string | null;
  status: string | null;
  modified: number;
  value_amount: number | null;
  cpv: string | null;
  unit: string | null;
  quantity: number | null;
  buyer_name: string | null;
  region: string | null;
};

const SELECT = `
select t.id, t.tender_id, t.title, t.status, t.modified, t.value_amount,
       t.cpv, t.unit, t.quantity, b.name as buyer_name, b.region as region
from tenders t
left join buyers b on b.edrpou = t.buyer_edrpou
`;

export function benchmark(
  db: DatabaseSync,
  options: { tenderID: string; windowDays?: number; sampleSize?: number },
): BenchmarkResult | BenchmarkRefusal {
  const subject = db
    .prepare(`${SELECT} where t.tender_id = ? collate nocase limit 1`)
    .get(options.tenderID.trim()) as Row | undefined;

  if (!subject) {
    return {
      ok: false,
      reason: "not_in_index",
      message: `Процедури ${options.tenderID} немає в локальному індексі. Перевірте proyav_index_status: можливо, індекс ще не дійшов до цього періоду.`,
    };
  }

  if (!subject.value_amount) {
    return {
      ok: false,
      reason: "not_enriched",
      message:
        "Для цієї процедури в індексі ще немає суми. Вона зʼявиться після проходу збагачення.",
    };
  }

  if (!subject.cpv) {
    return {
      ok: false,
      reason: "no_cpv",
      message:
        "У процедури немає коду CPV, тому немає за чим шукати схожі. Порівняння за назвою давало б випадкові збіги.",
    };
  }

  const kind = classifyUnit(subject.unit);
  const perUnit = kind === "measurable" && Boolean(subject.quantity);

  if (kind === "unknown" && !perUnit) {
    return {
      ok: false,
      reason: "no_unit",
      message: subject.unit
        ? `Одиниця виміру «${subject.unit}» невідома, тому не зрозуміло, чи можна ділити суму на кількість. Порівняння не проводиться, щоб не видати безглузде число.`
        : "У процедури різні одиниці виміру в позиціях або їх немає. Ділити суму на суму різнорідних кількостей не має сенсу.",
      details: { unit: subject.unit, quantity: subject.quantity },
    };
  }

  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;
  const half = windowDays * 86_400;
  const from = subject.modified - half;
  // The window is centred on the procedure, but the future holds no procurement:
  // reporting a period that ends in 2028 makes the answer look careless.
  const to = Math.min(subject.modified + half, Math.floor(Date.now() / 1000));

  // Same CPV and the same unit: the two things that make prices comparable.
  const rows = db
    .prepare(
      `${SELECT}
       where t.cpv = ?
         and t.id <> ?
         and t.value_amount > 0
         and t.modified between ? and ?
         and (? = 0 or (t.unit = ? and t.quantity > 0))
         and (? = 1 or t.unit is ?)`,
    )
    .all(
      subject.cpv,
      subject.id,
      from,
      to,
      perUnit ? 1 : 0,
      subject.unit,
      perUnit ? 1 : 0,
      subject.unit,
    ) as Row[];

  const comparables = rows.map((row) => toComparable(row, perUnit));
  const values = comparables
    .map((c) => (perUnit ? c.unitPrice : c.total))
    .filter((v): v is number => typeof v === "number" && v > 0);

  if (values.length < MIN_COMPARABLES) {
    return {
      ok: false,
      reason: "too_few_comparables",
      message: `Знайдено лише ${values.length} схожих закупівель за кодом ${subject.cpv}${perUnit ? ` в одиницях «${subject.unit}»` : ""}. Медіана з такої кількості це не орієнтир, тому порівняння не проводиться. Спробуйте ширше вікно або перевірте, наскільки повний індекс.`,
      details: { cpv: subject.cpv, unit: subject.unit, found: values.length, needed: MIN_COMPARABLES },
    };
  }

  const distribution = describe(values)!;
  // How mixed the CPV group is. A code like «Овочі, фрукти та горіхи» holds both
  // watermelons at 10 UAH a kilo and parsley at 260, and a median across that is
  // a weak reference. Saying so is more useful than a confident number.
  const spread = distribution.max / distribution.min;
  const sorted = [...values].sort((a, b) => a - b);
  const subjectCard = toComparable(subject, perUnit);
  const subjectValue = (perUnit ? subjectCard.unitPrice : subjectCard.total)!;
  const ratio = subjectValue / distribution.median;

  const sampleSize = Math.min(options.sampleSize ?? 5, 20);
  const sample = [...comparables]
    .filter((c) => (perUnit ? c.unitPrice : c.total))
    .sort(
      (a, b) =>
        (perUnit ? a.unitPrice! - b.unitPrice! : a.total - b.total) ||
        (a.tenderID ?? "").localeCompare(b.tenderID ?? ""),
    )
    .filter((_, index, all) =>
      // ends and middle: enough to see the spread without dumping the whole set
      [0, Math.floor(all.length / 4), Math.floor(all.length / 2), Math.floor((all.length * 3) / 4), all.length - 1]
        .slice(0, sampleSize)
        .includes(index),
    );

  return {
    ok: true,
    subject: {
      ...subjectCard,
      cpv: subject.cpv,
      unit: subject.unit,
      status: subject.status,
    },
    mode: perUnit ? "за одиницю" : "за всю закупівлю",
    unit: perUnit ? subject.unit : null,
    cpv: subject.cpv,
    period: { from: fromEpoch(from).slice(0, 10), to: fromEpoch(to).slice(0, 10) },
    distribution,
    position: { ratioToMedian: Number(ratio.toFixed(2)), ...locate(subjectValue, sorted) },
    reading: verdict(ratio),
    sample,
    homogeneity: {
      spread: Number(spread.toFixed(1)),
      quartileRatio: Number((distribution.p75 / distribution.p25).toFixed(2)),
      reliable: spread <= 10,
    },
    caveats: buildCaveats(perUnit, subject, spread),
  };
}

function toComparable(row: Row, perUnit: boolean): Comparable {
  const total = row.value_amount ?? 0;
  return {
    tenderID: row.tender_id,
    title: row.title,
    buyer: row.buyer_name,
    region: row.region,
    date: fromEpoch(row.modified).slice(0, 10),
    total,
    quantity: row.quantity,
    unitPrice: perUnit && row.quantity ? total / row.quantity : null,
  };
}

function buildCaveats(perUnit: boolean, subject: Row, spread: number) {
  const caveats = [];

  if (spread > 10) {
    caveats.push(
      `Група CPV ${subject.cpv} дуже різнорідна: найдорожча закупівля у вибірці дорожча за найдешевшу у ${spread.toFixed(0)} разів. Медіана тут слабкий орієнтир, бо в одному коді лежать різні товари.`,
    );
  }

  caveats.push(
    "Це очікувана вартість процедури, а не остаточна ціна договору: після торгів сума часто інша.",
    "Схожість визначається кодом CPV, тому в вибірку могли потрапити закупівлі з іншою комплектацією.",
  );

  if (perUnit) {
    caveats.push(
      `Порівняння ведеться за ціною однієї одиниці «${subject.unit}». Закупівлі з іншими одиницями виміру до вибірки не входять.`,
    );
  } else {
    caveats.push(
      "Порівнюються загальні суми, бо одиниця виміру описує роботу цілком. Обсяг робіт у різних процедурах може відрізнятись у рази.",
    );
  }

  caveats.push(
    "Відхилення від медіани саме собою не є порушенням. Це причина подивитись уважніше, а не висновок.",
  );
  return caveats;
}
