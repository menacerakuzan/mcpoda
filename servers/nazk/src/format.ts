import {
  declarationType,
  declarationUrl,
  type Declaration,
  type DeclarationBody,
  type DocumentSummary,
} from "./source.js";

/**
 * Projections for declarations, and the place where the constraints from
 * LEGAL.md become code rather than intentions.
 *
 * The register already blanks passport, tax number and the exact address. This
 * file goes one step further and drops what we have no business relaying at all:
 * street-level address fields and the birthdays of family members. Those are
 * published, but publishing them and piping them into an assistant conversation
 * are different acts, and the second one is ours.
 */

/** The source writes these instead of a value when the law keeps it closed. */
const REDACTED = /^\[(Конфіденційна інформація|Не застосовується|Не відомо)\]$/;

export const isRedacted = (value: unknown): boolean =>
  typeof value === "string" && REDACTED.test(value.trim());

const text = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || isRedacted(trimmed)) return null;
  return trimmed;
};

const number = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || isRedacted(value)) return null;
  const parsed = Number(value.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
};

const section = (body: DeclarationBody, step: string): Array<Record<string, unknown>> => {
  const raw = body[step] as { data?: unknown } | undefined;
  const data = raw?.data ?? raw;
  if (Array.isArray(data)) return data as Array<Record<string, unknown>>;
  if (data && typeof data === "object") {
    return Object.values(data as Record<string, unknown>) as Array<
      Record<string, unknown>
    >;
  }
  return [];
};

const object = (body: DeclarationBody, step: string): Record<string, unknown> => {
  const raw = body[step] as { data?: unknown } | undefined;
  const data = raw?.data ?? raw;
  return data && typeof data === "object" && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : {};
};

export function projectSummary(doc: DocumentSummary) {
  const person = object(doc.data ?? {}, "step_1");
  return {
    id: doc.id,
    declarantId: doc.user_declarant_id,
    name: fullName(person),
    year: doc.declaration_year,
    type: declarationType(doc.declaration_type),
    submitted: doc.date,
    position: text(person.workPost),
    agency: text(person.workPlace),
    region: text(person.region),
    url: declarationUrl(doc.id),
  };
}

function fullName(person: Record<string, unknown>) {
  const parts = [person.lastname, person.firstname, person.middlename]
    .map(text)
    .filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}

/**
 * The compact card. Property and income are summarised rather than listed item
 * by item: the question people actually ask is «скільки і чого», and the full
 * record stays one explicit call away.
 */
export function projectDeclaration(doc: Declaration) {
  const body = doc.data ?? {};
  const person = object(body, "step_1");

  const family = section(body, "step_2");
  const realEstate = section(body, "step_3");
  const vehicles = section(body, "step_6");
  const securities = section(body, "step_7");
  const corporate = section(body, "step_8");
  const beneficiary = section(body, "step_9");
  const income = section(body, "step_11");
  const money = section(body, "step_12");
  const liabilities = section(body, "step_13");
  const expenses = section(body, "step_14");

  return {
    id: doc.id,
    declarantId: doc.user_declarant_id,
    declarant: {
      name: fullName(person),
      position: text(person.workPost),
      agency: text(person.workPlace),
      region: text(person.region),
      // The exact address is not relayed even where the register leaves parts of
      // it open: an assistant conversation is not the place for where a person
      // lives.
    },
    year: doc.declaration_year,
    type: declarationType(doc.declaration_type),
    submitted: doc.date,

    income: {
      total: sum(income.map((row) => number(row.sizeIncome))),
      entries: income.length,
      kinds: unique(income.map((row) => text(row.objectType))),
    },
    realEstate: realEstate.map((row) => ({
      kind: text(row.objectType),
      area: number(row.totalArea),
      region: text(row.region),
      acquired: text(row.owningDate),
      cost: number(row.costAssessment) ?? number(row.cost_date_assessment),
    })),
    vehicles: vehicles.map((row) => ({
      kind: text(row.objectType),
      brand: text(row.brand),
      model: text(row.model),
      year: number(row.graduationYear),
      cost: number(row.costDate),
    })),
    corporateRights: corporate.map((row) => ({
      company: text(row.name),
      code: text(row.legalForm) ?? text(row.company_code),
      share: number(row.cost_percent),
    })),
    beneficialOwnership: beneficiary.map((row) => ({
      company: text(row.name),
      code: text(row.company_code),
      country: text(row.country),
    })),
    securities: securities.length,
    money: {
      entries: money.length,
      total: sum(money.map((row) => number(row.sizeAssets))),
    },
    liabilities: {
      entries: liabilities.length,
      total: sum(liabilities.map((row) => number(row.sizeObligation))),
    },
    expenses: expenses.length,

    family: {
      // Relationships only. The register publishes birthdays of relatives,
      // including children; relaying them adds nothing to oversight and would
      // put a minor's date of birth into a chat log.
      members: family.length,
      relations: unique(family.map((row) => text(row.subjectRelation))),
    },

    url: declarationUrl(doc.id),
    disclaimer:
      "Дані з Єдиного державного реєстру декларацій. Розбіжність між доходом і майном це питання, а не факт: оцінку дає НАЗК і суд, а не цей інструмент.",
  };
}

