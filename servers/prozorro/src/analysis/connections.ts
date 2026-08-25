/**
 * Signals that two bidders in the same procedure may not be independent.
 *
 * Every signal here has an innocent explanation, and the innocent explanation is
 * shipped with it: a shared address is a business centre far more often than a
 * scheme. The tool's job is to say «подивіться на це», and the wording is tested
 * to make sure it never drifts into saying more.
 */

/** Free mail lives on a handful of domains; matching them would flag half the country. */
const PUBLIC_MAIL = new Set([
  "gmail.com",
  "ukr.net",
  "i.ua",
  "meta.ua",
  "bigmir.net",
  "mail.ru",
  "yandex.ru",
  "outlook.com",
  "hotmail.com",
  "yahoo.com",
  "icloud.com",
  "protonmail.com",
  "proton.me",
  "email.ua",
  "online.ua",
  "sisters.com.ua",
]);

export type Bidder = {
  edrpou: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  contactName: string | null;
  submittedAt: string | null;
  amount: number | null;
  status: string | null;
};

export type SignalKind =
  | "shared_phone"
  | "shared_email"
  | "shared_mail_domain"
  | "shared_address"
  | "shared_contact_person"
  | "close_submission";

export type Signal = {
  kind: SignalKind;
  between: [string, string];
  detail: string;
  /** Why this may be perfectly innocent. Always present, never optional. */
  innocent: string;
  weight: number;
};

/** Ukrainian numbers arrive as +380…, 380…, 0… — compare the subscriber part. */
export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 9) return null;
  return digits.slice(-9);
}

export function mailDomain(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  return domain || null;
}

/**
 * Addresses arrive with wildly different punctuation and abbreviations for the
 * same street: «м. Київ, вул. Хрещатик, буд. 22» and «Київ вулиця Хрещатик
 * будинок 22» are one place.
 *
 * The first version stripped those words with a `\b`-anchored regex, which never
 * fired: JavaScript word boundaries are built on ASCII `\w`, so `\bвул\b` matches
 * nothing in Cyrillic. Tokenising sidesteps the whole problem.
 */
const ADDRESS_NOISE = new Set([
  "вул",
  "вулиця",
  "просп",
  "проспект",
  "бул",
  "бульвар",
  "пров",
  "провулок",
  "буд",
  "будинок",
  "кв",
  "квартира",
  "м",
  "місто",
  "с",
  "село",
  "смт",
  "обл",
  "область",
  "р",
  "н",
  "район",
  "офіс",
  "оф",
  "прим",
  "приміщення",
]);

export function normalizeAddress(address: string | null | undefined): string | null {
  if (!address) return null;

  const tokens = address
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token && !ADDRESS_NOISE.has(token));

  const cleaned = tokens.join(" ");
  // too short to mean anything: «київ» alone is not an address match
  return cleaned.length >= 8 && tokens.length >= 2 ? cleaned : null;
}

const label = (bidder: Bidder) =>
  bidder.name?.slice(0, 60) ?? bidder.edrpou ?? "невідомий учасник";

/**
 * Chosen by measurement, not by feel. Across 205 pairs of bids in 54 real
 * competitive procedures the median gap was about seventeen hours, and only
 * 1,5% of pairs landed within fifteen minutes of each other. So this window is
 * genuinely uncommon — which also means it is not, on its own, evidence.
 *
 * The first draft of this file assumed bidders cluster at the deadline and said
 * so in the explanation. The data said otherwise, and the explanation now
 * carries the measured rate instead of the assumption.
 */
const CLOSE_MINUTES = 15;
const CLOSE_SHARE_NOTE =
  "У вибірці зі справжніх торгів так близько подаються приблизно 1,5% пар учасників, тобто це нечасто, але й не унікально.";

