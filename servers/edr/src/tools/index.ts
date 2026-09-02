import { z } from "zod";
import { existsSync } from "node:fs";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { databasePath, openDatabase, SchemaMismatch } from "../db.js";
import { getCompany, searchCompanies, sharedPeople } from "../queries.js";
import { asJsonContent } from "../format.js";

const SOURCE_NOTE =
  "Джерело: Єдиний державний реєстр юридичних осіб (data.gov.ua), локальний індекс. Сервер лише читає.";

const SHARED_NAME_CAVEAT =
  "Це збіг за іменем, не за ідентичністю особи: масовий bulk-експорт реєстру не містить " +
  "стабільного ідентифікатора фізособи. Однофамільці без жодного стосунку одне до одного " +
  "дадуть той самий збіг. Це привід перевірити, а не доведений факт спільного контролю.";

let db: ReturnType<typeof openDatabase> | undefined;
let unavailable: string | null = null;

function getDb() {
  if (unavailable) return null;
  if (!db) {
    // openDatabase() creates a fresh, empty file when none exists — fine for
    // the CLI, wrong here: a deployment with no index built yet must say so
    // instead of silently answering not_found from an empty database.
    if (!existsSync(databasePath())) {
      unavailable = "Індекс ЄДР ще не побудований: див. README.md, npm run import.";
      return null;
    }
    try {
      db = openDatabase();
    } catch (error) {
      unavailable =
        error instanceof SchemaMismatch
          ? error.message
          : `Індекс ЄДР недоступний: ${error instanceof Error ? error.message : error}`;
      return null;
    }
  }
  return db;
}

export function registerTools(server: McpServer) {
  server.registerTool(
    "proyav_edr_company",
    {
      title: "Картка компанії з ЄДР",
      description: [
        "Назва, стан діяльності та повний список пов'язаних людей (засновники,",
        "керівники/підписанти, кінцеві бенефіціарні власники, члени керівних органів)",
        "однієї юридичної особи за кодом ЄДРПОУ.",
        "",
        "Працює по локальному тижневому індексу: якщо компанії немає у відповіді,",
        "це може означати або що індекс не будувався, або що компанія відсутня",
        "у вивантаженні (наприклад щойно зареєстрована).",
      ].join("\n"),
      inputSchema: {
        edrpou: z.string().min(8).max(10).describe("Код ЄДРПОУ юридичної особи."),
      },
    },
    async ({ edrpou }) => {
      const database = getDb();
      if (!database) {
        return asJsonContent({ error: "index_unavailable", message: unavailable });
      }
      const company = getCompany(database, edrpou);
      if (!company) {
        return asJsonContent({ error: "not_found", edrpou, source: SOURCE_NOTE });
      }
      return asJsonContent({ ...company, source: SOURCE_NOTE });
    },
  );

  server.registerTool(
    "proyav_edr_search",
    {
      title: "Пошук компанії за назвою",
      description: [
        "Знаходить компанії за назвою, коли коду ЄДРПОУ немає. Саме з цього починається",
        "більшість запитів: людина знає «Діск-Південь», а не 36611683.",
        "",
        "Враховує українську морфологію: «ромашка» знаходить «РОМАШКИ» і «РОМАШЦІ».",
        "Шукає і за повною назвою, і за скороченою.",
        "",
        "Повертає компактні картки. Щоб побачити засновників і керівників, візьміть",
        "edrpou з результату і викличте proyav_edr_company.",
        "",
        "Назви в реєстрі не унікальні: «ТОВ РОМАШКА» може бути кілька десятків по країні.",
        "Перш ніж казати щось про конкретну компанію, звіряйте код ЄДРПОУ.",
      ].join("\n"),
      inputSchema: {
        query: z.string().min(2).describe("Назва або її частина, наприклад «Діск-Південь»."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Скільки карток повернути. За замовчуванням 20."),
      },
    },
    async ({ query, limit }) => {
      const database = getDb();
      if (!database) {
        return asJsonContent({ error: "index_unavailable", message: unavailable });
      }

      const results = searchCompanies(database, query, limit ?? 20);
      return asJsonContent({
        query,
        returned: results.length,
        results,
        note:
          results.length > 1
            ? "Назви в реєстрі не унікальні. Звіряйте код ЄДРПОУ, перш ніж робити висновок про конкретну компанію."
            : undefined,
        source: SOURCE_NOTE,
      });
    },
  );

  server.registerTool(
    "proyav_edr_shared_people",
    {
      title: "Спільні особи між двома компаніями",
      description: [
        "Порівнює дві юридичні особи за ЄДРПОУ і показує людей, чиї імена збігаються",
        "серед засновників, керівників/підписантів, бенефіціарів чи членів керівних",
        "органів обох компаній.",
        "",
        "Корисно разом із proyav_check_tender із серверу Prozorro: якщо два учасники",
        "одного тендеру мають спільного засновника чи керівника, це той самий тип",
        "сигналу, що й збіг телефону чи адреси — привід придивитись, не звинувачення.",
      ].join("\n"),
      inputSchema: {
        edrpouA: z.string().min(8).max(10).describe("ЄДРПОУ першої компанії."),
        edrpouB: z.string().min(8).max(10).describe("ЄДРПОУ другої компанії."),
      },
    },
    async ({ edrpouA, edrpouB }) => {
      const database = getDb();
      if (!database) {
        return asJsonContent({ error: "index_unavailable", message: unavailable });
      }
      const companyA = getCompany(database, edrpouA);
      const companyB = getCompany(database, edrpouB);
      if (!companyA || !companyB) {
        return asJsonContent({
          error: "not_found",
          missing: [!companyA ? edrpouA : null, !companyB ? edrpouB : null].filter(Boolean),
          source: SOURCE_NOTE,
        });
      }

      const matches = sharedPeople(database, edrpouA, edrpouB);
      return asJsonContent({
        companyA: { edrpou: companyA.edrpou, name: companyA.name },
        companyB: { edrpou: companyB.edrpou, name: companyB.name },
        matches,
        caveat: matches.length > 0 ? SHARED_NAME_CAVEAT : undefined,
        source: SOURCE_NOTE,
      });
    },
  );
}
