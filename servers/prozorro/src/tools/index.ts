import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { asJsonContent, projectHit, projectTender } from "../format.js";
import { SourceError } from "../http.js";
import { fetchFeedPage, fetchTender, tenderWebUrl } from "../sources/cdb.js";
import { searchTenders, TENDER_STATUSES } from "../sources/search.js";

const SOURCE_NOTE =
  "Джерело: відкриті дані Prozorro. Сервер лише читає, нічого не змінює в реєстрі.";

/**
 * A failing source is information, not a crash: the assistant can retry, narrow
 * the query or tell the person what went wrong. Throwing would only surface as
 * an opaque transport error.
 */
async function guard<T>(run: () => Promise<T>) {
  try {
    return await run();
  } catch (error) {
    const isSource = error instanceof SourceError;
    return asJsonContent({
      error: isSource ? `source_${error.status}` : "unexpected",
      message: error instanceof Error ? error.message : String(error),
      hint: isSource && error.status === 429
        ? "Джерело обмежує частоту. Зачекайте кілька секунд і повторіть запит."
        : undefined,
    });
  }
}

export function registerTools(server: McpServer) {
  server.registerTool(
    "proyav_search_tenders",
    {
      title: "Пошук закупівель",
      description: [
        "Повнотекстовий пошук по закупівлях Prozorro. Основний спосіб знайти процедури за словами:",
        "предметом, назвою замовника, номером UA-… тощо.",
        "",
        "Повертає компактні картки (номер, назва, сума, статус, замовник, регіон), а не повні записи.",
        "Щоб отримати склад позицій, учасників і переможця, візьміть tenderID і викличте proyav_get_tender.",
        "",
        "Обмеження джерела: пошук бачить максимум 10 000 збігів на запит, тому для широких тем звужуйте",
        "запит словами або статусом, а не гортайте сторінки до кінця.",
        "Фільтр за регіоном застосовується вже до отриманої сторінки, тож при вузькому регіоні",
        "збільшуйте perPage або уточнюйте текст запиту.",
      ].join("\n"),
      inputSchema: {
        text: z
          .string()
          .min(1)
          .describe("Пошуковий запит українською. Не може бути порожнім."),
        status: z
          .array(z.enum(TENDER_STATUSES))
          .optional()
          .describe(
            "Статуси процедур. active.tendering — приймають пропозиції, complete — завершені, cancelled — скасовані.",
          ),
        region: z
          .string()
          .optional()
          .describe(
            "Назва області для фільтрації, наприклад «Одеська область». Порівняння без урахування регістру.",
          ),
        minValue: z.number().optional().describe("Мінімальна очікувана вартість, грн."),
        maxValue: z.number().optional().describe("Максимальна очікувана вартість, грн."),
        page: z.number().int().min(1).optional().describe("Сторінка, від 1."),
        perPage: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Розмір сторінки, максимум 100."),
      },
    },
    async ({ text, status, region, minValue, maxValue, page, perPage }) =>
      guard(async () => {
      const response = await searchTenders({ text, status, page, perPage });

      let hits = response.data.map(projectHit);
      const beforeFilters = hits.length;

      if (region) {
        const needle = region.toLowerCase();
        hits = hits.filter((h) => h.buyer.region?.toLowerCase().includes(needle));
      }
      if (minValue !== undefined || maxValue !== undefined) {
        hits = hits.filter((h, i) => {
          const amount = response.data[i]?.value?.amount;
          if (amount === undefined) return false;
          if (minValue !== undefined && amount < minValue) return false;
          if (maxValue !== undefined && amount > maxValue) return false;
          return true;
        });
      }

      return asJsonContent({
        query: { text, status, region, minValue, maxValue },
        page: response.page,
        perPage: response.per_page,
        totalMatches: response.total,
        returned: hits.length,
        filteredOutOnThisPage: beforeFilters - hits.length,
        results: hits,
        source: SOURCE_NOTE,
        });
      }),
  );

  server.registerTool(
    "proyav_get_tender",
    {
      title: "Картка закупівлі",
      description: [
        "Повна інформація про одну процедуру: предмет, позиції, очікувана вартість, учасники,",
        "їхні цінові пропозиції та переможець.",
        "",
        "Приймає або внутрішній ідентифікатор CDB (32 шістнадцяткові символи), або номер вигляду",
        "UA-2026-08-25-011022-a. У другому випадку сервер спершу знаходить процедуру у стрічці змін,",
        "що займає кілька секунд і може не спрацювати для давно незмінюваних процедур.",
        "",
        "За замовчуванням повертає вижимку. full=true віддає сирий запис Prozorro цілком:",
        "це десятки кілобайт, беріть його лише коли вижимки справді бракує.",
      ].join("\n"),
      inputSchema: {
        id: z
          .string()
          .min(4)
          .describe("Ідентифікатор CDB або номер процедури UA-РРРР-ММ-ДД-NNNNNN-a."),
        full: z
          .boolean()
          .optional()
          .describe("Повернути сирий запис замість вижимки. За замовчуванням false."),
      },
    },
    async ({ id, full }) =>
      guard(async () => {
      const uuid = /^[0-9a-f]{32}$/i.test(id) ? id : await resolveTenderId(id);

      if (!uuid) {
        return asJsonContent({
          error: "not_found",
          message: [
            `Не вдалося знайти процедуру ${id} у стрічці змін за розумний час.`,
            "Стрічка впорядкована за датою останньої зміни, тому давні процедури можуть лежати далеко",
            "від дати свого створення. Спробуйте proyav_search_tenders, щоб перевірити номер,",
            "або відкрийте сторінку процедури вручну.",
          ].join(" "),
          webUrl: tenderWebUrl(id),
        });
      }

      const tender = await fetchTender(uuid);
        return asJsonContent(
          full
            ? { raw: tender, source: SOURCE_NOTE }
            : { ...projectTender(tender), source: SOURCE_NOTE },
        );
      }),
  );

  server.registerTool(
    "proyav_recent_tenders",
    {
      title: "Останні закупівлі",
      description: [
        "Свіжі зміни у Prozorro в хронологічному порядку, найновіші першими.",
        "Корисно, щоб побачити, що відбувається просто зараз, або зібрати процедури конкретного замовника",
        "за останній час.",
        "",
        "Стрічка віддає лише службові поля: ідентифікатор, номер, статус, тип процедури та замовника.",
        "Назви та суми у стрічці немає — для них потрібен proyav_get_tender по конкретному id.",
      ].join("\n"),
      inputSchema: {
        limit: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .optional()
          .describe("Скільки записів повернути, максимум 1000."),
        edrpou: z
          .string()
          .optional()
          .describe("Код ЄДРПОУ замовника для фільтрації отриманої сторінки."),
        since: z
          .string()
          .optional()
          .describe(
            "Дата у форматі РРРР-ММ-ДД. Стрічка починається з цієї дати і йде вперед у часі.",
          ),
      },
    },
    async ({ limit, edrpou, since }) =>
      guard(async () => {
      const page = await fetchFeedPage({
        limit: limit ?? 100,
        descending: !since,
        offset: since,
      });

      const entries = page.data
        .filter((entry) => !edrpou || entry.procuringEntity?.identifier?.id === edrpou)
        .map((entry) => ({
          id: entry.id,
          tenderID: entry.tenderID,
          status: entry.status,
          procedure: entry.procurementMethodType,
          dateModified: entry.dateModified,
          buyer: {
            name: entry.procuringEntity?.name,
            edrpou: entry.procuringEntity?.identifier?.id,
            region: entry.procuringEntity?.address?.region,
          },
          url: entry.tenderID ? tenderWebUrl(entry.tenderID) : undefined,
        }));

      return asJsonContent({
        order: since ? "від вказаної дати вперед" : "найновіші першими",
        returned: entries.length,
        scanned: page.data.length,
        nextOffset: page.next_page?.offset,
        entries,
        source: SOURCE_NOTE,
        });
      }),
  );
}

