import type { SearchHit } from "./sources/search.js";
import { tenderWebUrl, type Tender } from "./sources/cdb.js";

export function money(value?: { amount?: number; currency?: string }) {
  if (!value?.amount && value?.amount !== 0) return null;
  const amount = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 2 }).format(
    value.amount,
  );
  return `${amount} ${value.currency ?? "UAH"}`;
}

/**
 * Search results carry only what the assistant needs to decide which procedure
 * to open. Everything heavier is one explicit call away, which is what keeps a
 * result set of a hundred tenders from eating the whole context window.
 */
export function projectHit(hit: SearchHit) {
  return {
    tenderID: hit.tenderID,
    title: hit.title?.trim(),
    status: hit.status,
    value: money(hit.value),
    buyer: {
      name: hit.procuringEntity?.name ?? hit.procuringEntity?.identifier?.legalName,
      edrpou: hit.procuringEntity?.identifier?.id,
      region: hit.procuringEntity?.address?.region,
      locality: hit.procuringEntity?.address?.locality,
    },
    url: hit.tenderID ? tenderWebUrl(hit.tenderID) : undefined,
  };
}

type Award = {
  status?: string;
  value?: { amount?: number; currency?: string };
  date?: string;
  suppliers?: Array<{ name?: string; identifier?: { id?: string; legalName?: string } }>;
};

type Bid = {
  status?: string;
  value?: { amount?: number; currency?: string };
  tenderers?: Array<{ name?: string; identifier?: { id?: string } }>;
};

type Item = {
  description?: string;
  quantity?: number;
  unit?: { name?: string };
  classification?: { id?: string; description?: string };
};

/**
 * The compact card: what the procedure is, who runs it, what it costs, who bid
 * and who won. Counts are given for the parts left out so the assistant can see
 * that more exists and ask for the raw record when it actually needs it.
 */
export function projectTender(tender: Tender) {
  const items = (tender.items as Item[] | undefined) ?? [];
  const awards = (tender.awards as Award[] | undefined) ?? [];
  const bids = (tender.bids as Bid[] | undefined) ?? [];
  const contracts = (tender.contracts as Array<Record<string, unknown>> | undefined) ?? [];

  const winners = awards
    .filter((a) => a.status === "active")
    .flatMap((a) =>
      (a.suppliers ?? []).map((s) => ({
        name: s.name ?? s.identifier?.legalName,
        edrpou: s.identifier?.id,
        amount: money(a.value),
        date: a.date,
      })),
    );

  return {
    id: tender.id,
    tenderID: tender.tenderID,
    title: tender.title?.trim(),
    description: tender.description?.trim()?.slice(0, 600),
    status: tender.status,
    procedure: tender.procurementMethodType,
    expectedValue: money(tender.value),
    period: {
      start: tender.tenderPeriod?.startDate,
      end: tender.tenderPeriod?.endDate,
    },
    buyer: projectEntity(tender.procuringEntity),
    classification: items[0]?.classification
      ? { cpv: items[0].classification.id, description: items[0].classification.description }
      : undefined,
    items: items.slice(0, 10).map((item) => ({
      description: item.description?.trim()?.slice(0, 200),
      quantity: item.quantity,
      unit: item.unit?.name,
      cpv: item.classification?.id,
    })),
    bids: bids.map((bid) => ({
      status: bid.status,
      amount: money(bid.value),
      tenderer: bid.tenderers?.[0]?.name,
      edrpou: bid.tenderers?.[0]?.identifier?.id,
    })),
    winners,
    counts: {
      items: items.length,
      bids: bids.length,
      awards: awards.length,
      contracts: contracts.length,
      documents: (tender.documents as unknown[] | undefined)?.length ?? 0,
      cancellations: (tender.cancellations as unknown[] | undefined)?.length ?? 0,
    },
    dateModified: tender.dateModified,
    url: tender.tenderID ? tenderWebUrl(tender.tenderID) : undefined,
    note:
      items.length > 10
        ? `Показано 10 позицій з ${items.length}. Повний запис: той самий виклик з full=true.`
        : undefined,
  };
}

function projectEntity(entity: unknown) {
  if (!entity || typeof entity !== "object") return undefined;
  const e = entity as {
    name?: string;
    kind?: string;
    identifier?: { id?: string; legalName?: string };
    address?: { region?: string; locality?: string; streetAddress?: string };
  };
  return {
    name: e.name ?? e.identifier?.legalName,
    edrpou: e.identifier?.id,
    kind: e.kind,
    region: e.address?.region,
    locality: e.address?.locality,
  };
}

/** Tool results travel as text, so everything is serialised in one place. */
export function asJsonContent(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}