export type Sibling = { id: string; year: number; submitted: string };

/**
 * What changed between two declarations of the same person.
 *
 * The `siblings` list is not optional decoration. A person often files more than
 * one declaration for the same year — the annual one and a corrected version
 * months later — and both carry the same type code. One real declarant had 175
 * property objects in the later 2024 filing and 22 in the earlier one. Compare
 * the wrong pair and the tool reports that someone lost 150 properties, which is
 * the most damaging sentence this server could possibly produce.
 */
export function compareDeclarations(
  older: Declaration,
  newer: Declaration,
  siblings: Sibling[] = [],
) {
  const a = projectDeclaration(older);
  const b = projectDeclaration(newer);

  if (a.declarantId !== b.declarantId) {
    return {
      error: "different_people",
      message:
        "Це декларації різних осіб. Порівнювати можна лише декларації одного декларанта: інакше вийде порівняння двох незнайомих людей.",
    };
  }

  const warnings = supersessionWarnings(a, b, siblings);

  return {
    declarant: b.declarant.name,
    from: { year: a.year, type: a.type, id: a.id, submitted: a.submitted },
    to: { year: b.year, type: b.type, id: b.id, submitted: b.submitted },
    warnings,
    income: delta(a.income.total, b.income.total),
    money: delta(a.money.total, b.money.total),
    liabilities: delta(a.liabilities.total, b.liabilities.total),
    realEstate: {
      before: a.realEstate.length,
      after: b.realEstate.length,
      appeared: missingFrom(a.realEstate, b.realEstate, realEstateKey),
      disappeared: missingFrom(b.realEstate, a.realEstate, realEstateKey),
    },
    vehicles: {
      before: a.vehicles.length,
      after: b.vehicles.length,
      appeared: missingFrom(a.vehicles, b.vehicles, vehicleKey),
      disappeared: missingFrom(b.vehicles, a.vehicles, vehicleKey),
    },
    corporateRights: {
      before: a.corporateRights.length,
      after: b.corporateRights.length,
    },
    caveats: [
      "Зникнення обʼєкта з декларації не означає його приховування: майно продають, дарують і переоформлюють.",
      "Якщо у списку warnings щось є, спершу перекажіть це людині: порівняння могло взяти не ту пару документів.",
      "Поява обʼєкта не означає нічого сама собою, доки не зіставлена з доходами за той самий період.",
      "Різні типи декларацій охоплюють різні періоди, тому порівнюйте однакові типи, якщо це можливо.",
    ],
    disclaimer: b.disclaimer,
  };
}

/**
 * Flags the two ways a comparison quietly compares the wrong things: taking a
 * filing that a later one has replaced, or putting two documents of the same
 * year side by side as if they were different periods.
 */
function supersessionWarnings(
  a: { id: string; year: number },
  b: { id: string; year: number },
  siblings: Sibling[],
) {
  const warnings: string[] = [];

  if (a.year === b.year) {
    warnings.push(
      `Обидві декларації за ${a.year} рік. Це не зміна за період, а різниця між двома документами одного року: пізніший зазвичай уточнює ранішній. Різниця тут не означає, що щось зникло.`,
    );
  }

  for (const [role, doc] of [
    ["раніша", a],
    ["пізніша", b],
  ] as const) {
    const sameYear = siblings.filter((s) => s.year === doc.year);
    if (sameYear.length < 2) continue;

    const latest = [...sameYear].sort((x, y) => y.submitted.localeCompare(x.submitted))[0]!;
    if (latest.id !== doc.id) {
      warnings.push(
        `За ${doc.year} рік ця особа подала ${sameYear.length} декларації, і ${role} з обраних не є останньою. Остання подана ${latest.submitted.slice(0, 10)} (id ${latest.id}) і саме вона є чинною версією.`,
      );
    }
  }

  return warnings;
}

const realEstateKey = (row: { kind: string | null; area: number | null; region: string | null }) =>
  [row.kind, row.area, row.region].join("|");

const vehicleKey = (row: { brand: string | null; model: string | null; year: number | null }) =>
  [row.brand, row.model, row.year].join("|");

function missingFrom<T>(from: T[], to: T[], key: (row: T) => string) {
  const known = new Set(from.map(key));
  return to.filter((row) => !known.has(key(row)));
}

function delta(before: number | null, after: number | null) {
  if (before === null || after === null) return { before, after, change: null };
  return { before, after, change: Number((after - before).toFixed(2)) };
}

const sum = (values: Array<number | null>) => {
  const clean = values.filter((v): v is number => v !== null);
  return clean.length ? Number(clean.reduce((a, b) => a + b, 0).toFixed(2)) : null;
};

const unique = (values: Array<string | null>) => [
  ...new Set(values.filter((v): v is string => Boolean(v))),
];

export function asJsonContent(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}