/**
 * The search service knows procedures by their UA- number, the central database
 * knows them by an internal uuid, and nothing maps between the two.
 *
 * The feed is a changes feed: every procedure sits at its LAST modification, not
 * at its creation. So we walk it backwards from now and stop as soon as entries
 * predate the day the number was issued, because a procedure cannot have been
 * modified before it existed. That makes the scan cheap for anything still alive
 * and correctly hopeless for a procedure untouched for years, which is exactly
 * the case the local index is meant to solve.
 */
const MAX_SCAN_PAGES = 6;

async function resolveTenderId(tenderID: string): Promise<string | null> {
  // the trailing suffix is lower case in real data ("-a"), so upper-casing the
  // whole number would make every comparison miss
  const wanted = tenderID.trim();
  const match = /^UA-(\d{4}-\d{2}-\d{2})-/i.exec(wanted);
  if (!match) return null;

  const issuedAt = new Date(`${match[1]}T00:00:00Z`).getTime();
  let offset: string | undefined;

  for (let pageIndex = 0; pageIndex < MAX_SCAN_PAGES; pageIndex++) {
    const page = await fetchFeedPage({
      limit: 1000,
      descending: true,
      offset,
      fields: ["tenderID"],
    });

    const hit = page.data.find(
      (entry) => entry.tenderID?.toLowerCase() === wanted.toLowerCase(),
    );
    if (hit) return hit.id;

    const oldest = page.data[page.data.length - 1]?.dateModified;
    if (oldest && new Date(oldest).getTime() < issuedAt) return null;

    if (!page.next_page?.offset || page.data.length === 0) return null;
    offset = page.next_page.offset;
  }

  return null;
}
