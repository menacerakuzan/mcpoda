import { useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft, Database, Layers, ShieldCheck } from "lucide-react";
import { CodeBlock } from "../components/CodeBlock";
import { LiquidMetalButton } from "../components/LiquidMetalButton";
import { Mark } from "../components/Mark";
import { TOOL_COUNT, TOOL_GROUPS } from "./tools";
import { HOME } from "../lib/paths";

const SECTIONS = [
  { id: "about", label: "Що це і навіщо" },
  { id: "quickstart", label: "Швидкий старт" },
  { id: "clients", label: "Підключення клієнтів" },
  { id: "sdk", label: "SDK" },
  { id: "access", label: "Доступ і ліміти" },
  { id: "tools", label: `Доступні tools (${TOOL_COUNT})` },
  { id: "scenarios", label: "Типові сценарії" },
  { id: "errors", label: "Помилки та обмеження" },
  { id: "faq", label: "FAQ" },
];

const H2 = "font-display text-[clamp(23px,2.6vw,32px)] leading-[1.15] font-medium tracking-[-0.035em]";
const P = "mt-4 max-w-[70ch] text-[16px] leading-relaxed text-dim";

const BADGE: Record<string, { label: string; title: string }> = {
  cache: { label: "cache", title: "Відповідає з локального індексу, без звернення до джерела" },
  bulk: { label: "bulk", title: "Обробляє кілька об'єктів за один виклик" },
  export: { label: "export", title: "Повертає файл або посилання на вивантаження" },
};

function useScrollSpy(ids: string[]) {
  const [active, setActive] = useState(ids[0]);

  useEffect(() => {
    // Pick the last heading that has passed under the sticky header, rather than
    // the topmost intersecting one: a tall section still crossing the band would
    // otherwise keep the previous item highlighted.
    const pick = () => {
      const passed = ids.filter((id) => {
        const el = document.getElementById(id);
        return el ? el.getBoundingClientRect().top <= 140 : false;
      });
      setActive(passed.length ? passed[passed.length - 1] : ids[0]);
    };

    const observer = new IntersectionObserver(pick, {
      rootMargin: "-120px 0px 0px 0px",
      threshold: [0, 0.25, 0.5, 1],
    });
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    pick();
    return () => observer.disconnect();
  }, [ids]);

  return active;
}

