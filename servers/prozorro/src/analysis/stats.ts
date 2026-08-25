/**
 * Procurement prices are heavily skewed: one contract at fifty times the going
 * rate drags a mean somewhere no actual procedure ever was. So everything here
 * is built on order statistics — median and quartiles — which say what the
 * middle of the market really looked like.
 */

export type Distribution = {
  count: number;
  min: number;
  p25: number;
  median: number;
  p75: number;
  max: number;
};

/** Linear interpolation between order statistics, the same rule as R type 7. */
export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return Number.NaN;
  if (sorted.length === 1) return sorted[0]!;

  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;

  const weight = position - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

export function describe(values: number[]): Distribution | null {
  const clean = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (clean.length === 0) return null;

  return {
    count: clean.length,
    min: clean[0]!,
    p25: quantile(clean, 0.25),
    median: quantile(clean, 0.5),
    p75: quantile(clean, 0.75),
    max: clean[clean.length - 1]!,
  };
}

/**
 * Where a single price sits in the distribution, expressed the way a person
 * would ask it: how many times the going rate, and how many procedures were
 * cheaper.
 */
export function locate(value: number, sorted: number[]) {
  const cheaper = sorted.filter((v) => v < value).length;
  return {
    percentile: Math.round((cheaper / sorted.length) * 100),
    cheaperCount: cheaper,
    dearerCount: sorted.length - cheaper,
  };
}

/**
 * A verdict has to stay a description, not an accusation. Being above the median
 * is ordinary — half of every market is. Only a wide gap is worth a person's
 * attention, and even then the wording says «варто перевірити», never «завищено».
 */
export function verdict(ratioToMedian: number) {
  if (ratioToMedian >= 2)
    return {
      level: "варто перевірити",
      note: "Ціна вдвічі або більше вища за медіану схожих закупівель. Це може мати законне пояснення: інша комплектація, терміновість, віддалена локація. Але це привід подивитись уважніше.",
    };
  if (ratioToMedian >= 1.4)
    return {
      level: "вище за середину ринку",
      note: "Помітно вище за медіану, але в межах, які часто пояснюються умовами постачання.",
    };
  if (ratioToMedian <= 0.5)
    return {
      level: "помітно нижче",
      note: "Суттєво дешевше за медіану. Іноді це вигідна закупівля, іноді ознака заниженої якості або неповної комплектації.",
    };
  return {
    level: "у межах ринку",
    note: "Ціна не виділяється серед схожих закупівель.",
  };
}
