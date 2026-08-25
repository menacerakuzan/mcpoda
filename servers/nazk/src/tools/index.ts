import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SourceError } from "../http.js";
import {
  asJsonContent,
  compareDeclarations,
  projectDeclaration,
  projectSummary,
} from "../format.js";
import { fetchDocument, searchDocuments } from "../source.js";

const SOURCE_NOTE =
  "Джерело: Єдиний державний реєстр декларацій НАЗК. Сервер лише читає і нічого не додає до опублікованого.";

async function guard<T>(run: () => Promise<T>) {
  try {
    return await run();
  } catch (error) {
    const isSource = error instanceof SourceError;
    return asJsonContent({
      error: isSource ? `source_${error.status}` : "unexpected",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export function registerTools(server: McpServer) {
  server.registerTool(
    "proyav_search_declarations",
    {
      title: "Пошук декларацій",
      description: [
        "Пошук у Єдиному державному реєстрі декларацій за прізвищем, роком або типом.",
        "",
        "Повертає компактні картки: хто, яка посада, який орган, за який рік. Щоб побачити",
        "майно, доходи та корпоративні права, візьміть id і викличте proyav_get_declaration.",
        "",
        "Обмеження джерела: видача бачить максимум 10 000 документів на запит, тому широкі",
        "запити звужуйте прізвищем або роком.",
        "",
        "Однофамільців у реєстрі багато. Перш ніж казати людині щось про конкретну особу,",
        "переконайтесь, що посада і орган збігаються з тим, кого шукали.",
      ].join("\n"),
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe("Прізвище або частина ПІБ. Наприклад «Петренко»."),
        year: z
          .number()
          .int()
          .min(2015)
          .max(2100)
          .optional()
          .describe("Рік декларації."),
        type: z
          .number()
          .int()
          .min(1)
          .max(5)
          .optional()
          .describe(
            "Тип: 1 щорічна, 2 перед звільненням, 3 після звільнення, 4 кандидата.",
          ),
        page: z.number().int().min(1).optional().describe("Сторінка, від 1."),
      },
    },
    async ({ query, year, type, page }) =>
      guard(async () => {
        const response = await searchDocuments({ query, year, type, page });
        return asJsonContent({
          query: { query, year, type },
          totalMatches: response.count,
          returned: response.data.length,
          notice: response.notice,
          results: response.data.map(projectSummary),
          source: SOURCE_NOTE,
        });
      }),
  );

  server.registerTool(
    "proyav_get_declaration",
    {
      title: "Декларація",
      description: [
        "Одна декларація: доходи, нерухомість, транспорт, корпоративні права, бенефіціарна",
        "власність, грошові активи та зобовʼязання.",
        "",
        "Реєстр сам вимарює паспорт, податковий номер і точну адресу. Сервер додатково не",
        "передає адрес і дат народження родичів: вони опубліковані, але переказувати дату",
        "народження дитини в розмову немає підстав.",
        "",
        "full=true віддає сирий запис реєстру. Він великий і містить службові поля,",
        "беріть лише коли вижимки справді бракує.",
      ].join("\n"),
      inputSchema: {
        id: z.string().min(8).describe("Ідентифікатор декларації з пошуку."),
        full: z.boolean().optional().describe("Сирий запис замість вижимки."),
      },
    },
    async ({ id, full }) =>
      guard(async () => {
        const doc = await fetchDocument(id);
        return asJsonContent(
          full
            ? { raw: doc, source: SOURCE_NOTE }
            : { ...projectDeclaration(doc), source: SOURCE_NOTE },
        );
      }),
  );

  server.registerTool(
    "proyav_declarant_history",
    {
      title: "Декларації однієї особи",
      description: [
        "Усі декларації одного декларанта по роках. Ідентифікатор декларанта приходить",
        "у результатах пошуку полем declarantId.",
        "",
        "Це основа для порівняння: спершу візьміть історію, потім proyav_compare_declarations",
        "для двох конкретних років.",
      ].join("\n"),
      inputSchema: {
        declarantId: z.number().int().describe("Ідентифікатор декларанта."),
        page: z.number().int().min(1).optional(),
      },
    },
    async ({ declarantId, page }) =>
      guard(async () => {
        const response = await searchDocuments({ declarantId, page });
        const sorted = response.data
          .map(projectSummary)
          .sort((a, b) => b.year - a.year || b.submitted.localeCompare(a.submitted));

        // The latest filing for a year replaces the earlier ones. Marking that
        // here is what stops the next call from comparing a superseded document.
        const latestPerYear = new Map<number, string>();
        for (const doc of sorted) {
          if (!latestPerYear.has(doc.year)) latestPerYear.set(doc.year, doc.id);
        }

        const declarations = sorted.map((doc) => ({
          ...doc,
          current: latestPerYear.get(doc.year) === doc.id,
        }));

        const repeated = [...new Set(
          declarations.filter((d) => !d.current).map((d) => d.year),
        )];

        return asJsonContent({
          declarantId,
          declarations,
          years: [...new Set(declarations.map((d) => d.year))].sort((a, b) => b - a),
          note:
            repeated.length > 0
              ? `За ${repeated.join(", ")} подано більш ніж одну декларацію. Чинною є та, у якої current=true: пізніша уточнює ранішню. Для порівняння років беріть саме їх, інакше різниця покаже не зміну за період, а правки в одному документі.`
              : undefined,
          source: SOURCE_NOTE,
        });
      }),
  );

  server.registerTool(
    "proyav_compare_declarations",
    {
      title: "Порівняння двох декларацій",
      description: [
        "Що змінилось між двома деклараціями однієї особи: доходи, грошові активи,",
        "зобовʼязання, поява та зникнення нерухомості й транспорту.",
        "",
        "Відмовляється порівнювати декларації різних людей.",
        "",
        "Зникнення обʼєкта не означає приховування: майно продають, дарують і переоформлюють.",
        "Поява обʼєкта нічого не означає сама собою, доки не зіставлена з доходами за той самий",
        "період. Переказуйте ці застереження людині разом із числами.",
      ].join("\n"),
      inputSchema: {
        olderId: z.string().min(8).describe("Ідентифікатор ранішої декларації."),
        newerId: z.string().min(8).describe("Ідентифікатор пізнішої декларації."),
      },
    },
    async ({ olderId, newerId }) =>
      guard(async () => {
        const [older, newer] = await Promise.all([
          fetchDocument(olderId),
          fetchDocument(newerId),
        ]);

        // One extra call, and it buys the difference between «дохід виріс»
        // and «людина втратила 150 обʼєктів нерухомості»: a person often files
        // a corrected declaration for the same year, and picking the wrong one
        // makes the comparison meaningless.
        let siblings: Array<{ id: string; year: number; submitted: string }> = [];
        try {
          const history = await searchDocuments({
            declarantId: newer.user_declarant_id,
          });
          siblings = history.data.map((doc) => ({
            id: doc.id,
            year: doc.declaration_year,
            submitted: doc.date,
          }));
        } catch {
          // The warning is a safeguard, not the answer: if history is
          // unreachable the comparison still runs, just without it.
        }

        return asJsonContent({
          ...compareDeclarations(older, newer, siblings),
          source: SOURCE_NOTE,
        });
      }),
  );
}