export default function DocsApp() {
  const active = useScrollSpy(SECTIONS.map((s) => s.id));

  return (
    <div className="min-h-screen bg-ink">
      <header className="sticky top-0 z-30 border-b border-line bg-ink/85 backdrop-blur-xl">
        <div className="mx-auto flex h-[68px] max-w-[1240px] items-center gap-5 px-5 sm:px-8">
          <a href={HOME} className="flex shrink-0 items-center gap-2.5">
            <Mark className="size-[20px] text-accent-soft" />
            <span className="font-display text-[16px] font-medium tracking-tight">ПРОЯВ</span>
          </a>
          <span className="hidden font-mono text-[12px] text-dim sm:inline">MCP / документація</span>
          <a
            href={HOME}
            className="ml-auto inline-flex items-center gap-2 text-[14px] text-dim transition-colors hover:text-fg"
          >
            <ArrowLeft className="size-4" strokeWidth={1.75} />
            На головну
          </a>
        </div>
      </header>

      {/* intro */}
      <div className="border-b border-line">
        <div className="mx-auto max-w-[1240px] px-5 py-16 sm:px-8 sm:py-20">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1.5 font-mono text-[11.5px] tracking-wide text-amber-200">
            <AlertTriangle className="size-3.5" strokeWidth={2} />
            ЧЕРНЕТКА СПЕЦИФІКАЦІЇ, СЕРВЕРИ ЩЕ НЕ ОПУБЛІКОВАНІ
          </div>

          <h1 className="max-w-[20ch] font-display text-[clamp(30px,4.6vw,54px)] leading-[1.06] font-medium tracking-[-0.04em]">
            MCP-сервери <span className="text-accent-soft">ПРОЯВ</span>
          </h1>
          <p className="mt-6 max-w-[68ch] text-[17px] leading-relaxed text-[#c6cad0]">
            Два сервери відкривають AI-асистенту доступ до Prozorro, НАЗК та ЄДР. Один конфіг,
            жодних ключів API і жодної реєстрації: дані вже публічні, ми лише робимо їх придатними
            для роботи асистента.
          </p>

          <dl className="mt-12 grid gap-8 border-t border-line pt-8 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["ТРАНСПОРТ", "stdio та Streamable HTTP"],
              ["АВТОРИЗАЦІЯ", "не потрібна"],
              ["TOOLS", `${TOOL_COUNT} у чернетці`],
              ["ДАНІ", "з 2015 року"],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="font-mono text-[11px] tracking-[0.14em] text-dim">{k}</dt>
                <dd className="mt-2 text-[17px] font-semibold tracking-tight">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <div className="mx-auto flex max-w-[1240px] gap-16 px-5 py-16 sm:px-8">
        {/* table of contents */}
        <nav className="hidden w-[230px] shrink-0 lg:block">
          <div className="sticky top-[100px]">
            <p className="font-mono text-[11px] tracking-[0.14em] text-dim">НА СТОРІНЦІ</p>
            <ul className="mt-4 flex flex-col gap-1 border-l border-line">
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    className={`-ml-px block border-l py-1.5 pl-4 text-[14px] transition-colors ${
                      active === s.id
                        ? "border-accent-soft text-fg"
                        : "border-transparent text-dim hover:text-fg"
                    }`}
                  >
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </nav>

        <main className="flex min-w-0 flex-col gap-20">
          <section id="about" className="scroll-mt-24">
            <h2 className={H2}>Що це і навіщо</h2>
            <p className={P}>
              MCP (Model Context Protocol) це відкритий стандарт від Anthropic для під'єднання
              моделей до зовнішніх систем. Сервер описує свої можливості, і будь-який сумісний
              клієнт одразу вміє ними користуватись, без окремої інтеграції під кожну модель.
            </p>
            <p className={P}>
              Держава вже публікує закупівлі, декларації та реєстр юросіб. Проблема не в доступі,
              а в тому, що між сирими даними і людиною стоїть програміст. ПРОЯВ прибирає цю ланку:
              асистент сам шукає, зіставляє і рахує, а людина просто питає.
            </p>
            <p className={P}>
              Назва саме про це. Плівку треба проявити, щоб побачити те, що на ній уже записано.
              Дані так само вже існують, просто досі їх не було видно.
            </p>

            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              {[
                [Database, "Локальний індекс", "Повний зріз закупівель з 2015 року лежить поруч із сервером, тому відповідь приходить за секунди."],
                [Layers, "Компактна видача", "Асистент отримує вижимку, повні документи підтягує лише коли вони справді потрібні."],
                [ShieldCheck, "Тільки читання", "Жоден tool нічого не змінює в державних реєстрах. Це односторонній доступ."],
              ].map(([Icon, title, body]) => {
                const I = Icon as typeof Database;
                return (
                  <div key={title as string} className="rounded-2xl border border-line bg-ink-2 p-6">
                    <I className="size-5 text-accent-soft" strokeWidth={1.6} />
                    <h3 className="mt-4 text-[16px] font-semibold tracking-tight">{title as string}</h3>
                    <p className="mt-2 text-[14.5px] leading-relaxed text-dim">{body as string}</p>
                  </div>
                );
              })}
            </div>
          </section>

          <section id="quickstart" className="scroll-mt-24">
            <h2 className={H2}>Швидкий старт</h2>
            <p className={P}>
              Додайте сервери у конфіг свого клієнта і перезапустіть його. Реєстрація, ключі та
              підтвердження доступу не потрібні: усі дані публічні.
            </p>
            <CodeBlock
              className="mt-8"
              tabs={[
                {
                  id: "config",
                  label: "claude_desktop_config.json",
                  code: `{
  "mcpServers": {
    "proyav-prozorro": {
      "command": "npx",
      "args": ["-y", "@proyav/prozorro"]
    },
    "proyav-nazk": {
      "command": "npx",
      "args": ["-y", "@proyav/nazk"]
    }
  }
}`,
                },
                {
                  id: "http",
                  label: "Streamable HTTP",
                  code: `{
  "mcpServers": {
    "proyav": {
      "url": "https://mcp.proyav.od.ua/mcp"
    }
  }
}`,
                },
              ]}
            />
            <p className="mt-4 font-mono text-[12px] text-dim">
              Пакети та URL наведені як приклад майбутньої публікації.
            </p>
          </section>

          <section id="clients" className="scroll-mt-24">
            <h2 className={H2}>Підключення клієнтів</h2>
            <p className={P}>
              Сервери не залежать від конкретного асистента. Нижче спосіб під'єднання для клієнтів,
              які підтримують MCP сьогодні.
            </p>

            <div className="mt-8 overflow-x-auto rounded-2xl border border-line">
              <table className="w-full min-w-[640px] text-left text-[14.5px]">
                <thead>
                  <tr className="border-b border-line bg-ink-2">
                    <th className="px-5 py-4 font-mono text-[11px] tracking-[0.12em] font-medium text-dim">
                      КЛІЄНТ
                    </th>
                    <th className="px-5 py-4 font-mono text-[11px] tracking-[0.12em] font-medium text-dim">
                      ЯК ПІДКЛЮЧИТИ
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["Claude Desktop", "Додати блок mcpServers у claude_desktop_config.json і перезапустити застосунок."],
                    ["Claude Code", "claude mcp add proyav-prozorro -- npx -y @proyav/prozorro"],
                    ["Cursor", "Налаштування → MCP → додати сервер з тим самим блоком конфігурації."],
                    ["VS Code", "Команда MCP: Add Server, далі той самий конфіг у mcp.json."],
                  ].map(([client, how]) => (
                    <tr key={client} className="border-b border-line last:border-b-0">
                      <td className="px-5 py-4 font-semibold whitespace-nowrap">{client}</td>
                      <td className="px-5 py-4 font-mono text-[13px] text-dim">{how}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section id="sdk" className="scroll-mt-24">
            <h2 className={H2}>SDK</h2>
            <p className={P}>
              Якщо ви будуєте власного агента, під'єднуйтесь напряму через офіційні MCP SDK.
            </p>
            <CodeBlock
              className="mt-8"
              tabs={[
                {
                  id: "ts",
                  label: "TypeScript",
                  code: `import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "npx",
  args: ["-y", "@proyav/prozorro"],
});

const client = new Client({ name: "my-agent", version: "0.1.0" });
await client.connect(transport);

const { tools } = await client.listTools();

const result = await client.callTool({
  name: "proyav_search_tenders",
  arguments: {
    query: "ремонт дороги",
    region: "UA-51",
    dateFrom: "2024-01-01",
    limit: 20,
  },
});`,
                },
                {
                  id: "py",
                  label: "Python",
                  code: `from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

params = StdioServerParameters(
    command="npx",
    args=["-y", "@proyav/prozorro"],
)

async with stdio_client(params) as (read, write):
    async with ClientSession(read, write) as session:
        await session.initialize()

        tools = await session.list_tools()

        result = await session.call_tool(
            "proyav_price_benchmark",
            {"tenderId": "UA-2024-03-11-000123-a"},
        )`,
                },
                {
                  id: "ai-sdk",
                  label: "Vercel AI SDK",
                  code: `import { experimental_createMCPClient as createMCPClient } from "ai";

const mcp = await createMCPClient({
  transport: { type: "stdio", command: "npx", args: ["-y", "@proyav/prozorro"] },
});

const tools = await mcp.tools();

const result = await streamText({
  model: anthropic("claude-sonnet-5"),
  tools,
  prompt: "Порівняй ціни на ремонт доріг у сусідніх громадах за 2024 рік",
});`,
                },
              ]}
            />
          </section>

          <section id="access" className="scroll-mt-24">
            <h2 className={H2}>Доступ і ліміти</h2>
            <p className={P}>
              Авторизації немає навмисно. Prozorro віддає дані без ключів і реєстрації, декларації
              НАЗК публікуються за законом, ЄДР доступний як відкритий набір даних. Додавати
              логін означало б обмежувати доступ там, де держава його вже відкрила.
            </p>

            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              {[
                ["Тільки читання", "Сервери не мають жодного write-tool. Змінити щось у державному реєстрі через ПРОЯВ неможливо."],
                ["Кеш і свіжість", "Індекс оновлюється інкрементально. Кожна відповідь містить indexedAt, щоб асистент міг сказати, наскільки дані свіжі."],
                ["Ліміти", "Обмеження на частоту застосовуються до HTTP-режиму. Локальний stdio-сервер працює на вашій машині і лімітів не має."],
                ["Персональні дані", "Ми не збагачуємо декларації сторонніми джерелами і не додаємо нічого, чого немає в оригінальній публікації."],
              ].map(([title, body]) => (
                <div key={title} className="rounded-2xl border border-line bg-ink-2 p-6">
                  <h3 className="text-[16px] font-semibold tracking-tight">{title}</h3>
                  <p className="mt-2 text-[14.5px] leading-relaxed text-dim">{body}</p>
                </div>
              ))}
            </div>
          </section>

          <section id="tools" className="scroll-mt-24">
            <h2 className={H2}>Доступні tools ({TOOL_COUNT})</h2>
            <p className={P}>
              Перелік нижче це проєктована поверхня серверів. Точні назви, аргументи та JSON Schema
              завжди повертає сам сервер: читайте <code className="font-mono text-accent-soft">tools/list</code> на
              старті агента, це стандартна MCP-практика.
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              {Object.entries(BADGE).map(([key, b]) => (
                <span key={key} className="font-mono text-[12px] text-dim">
                  <span className="mr-2 rounded border border-line px-1.5 py-0.5 text-[11px] text-accent-soft">
                    {b.label}
                  </span>
                  {b.title}
                </span>
              ))}
            </div>

            <div className="mt-10 flex flex-col gap-12">
              {TOOL_GROUPS.map((group) => (
                <div key={group.id}>
                  <div className="flex flex-wrap items-baseline gap-3">
                    <h3 className="text-[19px] font-semibold tracking-tight">{group.title}</h3>
                    <span className="font-mono text-[12px] text-dim">{group.tools.length}</span>
                  </div>
                  {group.note && (
                    <p className="mt-2 max-w-[68ch] text-[14.5px] leading-relaxed text-dim">
                      {group.note}
                    </p>
                  )}

                  <div className="mt-5 divide-y divide-line overflow-hidden rounded-2xl border border-line">
                    {group.tools.map((tool) => (
                      <div
                        key={tool.name}
                        className="flex flex-col gap-2 p-5 transition-colors hover:bg-white/[0.025] sm:flex-row sm:items-baseline sm:gap-6"
                      >
                        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:w-[290px]">
                          <code className="font-mono text-[13px] text-fg">{tool.name}</code>
                          {tool.badges?.map((b) => (
                            <span
                              key={b}
                              title={BADGE[b].title}
                              className="rounded border border-line px-1.5 py-0.5 font-mono text-[10.5px] text-accent-soft"
                            >
                              {BADGE[b].label}
                            </span>
                          ))}
                        </div>
                        <p className="text-[14.5px] leading-relaxed text-dim">{tool.summary}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section id="scenarios" className="scroll-mt-24">
            <h2 className={H2}>Типові сценарії</h2>
            <p className={P}>
              Послідовності викликів, які асистент будує сам. Наводимо їх, щоб було видно логіку
              роботи, а не щоб ви виконували це вручну.
            </p>

            <div className="mt-8 flex flex-col gap-8">
              <div>
                <h3 className="text-[17px] font-semibold tracking-tight">
                  Перевірити, чи не завищена ціна тендера
                </h3>
                <CodeBlock
                  className="mt-4"
                  tabs={[
                    {
                      id: "s1",
                      label: "потік викликів",
                      code: `1. proyav_get_tender(tenderId)            → предмет, очікувана вартість, CPV
2. proyav_price_benchmark(tenderId)       → медіана і розкид схожих закупівель
3. proyav_list_tender_bids(tenderId)      → скільки учасників, який крок зниження
4. proyav_get_supplier_profile(edrpou)    → історія перемог у цього замовника

   • відхилення від медіани саме по собі не є порушенням
   • один учасник і нульове зниження ціни це привід подивитись уважніше
   • висновок робить людина, tool лише показує цифри`,
                    },
                  ]}
                />
              </div>

              <div>
                <h3 className="text-[17px] font-semibold tracking-tight">
                  Перевірити зв'язки між учасниками
                </h3>
                <CodeBlock
                  className="mt-4"
                  tabs={[
                    {
                      id: "s2",
                      label: "потік викликів",
                      code: `1. proyav_list_tender_bids(tenderId)      → перелік учасників з кодами ЄДРПОУ
2. proyav_find_connections(edrpou[])      → спільні засновники, керівники, адреси
3. proyav_list_entity_officers(edrpou)    → дати призначень і змін
4. proyav_search_declarations(ПІБ)        → чи декларував посадовець ці права

   • збіг адреси може означати бізнес-центр, а не змову
   • перевіряйте дати: зв'язок міг існувати до або після торгів`,
                    },
                  ]}
                />
              </div>

              <div>
                <h3 className="text-[17px] font-semibold tracking-tight">
                  Порівняти витрати сусідніх громад
                </h3>
                <CodeBlock
                  className="mt-4"
                  tabs={[
                    {
                      id: "s3",
                      label: "потік викликів",
                      code: `1. proyav_search_tenders(query, region, dateFrom, dateTo)
2. proyav_compare_buyers(buyerIds[], cpv)  → ціна за одиницю по кожному замовнику
3. proyav_aggregate_spend(cpv, region)     → загальні обсяги за період
4. proyav_export_dataset(filter)           → таблиця для звіту

   • порівнюйте однакові одиниці виміру, інакше цифри непорівнянні`,
                    },
                  ]}
                />
              </div>
            </div>
          </section>

          <section id="errors" className="scroll-mt-24">
            <h2 className={H2}>Помилки та обмеження</h2>
            <div className="mt-8 divide-y divide-line overflow-hidden rounded-2xl border border-line">
              {[
                ["-32601 Method not found", "Клієнт викликав метод, якого немає у цій версії сервера. Перечитайте tools/list."],
                ["-32602 Invalid params", "Аргумент не пройшов валідацію схеми. Схема приходить разом зі списком tools."],
                ["429 Too Many Requests", "Ліміт частоти в HTTP-режимі. Використовуйте експоненційний backoff або локальний stdio-сервер."],
                ["503 Index rebuilding", "Індекс оновлюється. Відповідь містить retryAfter, дані не втрачені."],
                ["Обрізана вибірка", "Запит зачепив забагато рядків. Звузьте період чи регіон або скористайтесь proyav_export_dataset."],
                ["Відсутні дані в джерелі", "Частина старих процедур опублікована неповно. Сервер повертає поле sourceGaps замість того, щоб домальовувати відсутнє."],
              ].map(([code, body]) => (
                <div key={code} className="flex flex-col gap-2 p-5 sm:flex-row sm:gap-6">
                  <code className="shrink-0 font-mono text-[13px] text-accent-soft sm:w-[230px]">
                    {code}
                  </code>
                  <p className="text-[14.5px] leading-relaxed text-dim">{body}</p>
                </div>
              ))}
            </div>
          </section>

          <section id="faq" className="scroll-mt-24">
            <h2 className={H2}>FAQ</h2>
            <div className="mt-8 flex flex-col gap-8">
              {[
                ["Це офіційний сервіс держави?", "Це проєкт Департаменту цифрового розвитку, інформаційної політики та кіберзахисту Одеської обласної державної адміністрації. Дані беруться з офіційних відкритих джерел, але сервери не є частиною самих реєстрів."],
                ["Чому без реєстрації?", "Тому що дані вже відкриті. Реєстрація створювала б бар'єр там, де його немає за законом, і давала б нам знання про те, хто що шукає. Ми цього не хочемо."],
                ["Чи можна працювати офлайн?", "Так. У stdio-режимі індекс лежить на вашій машині, і після початкового завантаження сервер не потребує мережі, окрім оновлень."],
                ["Ви зберігаєте мої запити?", "Локальний сервер не надсилає нам нічого. Для HTTP-режиму ми плануємо агрегований лічильник навантаження без тексту запитів."],
                ["Коли буде реліз?", "Специфікація на цій сторінці це те, що ми будуємо зараз. Поки сервери не опубліковані, будь-які назви пакетів і URL тут є прикладом."],
              ].map(([q, a]) => (
                <div key={q} className="border-t border-line pt-5">
                  <h3 className="text-[17px] font-semibold tracking-tight">{q}</h3>
                  <p className="mt-2 max-w-[70ch] text-[15.5px] leading-relaxed text-dim">{a}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-line bg-ink-2 p-8 sm:p-10">
            <h2 className={`${H2} max-w-[18ch]`}>Хочете підключитись першими?</h2>
            <p className={P}>
              Напишіть нам, і ми повідомимо, щойно сервери будуть опубліковані, разом з переліком
              tools та прикладами готових агентів.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <LiquidMetalButton href="mailto:mcp@od.gov.ua">Написати нам</LiquidMetalButton>
              <a
                href="https://modelcontextprotocol.io"
                target="_blank"
                rel="noreferrer"
                className="text-[15px] text-accent-soft hover:underline"
              >
                Специфікація MCP
              </a>
            </div>
          </section>
        </main>
      </div>

      <footer className="border-t border-line bg-ink-2">
        <div className="mx-auto flex max-w-[1240px] flex-wrap justify-between gap-8 px-5 py-12 text-[14px] text-dim sm:px-8">
          <div className="flex items-start gap-3">
            <Mark className="mt-0.5 size-5 shrink-0 text-dim" />
            <p className="max-w-[52ch]">
              Департамент цифрового розвитку, інформаційної політики та кіберзахисту Одеської
              обласної державної адміністрації
            </p>
          </div>
          <p>Відкриті дані. Відкритий код.</p>
        </div>
      </footer>
    </div>
  );
}
