export type ToolStatus = "працює" | "у планах";

export type Tool = {
  name: string;
  summary: string;
  status: ToolStatus;
  badges?: Array<"index" | "analysis" | "source">;
};

export type ToolGroup = {
  id: string;
  title: string;
  note?: string;
  tools: Tool[];
};

/**
 * Two lists in one, and the difference is marked on every row: what the server
 * already does, and what is still a specification. The page carried twenty-four
 * planned tools while eight existed, and a documentation page that promises more
 * than the code delivers is the fastest way to lose a person's trust.
 */
export const TOOL_GROUPS: ToolGroup[] = [
  {
    id: "search",
    title: "Пошук і картки",
    note: "Працює одразу після підключення, без жодних налаштувань і локальної бази.",
    tools: [
      {
        name: "proyav_search_tenders",
        summary:
          "Повнотекстовий пошук закупівель за словами, статусом, регіоном і діапазоном сум.",
        status: "працює",
        badges: ["source"],
      },
      {
        name: "proyav_get_tender",
        summary:
          "Картка процедури: предмет, позиції, учасники, їхні пропозиції та переможець.",
        status: "працює",
        badges: ["source", "index"],
      },
      {
        name: "proyav_recent_tenders",
        summary: "Стрічка змін: що відбувається у закупівлях просто зараз.",
        status: "працює",
        badges: ["source"],
      },
    ],
  },
  {
    id: "index",
    title: "Пошук по локальному індексу",
    note: "Знімає обмеження джерела: стелю у 10 000 збігів і відсутність фільтрів за ЄДРПОУ та CPV.",
    tools: [
      {
        name: "proyav_search_index",
        summary:
          "Пошук з фільтрами за ЄДРПОУ замовника, кодом CPV, періодом і сумою. Враховує українську морфологію: «дорога» знаходить «доріг».",
        status: "працює",
        badges: ["index"],
      },
      {
        name: "proyav_index_status",
        summary:
          "Скільки процедур в індексі, за який період і яка частка вже має назву й суму.",
        status: "працює",
        badges: ["index"],
      },
    ],
  },
  {
    id: "analysis",
    title: "Аналітика",
    note: "Рахує на боці сервера, щоб асистент не тягнув тисячі карток у контекст. Разом із числами повертає покриття: неповний індекс дає занижені суми, і відповідь про це каже.",
    tools: [
      {
        name: "proyav_price_benchmark",
        summary:
          "Ціна процедури проти медіани схожих закупівель. Порівнює лише в межах однієї одиниці виміру і відмовляється рахувати, коли схожих менше восьми.",
        status: "працює",
        badges: ["index", "analysis"],
      },
      {
        name: "proyav_aggregate_spend",
        summary:
          "Обсяги закупівель за замовниками, регіонами, кодами CPV або місяцями.",
        status: "працює",
        badges: ["index", "analysis"],
      },
      {
        name: "proyav_compare_buyers",
        summary:
          "Скільки різні замовники платили за той самий предмет: питання громади про сусідів.",
        status: "працює",
        badges: ["index", "analysis"],
      },
    ],
  },
  {
    id: "check",
    title: "Перевірка тендера",
    note: "Витрина можливостей: усе, що відкриті дані кажуть про одну процедуру, в одній відповіді.",
    tools: [
      {
        name: "proyav_check_tender",
        summary:
          "Конкуренція, переможець, наскільки торги збили ціну, і збіги серед учасників: спільний телефон, пошта, адреса, контактна особа, час подання. Кожен збіг приходить із поясненням, чому він може нічого не означати.",
        status: "працює",
        badges: ["source"],
      },
    ],
  },
  {
    id: "nazk",
    title: "Декларації НАЗК",
    note: "Окремий сервер. Локального індексу декларацій немає навмисно: запити йдуть до реєстру на вимогу.",
    tools: [
      {
        name: "proyav_search_declarations",
        summary: "Пошук декларацій за прізвищем, роком і типом.",
        status: "працює",
        badges: ["source"],
      },
      {
        name: "proyav_get_declaration",
        summary:
          "Доходи, майно, транспорт, корпоративні права. Адреси та дати народження родичів не передаються навіть там, де реєстр лишає їх відкритими.",
        status: "працює",
        badges: ["source"],
      },
      {
        name: "proyav_declarant_history",
        summary:
          "Усі декларації однієї особи по роках, з позначкою, яка версія за рік є чинною.",
        status: "працює",
        badges: ["source"],
      },
      {
        name: "proyav_compare_declarations",
        summary:
          "Що змінилось між двома деклараціями однієї особи. Попереджає, якщо взято замінену декларацію або дві за один рік.",
        status: "працює",
        badges: ["source"],
      },
    ],
  },
  {
    id: "planned",
    title: "У роботі",
    note: "Специфікація, а не працюючий API. Назви й аргументи можуть змінитись.",
    tools: [
      {
        name: "proyav_entity_connections",
        summary:
          "Спільні засновники та керівники між компаніями за даними ЄДР. Потребує окремого джерела, якого поки немає.",
        status: "у планах",
      },
      {
        name: "proyav_get_supplier_profile",
        summary:
          "Історія участі фірми: перемоги, відсоток успіху, ключові замовники.",
        status: "у планах",
      },
      {
        name: "proyav_search_entities",
        summary: "Реєстр юридичних осіб ЄДР: засновники, керівники, звʼязки.",
        status: "у планах",
      },
    ],
  },
];

export const WORKING_COUNT = TOOL_GROUPS.flatMap((g) => g.tools).filter(
  (t) => t.status === "працює",
).length;

export const PLANNED_COUNT = TOOL_GROUPS.flatMap((g) => g.tools).filter(
  (t) => t.status === "у планах",
).length;

export const TOOL_COUNT = WORKING_COUNT + PLANNED_COUNT;
