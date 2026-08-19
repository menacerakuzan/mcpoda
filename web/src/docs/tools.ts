export type Tool = {
  name: string;
  summary: string;
  badges?: Array<"cache" | "bulk" | "export">;
};

export type ToolGroup = {
  id: string;
  title: string;
  note?: string;
  tools: Tool[];
};

/**
 * Draft surface of the two servers. Names and arguments are a specification we
 * are still writing, not a shipped API: the live list always comes from
 * `tools/list` once a server is running.
 */
export const TOOL_GROUPS: ToolGroup[] = [
  {
    id: "tenders",
    title: "Закупівлі Prozorro",
    note: "Ядро сервера. Пошук завжди повертає компактну вижимку, повну картку тендера підтягуємо окремим викликом.",
    tools: [
      {
        name: "dano_search_tenders",
        summary: "Пошук закупівель за словами, періодом, регіоном, CPV та діапазоном сум.",
        badges: ["cache"],
      },
      {
        name: "dano_get_tender",
        summary: "Повна картка процедури: предмет, очікувана вартість, статус, документи.",
      },
      {
        name: "dano_list_tender_bids",
        summary: "Учасники процедури та їхні цінові пропозиції, включно з відхиленими.",
      },
      {
        name: "dano_get_award",
        summary: "Рішення про переможця: обґрунтування, дата, сума, скарги.",
      },
      {
        name: "dano_get_contract",
        summary: "Договір за результатами торгів: сума, строк, додаткові угоди та зміни ціни.",
      },
      {
        name: "dano_get_plan",
        summary: "Річний план закупівель замовника і його виконання.",
      },
    ],
  },
  {
    id: "actors",
    title: "Замовники та постачальники",
    tools: [
      {
        name: "dano_search_suppliers",
        summary: "Пошук постачальника за назвою або кодом ЄДРПОУ.",
      },
      {
        name: "dano_get_supplier_profile",
        summary: "Історія участі фірми: перемоги, відсоток успіху, ключові замовники, суми.",
        badges: ["cache"],
      },
      {
        name: "dano_get_buyer_profile",
        summary: "Профіль замовника: обсяги закупівель, топ-постачальники, розподіл процедур.",
        badges: ["cache"],
      },
    ],
  },
  {
    id: "analysis",
    title: "Порівняння та агрегації",
    note: "Ці tools рахують на нашому боці, щоб асистент не тягнув тисячі сторінок JSON у контекст.",
    tools: [
      {
        name: "dano_price_benchmark",
        summary: "Ціна тендера проти схожих закупівель за period, регіоном і одиницею виміру.",
        badges: ["cache"],
      },
      {
        name: "dano_aggregate_spend",
        summary: "Агрегати витрат за CPV, замовником, регіоном або періодом.",
        badges: ["cache", "bulk"],
      },
      {
        name: "dano_compare_buyers",
        summary: "Порівняння кількох замовників за однаковим предметом закупівлі.",
        badges: ["bulk"],
      },
      {
        name: "dano_export_dataset",
        summary: "Вивантаження вибірки у CSV або JSON для подальшої роботи у файлі.",
        badges: ["export"],
      },
    ],
  },
  {
    id: "declarations",
    title: "Декларації НАЗК",
    note: "Окремий сервер. Працює лише з тим, що суб'єкти декларування зобов'язані публікувати за законом.",
    tools: [
      {
        name: "dano_search_declarations",
        summary: "Пошук декларацій за ПІБ, посадою, органом та роком.",
        badges: ["cache"],
      },
      {
        name: "dano_get_declaration",
        summary: "Повна декларація за ідентифікатором.",
      },
      {
        name: "dano_get_declarant_profile",
        summary: "Усі подані декларації однієї особи з посадами по роках.",
      },
      {
        name: "dano_list_declaration_assets",
        summary: "Нерухомість, транспорт, цінне майно з декларації.",
      },
      {
        name: "dano_list_declaration_income",
        summary: "Доходи, подарунки, готівка та банківські активи.",
      },
      {
        name: "dano_list_corporate_rights",
        summary: "Корпоративні права та бенефіціарна власність декларанта.",
      },
      {
        name: "dano_diff_declarations",
        summary: "Порівняння двох років однієї особи: що з'явилось, зникло або змінилось у сумі.",
      },
    ],
  },
  {
    id: "registry",
    title: "Юридичні особи ЄДР",
    tools: [
      {
        name: "dano_search_entities",
        summary: "Пошук юрособи або ФОП за назвою, кодом чи адресою.",
      },
      {
        name: "dano_get_entity",
        summary: "Картка юрособи: статус, КВЕДи, адреса, статутний капітал.",
      },
      {
        name: "dano_list_entity_officers",
        summary: "Керівники, засновники та бенефіціари з датами змін.",
      },
      {
        name: "dano_find_connections",
        summary:
          "Спільні засновники, керівники та адреси між кількома компаніями. Повертає ребра графа, а не висновок.",
        badges: ["bulk"],
      },
    ],
  },
];

export const TOOL_COUNT = TOOL_GROUPS.reduce((n, g) => n + g.tools.length, 0);
