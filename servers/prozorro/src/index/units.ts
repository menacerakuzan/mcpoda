/**
 * Whether a per-unit price means anything for a given unit of measure.
 *
 * Real data makes the trap obvious: a procedure for «послуга × 1» worth 1,2 млн
 * yields a "unit price" of 1,2 млн. That is not a price per unit, it is the
 * whole contract wearing a disguise, and putting it in the same distribution as
 * «штука × 11» produces a comparison that looks rigorous and is nonsense.
 *
 * So units are split in two. Measurable ones can be compared per unit. Whole
 * ones can only be compared as totals, and the tools say which mode they used.
 */

const MEASURABLE = new Set([
  "штука",
  "штуки",
  "шт",
  "кілограм",
  "кг",
  "тонна",
  "грам",
  "літр",
  "л",
  "метр",
  "м",
  "метр квадратний",
  "м2",
  "кв.м",
  "метр кубічний",
  "м3",
  "куб.м",
  "кілометр",
  "км",
  "гектар",
  "га",
  "пара",
  "упаковка",
  "пачка",
  "рулон",
  "місце",
  "доба",
  "година",
  "кіловат-година",
  "квт·год",
  "гігакалорія",
  "гкал",
]);

/**
 * Units that describe the job as a whole rather than a quantity of something.
 * Kept explicit rather than inferred: an unknown unit is treated as unknown, not
 * quietly assumed to be one or the other.
 */
const WHOLE = new Set([
  "послуга",
  "послуги",
  "робота",
  "роботи",
  "лот",
  "комплект",
  "пакет",
  "об'єкт",
  "обєкт",
  "набір",
  "система",
]);

export type UnitKind = "measurable" | "whole" | "unknown";

export function classifyUnit(unit: string | null | undefined): UnitKind {
  if (!unit) return "unknown";
  const key = unit.trim().toLowerCase().replace(/['’ʼ]/g, "");
  if (MEASURABLE.has(key)) return "measurable";
  if (WHOLE.has(key)) return "whole";
  return "unknown";
}

export type Items = Array<{ quantity?: number; unit?: { name?: string } }>;

/**
 * A procedure gets a comparable unit price only when every item shares one unit.
 * Mixed baskets are left out on purpose: dividing a total by a sum of kilograms
 * and pieces produces a number with no meaning.
 */
export function summariseUnits(items: Items) {
  const units = new Set(
    items.map((item) => item.unit?.name?.trim()).filter((name): name is string => Boolean(name)),
  );

  if (units.size !== 1) {
    return { unit: null, quantity: null, kind: "unknown" as UnitKind };
  }

  const unit = [...units][0]!;
  const quantity = items.reduce((sum, item) => sum + (item.quantity ?? 0), 0);

  return {
    unit,
    quantity: quantity > 0 ? quantity : null,
    kind: classifyUnit(unit),
  };
}
