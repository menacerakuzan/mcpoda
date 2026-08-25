import type { Tender } from "../sources/cdb.js";
import { tenderWebUrl } from "../sources/cdb.js";
import { money } from "../format.js";
import {
  describeCompetition,
  findSignals,
  type Bidder,
  type Signal,
} from "./connections.js";

/**
 * The tender check: everything the open data can say about one procedure,
 * gathered in one answer.
 *
 * Two facts about Prozorro shape this completely, and both were found by reading
 * real records rather than documentation. Bidders are not published while
 * bidding is open — they appear only once qualification starts, which is the
 * point of hiding them. And three quarters of all procedures are `reporting`:
 * a contract signed directly and reported afterwards, with no bidding at all.
 *
 * So the check refuses more often than it reports, and each refusal says which
 * of those two walls it hit.
 */

/** Procedure types where bidders compete at all. */
const COMPETITIVE = new Set([
  "aboveThreshold",
  "aboveThresholdUA",
  "aboveThresholdEU",
  "belowThreshold",
  "priceQuotation",
  "requestForProposal",
  "competitiveOrdering",
  "competitiveDialogue",
  "esco",
]);

/** Bidders stay hidden until the procedure reaches qualification. */
const DISCLOSED_FROM = new Set([
  "active.qualification",
  "active.awarded",
  "complete",
  "cancelled",
  "unsuccessful",
]);

export type CheckResult = {
  tenderID: string | null;
  title: string | null;
  status: string | null;
  procedure: string | null;
  buyer: { name?: string; edrpou?: string; region?: string } | null;
  expectedValue: string | null;
  winner: { name: string | null; edrpou: string | null; amount: string | null } | null;
  competition: ReturnType<typeof describeCompetition> | null;
  participants: Array<{
    name: string | null;
    edrpou: string | null;
    amount: string | null;
    submittedAt: string | null;
    status: string | null;
  }>;
  signals: Signal[];
  /** Why a part of the check could not run. Empty when everything was possible. */
  limitations: string[];
  whatThisIsNot: string;
  url: string | undefined;
};

export function checkTender(tender: Tender): CheckResult {
  const method = tender.procurementMethodType ?? null;
  const status = tender.status ?? null;
  const limitations: string[] = [];

  const bidders = extractBidders(tender);
  const competitive = method ? COMPETITIVE.has(method) : false;
  const disclosed = status ? DISCLOSED_FROM.has(status) : false;

  if (!competitive) {
    limitations.push(
      method === "reporting"
        ? "Це звіт про укладений договір, а не торги: замовник уклав договір напряму і повідомив про це. Учасників тут немає за визначенням, тому перевіряти зв'язки нема між ким. Таких процедур у Prozorro близько трьох чвертей."
        : `Тип процедури «${method ?? "невідомий"}» не передбачає змагання учасників, тому перевірка зв'язків не застосовна.`,
    );
  } else if (!disclosed) {
    limitations.push(
      `Процедура у статусі «${status}»: учасників ще не розкрито. Prozorro приховує їх, доки триває подання пропозицій, саме щоб ускладнити змову. Поверніться після визначення переможця.`,
    );
  } else if (bidders.length === 0) {
    limitations.push(
      "Учасників у записі немає, хоча процедура конкурентна і вже мала б їх розкрити. Можливо, торги не відбулися.",
    );
  }

  const winner = extractWinner(tender);
  const canCompare = bidders.length >= 2;

  if (competitive && disclosed && bidders.length === 1) {
    limitations.push(
      "Учасник лише один, тому порівнювати нема кого. Це не порушення, але й конкуренції не було.",
    );
  }

  return {
    tenderID: tender.tenderID ?? null,
    title: tender.title?.trim() ?? null,
    status,
    procedure: method,
    buyer: extractBuyer(tender),
    expectedValue: money(tender.value),
    winner,
    competition: bidders.length
      ? describeCompetition(bidders, tender.value?.amount ?? null, winnerAmount(tender))
      : null,
    participants: bidders.map((b) => ({
      name: b.name,
      edrpou: b.edrpou,
      amount: b.amount ? money({ amount: b.amount, currency: "UAH" }) : null,
      submittedAt: b.submittedAt,
      status: b.status,
    })),
    signals: canCompare ? findSignals(bidders) : [],
    limitations,
    whatThisIsNot:
      "Це не висновок про порушення. Кожен знайдений збіг має буденне пояснення, яке наведено поруч. Перевірка показує, куди подивитись людині, і нічого більше.",
    url: tender.tenderID ? tenderWebUrl(tender.tenderID) : undefined,
  };
}

type RawBid = {
  status?: string;
  date?: string;
  value?: { amount?: number };
  tenderers?: Array<{
    name?: string;
    identifier?: { id?: string; legalName?: string };
    contactPoint?: { name?: string; telephone?: string; email?: string };
    address?: { locality?: string; streetAddress?: string; postalCode?: string };
  }>;
};

function extractBidders(tender: Tender): Bidder[] {
  const bids = (tender.bids as RawBid[] | undefined) ?? [];

  return bids.map((bid) => {
    const party = bid.tenderers?.[0];
    const address = [party?.address?.locality, party?.address?.streetAddress]
      .filter(Boolean)
      .join(", ");

    return {
      edrpou: party?.identifier?.id ?? null,
      name: party?.name ?? party?.identifier?.legalName ?? null,
      phone: party?.contactPoint?.telephone ?? null,
      email: party?.contactPoint?.email ?? null,
      address: address || null,
      contactName: party?.contactPoint?.name ?? null,
      submittedAt: bid.date ?? null,
      amount: bid.value?.amount ?? null,
      status: bid.status ?? null,
    };
  });
}

function extractBuyer(tender: Tender) {
  const entity = tender.procuringEntity as
    | {
        name?: string;
        identifier?: { id?: string };
        address?: { region?: string };
      }
    | undefined;
  if (!entity) return null;
  return {
    name: entity.name,
    edrpou: entity.identifier?.id,
    region: entity.address?.region,
  };
}

type RawAward = {
  status?: string;
  value?: { amount?: number; currency?: string };
  suppliers?: Array<{ name?: string; identifier?: { id?: string; legalName?: string } }>;
};

function activeAward(tender: Tender): RawAward | undefined {
  return ((tender.awards as RawAward[] | undefined) ?? []).find(
    (award) => award.status === "active",
  );
}

function extractWinner(tender: Tender) {
  const award = activeAward(tender);
  const supplier = award?.suppliers?.[0];
  if (!supplier) return null;

  return {
    name: supplier.name ?? supplier.identifier?.legalName ?? null,
    edrpou: supplier.identifier?.id ?? null,
    amount: money(award?.value),
  };
}

function winnerAmount(tender: Tender) {
  return activeAward(tender)?.value?.amount ?? null;
}