export function findSignals(bidders: Bidder[]): Signal[] {
  const signals: Signal[] = [];

  for (let i = 0; i < bidders.length; i++) {
    for (let j = i + 1; j < bidders.length; j++) {
      const a = bidders[i]!;
      const b = bidders[j]!;
      // the same company bidding twice is a data quirk, not a connection
      if (a.edrpou && b.edrpou && a.edrpou === b.edrpou) continue;

      const pair: [string, string] = [label(a), label(b)];

      const phoneA = normalizePhone(a.phone);
      if (phoneA && phoneA === normalizePhone(b.phone)) {
        signals.push({
          kind: "shared_phone",
          between: pair,
          detail: `Один номер телефону: ${a.phone}`,
          innocent:
            "Спільний номер буває у пов'язаних, але законно окремих фірм, у спільного бухгалтера або тендерного агента, який подає заявки за кількох клієнтів.",
          weight: 3,
        });
      }

      if (a.email && b.email && a.email.trim().toLowerCase() === b.email.trim().toLowerCase()) {
        signals.push({
          kind: "shared_email",
          between: pair,
          detail: `Одна поштова скринька: ${a.email}`,
          innocent:
            "Скриньку може вести спільний представник або консультант, який готує документи для кількох учасників.",
          weight: 3,
        });
      } else {
        const domainA = mailDomain(a.email);
        const domainB = mailDomain(b.email);
        if (domainA && domainA === domainB && !PUBLIC_MAIL.has(domainA)) {
          signals.push({
            kind: "shared_mail_domain",
            between: pair,
            detail: `Пошта в одному домені: ${domainA}`,
            innocent:
              "Власний домен можуть ділити компанії однієї групи, що саме собою законно, або орендарі одного провайдера.",
            weight: 2,
          });
        }
      }

      const addressA = normalizeAddress(a.address);
      if (addressA && addressA === normalizeAddress(b.address)) {
        signals.push({
          kind: "shared_address",
          between: pair,
          detail: `Одна адреса: ${a.address}`,
          innocent:
            "За однією адресою зазвичай стоїть бізнес-центр або будівля з десятками орендарів. Сама по собі спільна адреса не означає нічого.",
          weight: 2,
        });
      }

      if (
        a.contactName &&
        b.contactName &&
        a.contactName.trim().toLowerCase() === b.contactName.trim().toLowerCase()
      ) {
        signals.push({
          kind: "shared_contact_person",
          between: pair,
          detail: `Одна контактна особа: ${a.contactName}`,
          innocent:
            "Та сама людина може бути найманим тендерним фахівцем одразу в кількох компаній.",
          weight: 3,
        });
      }

      if (a.submittedAt && b.submittedAt) {
        const gap = Math.abs(
          new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime(),
        );
        const minutes = gap / 60_000;
        if (minutes <= CLOSE_MINUTES) {
          signals.push({
            kind: "close_submission",
            between: pair,
            detail: `Пропозиції подані з різницею ${minutes < 1 ? "менше хвилини" : `${Math.round(minutes)} хв`}`,
            innocent: `Збіг у часі не показує зв'язку сам собою: люди подаються, коли встигли. ${CLOSE_SHARE_NOTE} Дивіться на цей сигнал лише разом з іншими.`,
            weight: 1,
          });
        }
      }
    }
  }

  return signals;
}

export type Competition = {
  bidders: number;
  singleBidder: boolean;
  /** How far the winning price fell below the expected value, as a share. */
  priceDrop: number | null;
  notes: string[];
};

export function describeCompetition(
  bidders: Bidder[],
  expected: number | null,
  winningAmount: number | null,
): Competition {
  const notes: string[] = [];
  const active = bidders.filter((b) => b.status !== "invalid" && b.status !== "deleted");

  if (active.length === 1) {
    notes.push(
      "Пропозицію подав лише один учасник. Це часто трапляється у вузьких нішах і на малих сумах, але саме тут ціна не проходить перевірку конкуренцією.",
    );
  }

  let priceDrop: number | null = null;
  if (expected && winningAmount && expected > 0) {
    priceDrop = Number((1 - winningAmount / expected).toFixed(4));
    if (priceDrop <= 0.001) {
      notes.push(
        "Ціна переможця збіглася з очікуваною вартістю: торги не збили ціну. Для процедур з одним учасником це звичайна річ.",
      );
    }
  }

  return { bidders: active.length, singleBidder: active.length === 1, priceDrop, notes };
}
