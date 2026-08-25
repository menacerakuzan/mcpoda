import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { asJsonContent, money, projectHit, projectTender } from "../format.js";
import { SourceError } from "../http.js";
import { fetchFeedPage, fetchTender, tenderWebUrl } from "../sources/cdb.js";
import { resolveTenderId } from "../resolve.js";
import { getIndex, indexUnavailableReason } from "../index/access.js";
import { benchmarkTender } from "../index/access.js";
import {
  searchTenders,
  SOURCE_PAGE_SIZE,
  TENDER_STATUSES,
  type SearchHit,
} from "../sources/search.js";

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
      hint:
        isSource && error.status === 429
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
        "Обмеження джерела, які варто мати на увазі:",
        "джерело віддає рівно 20 записів на сторінку і не дозволяє просити більше, тому limit понад 20",
        "сервер набирає, дочитуючи наступні сторінки;",
        "пошук бачить максимум 10 000 збігів на запит, тож широкі теми звужуйте словами або статусом;",
        "region, minValue та maxValue джерело не підтримує, сервер застосовує їх до вже отриманих",
        "записів, тому за вузького фільтра просіть більший limit.",
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
            "Назва області, наприклад «Одеська область». Порівняння без урахування регістру.",
          ),
        minValue: z
          .number()
          .optional()
          .describe("Мінімальна очікувана вартість, грн."),
        maxValue: z
          .number()
          .optional()
          .describe("Максимальна очікувана вартість, грн."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe(
            "Скільки карток повернути після фільтрів. За замовчуванням 20, максимум 100.",
          ),
        page: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe(
            "З якої сторінки джерела починати. Сторінка це 20 записів.",
          ),
      },
    },
    async ({ text, status, region, minValue, maxValue, limit, page }) =>
      guard(async () => {
        const wanted = limit ?? SOURCE_PAGE_SIZE;
        const startPage = page ?? 1;
        const maxRequests = Math.min(
          Math.ceil(wanted / SOURCE_PAGE_SIZE) +
            (region || minValue !== undefined || maxValue !== undefined
              ? 2
              : 0),
          6,
        );

        // keep the raw hit next to its projection: filtering the projections
        // alone would drift the indexes apart from the source records
        let rows: Array<{
          hit: SearchHit;
          card: ReturnType<typeof projectHit>;
        }> = [];
        let received = 0;
        let total = 0;
        let pagesRead = 0;

        for (let i = 0; i < maxRequests && rows.length < wanted; i++) {
          const response = await searchTenders({
            text,
            status,
            page: startPage + i,
          });
          total = response.total;
          pagesRead++;
          received += response.data.length;

          let batch = response.data.map((hit) => ({
            hit,
            card: projectHit(hit),
          }));

          if (region) {
            const needle = region.toLowerCase();
            batch = batch.filter((row) =>
              row.card.buyer.region?.toLowerCase().includes(needle),
            );
          }
          if (minValue !== undefined || maxValue !== undefined) {
            batch = batch.filter(({ hit }) => {
              const amount = hit.value?.amount;
              if (amount === undefined) return false;
              if (minValue !== undefined && amount < minValue) return false;
              if (maxValue !== undefined && amount > maxValue) return false;
              return true;
            });
          }

          rows = rows.concat(batch);
          if (response.data.length < SOURCE_PAGE_SIZE) break;
        }

        const results = rows.slice(0, wanted);

        return asJsonContent({
          query: { text, status, region, minValue, maxValue },
          totalMatches: total,
          returned: results.length,
          scanned: received,
          pagesRead,
          startPage,
          nextPage: startPage + pagesRead,
          results: results.map((row) => row.card),
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
          .describe(
            "Ідентифікатор CDB або номер процедури UA-РРРР-ММ-ДД-NNNNNN-a.",
          ),
        full: z
          .boolean()
          .optional()
          .describe(
            "Повернути сирий запис замість вижимки. За замовчуванням false.",
          ),
      },
    },
    async ({ id, full }) =>
      guard(async () => {
        let uuid: string | null = null;
        let outcome: Awaited<ReturnType<typeof resolveTenderId>> | null = null;

        let resolvedVia = "internal id";

        if (/^[0-9a-f]{32}$/i.test(id)) {
          uuid = id;
        } else {
          // The index turns the hardest lookup in the project into a primary key
          // hit. Without it, the feed scan only reaches procedures touched
          // recently, so an old one is simply unreachable.
          const indexed = getIndex()?.lookup(id);
          if (indexed) {
            uuid = indexed.id;
            resolvedVia = "локальний індекс";
          } else {
            outcome = await resolveTenderId(id);
            if (outcome.found) uuid = outcome.uuid;
            resolvedVia = "сканування стрічки";
          }
        }

        if (!uuid) {
          return asJsonContent({
            error:
              outcome && !outcome.found && outcome.reason === "bad_format"
                ? "bad_format"
                : "not_found",
            message: [
              `Не вдалося знайти процедуру ${id}.`,
              getIndex()
                ? "Її немає ні в локальному індексі, ні у свіжій частині стрічки змін. Можливо, індекс ще не дійшов до цього періоду: перевірте proyav_index_status."
                : "Локального індексу немає, а стрічка змін показує лише нещодавно змінені процедури. Побудуйте індекс, щоб знаходити давні процедури за номером.",
              "Спробуйте proyav_search_tenders, щоб перевірити номер, або відкрийте сторінку процедури вручну.",
            ].join(" "),
            webUrl: tenderWebUrl(id),
          });
        }

        const tender = await fetchTender(uuid);
        return asJsonContent(
          full
            ? { raw: tender, resolvedVia, source: SOURCE_NOTE }
            : { ...projectTender(tender), resolvedVia, source: SOURCE_NOTE },
        );
      }),
  );

  server.registerTool(
    "proyav_search_index",
    {
      title: "Пошук по локальному індексу",
      description: [
        "Пошук по власному індексу на цій машині. Використовуйте його, коли потрібне те,",
        "чого не дає пошук джерела: процедури конкретного замовника за кодом ЄДРПОУ,",
        "фільтр за CPV, за періодом, або коли треба більше ніж 10 000 збігів.",
        "",
        "Пошук враховує українську морфологію: «дорога» знаходить «доріг» і «дорозі».",
        "",
        "Індекс будується двома проходами, і в ньому може бути не все. У відповіді завжди",
        "видно, яка частка процедур уже має назву й суму: якщо вона мала, покладайтесь",
        "на proyav_search_tenders. Стан індексу показує proyav_index_status.",
      ].join("\n"),
      inputSchema: {
        text: z
          .string()
          .optional()
          .describe(
            "Слова для пошуку. Можна не вказувати, якщо є інші фільтри.",
          ),
        status: z.array(z.enum(TENDER_STATUSES)).optional(),
        region: z.string().optional().describe("Частина назви області."),
        buyerEdrpou: z
          .string()
          .optional()
          .describe(
            "Код ЄДРПОУ замовника. Джерело такого фільтра не має взагалі.",
          ),
        cpvPrefix: z
          .string()
          .optional()
          .describe("Початок коду CPV, наприклад 45233 для дорожніх робіт."),
        minValue: z.number().optional(),
        maxValue: z.number().optional(),
        from: z.string().optional().describe("Дата від, РРРР-ММ-ДД."),
        to: z.string().optional().describe("Дата до, РРРР-ММ-ДД."),
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).optional(),
      },
    },
    async (args) =>
      guard(async () => {
        const index = getIndex();
        if (!index) {
          return asJsonContent({
            error: "no_index",
            message: [
              "Локального індексу немає. Він будується окремою командою і живе на цій машині:",
              "npx proyav-prozorro crawl --recent, далі npx proyav-prozorro enrich.",
              "Поки індексу немає, користуйтесь proyav_search_tenders.",
            ].join(" "),
          });
        }

        const result = index.search(args);
        return asJsonContent({
          query: args,
          total: result.total,
          returned: result.rows.length,
          coverage: {
            share: Number(result.enrichedShare.toFixed(3)),
            note:
              result.enrichedShare < 0.5
                ? "Назви та суми має менша частина індексу, тому пошук за словами бачить не все. Для повноти беріть proyav_search_tenders."
                : undefined,
          },
          results: result.rows.map((row) => ({
            tenderID: row.tender_id,
            title: row.title,
            status: row.status,
            value: row.value_amount
              ? money({
                  amount: row.value_amount,
                  currency: row.value_currency ?? "UAH",
                })
              : null,
            cpv: row.cpv,
            buyer: {
              name: row.buyer_name,
              edrpou: row.buyer_edrpou,
              region: row.region,
            },
            dateModified: row.date_modified,
            url: row.tender_id ? tenderWebUrl(row.tender_id) : undefined,
          })),
          source: SOURCE_NOTE,
        });
      }),
  );

  server.registerTool(
    "proyav_price_benchmark",
    {
      title: "Порівняння ціни",
      description: [
        "Порівнює ціну процедури з тим, за скільки схоже купували інші. Це відповідь на питання",
        "«ми не переплачуємо?» у тому вигляді, в якому його ставлять люди.",
        "",
        "Схожими вважаються закупівлі з тим самим кодом CPV і тією самою одиницею виміру.",
        "Одиниця обовʼязкова: кілометр дороги і квадратний метр дороги це різні числа,",
        "і порівняння їх дало б переконливу дурницю.",
        "",
        "Інструмент відмовляється рахувати, коли схожих закупівель менше восьми, коли одиниця",
        "виміру невідома або коли позиції процедури мають різні одиниці. У відповіді завжди видно",
        "вибірку: скільки процедур, за який період, медіана і розкид, а не одне число.",
        "",
        "Відхилення від медіани не є порушенням. Формулюйте це як привід перевірити, а не як висновок.",
      ].join("\n"),
      inputSchema: {
        tenderID: z
          .string()
          .min(4)
          .describe("Номер процедури вигляду UA-2026-08-25-011022-a."),
        windowDays: z
          .number()
          .int()
          .min(30)
          .max(2000)
          .optional()
          .describe("Скільки днів навколо процедури брати у вибірку. За замовчуванням 550."),
        sampleSize: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .describe("Скільки прикладів схожих закупівель показати."),
      },
    },
    async ({ tenderID, windowDays, sampleSize }) =>
      guard(async () => {
        const result = benchmarkTender({ tenderID, windowDays, sampleSize });
        if (!result) {
          return asJsonContent({
            error: "no_index",
            message:
              "Порівняння цін працює лише по локальному індексу, а його немає. Побудувати: npx proyav-prozorro crawl --recent, далі npx proyav-prozorro enrich.",
          });
        }
        return asJsonContent({ ...result, source: SOURCE_NOTE });
      }),
  );

  server.registerTool(
    "proyav_index_status",
    {
      title: "Стан локального індексу",
      description: [
        "Скільки процедур в індексі, скільки з них мають назву й суму, і за який період",
        "він уже зібраний. Викликайте, коли пошук по індексу повертає підозріло мало:",
        "відповідь покаже, чи це справді порожньо, чи індекс просто ще не дійшов.",
      ].join("\n"),
      inputSchema: {},
    },
    async () =>
      guard(async () => {
        const index = getIndex();
        if (!index) {
          return asJsonContent({
            present: false,
            message:
              indexUnavailableReason() ??
              "Індексу немає. Побудувати: npx proyav-prozorro crawl --recent, далі npx proyav-prozorro enrich.",
          });
        }

        const stats = index.stats();
        return asJsonContent({
          present: true,
          path: index.path,
          tenders: stats.tenders,
          buyers: stats.buyers,
          withTitleAndValue: stats.enriched,
          coverage: stats.tenders
            ? Number((stats.enriched / stats.tenders).toFixed(3))
            : 0,
          period: { oldest: stats.oldest, newest: stats.newest },
          progress: {
            history: stats.historyCursorDate,
            recent: stats.recentCursorDate,
          },
          updatedAt: stats.updatedAt,
        });
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
          .filter(
            (entry) =>
              !edrpou || entry.procuringEntity?.identifier?.id === edrpou,
          )
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
