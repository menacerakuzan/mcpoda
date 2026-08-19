import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import { ArrowUpRight, Minus, Plus } from "lucide-react";
import { ConfigCard } from "./ConfigCard";
import { Reveal } from "./Reveal";
import { LiquidMetalButton } from "./LiquidMetalButton";
import { Mark } from "./Mark";

const H2 =
  "font-display text-[clamp(26px,3.6vw,44px)] leading-[1.12] font-medium tracking-[-0.038em]";
const SUB = "mt-5 max-w-[58ch] text-[17px] leading-relaxed text-dim";
const SHELL = "mx-auto max-w-[1240px] px-5 sm:px-8";

/* ---------------- the gap ---------------- */

const problems = [
  {
    title: "Фільтри задає розробник сайту",
    body: "Поставити можна тільки те запитання, яке хтось заздалегідь передбачив. Усе інше через інтерфейс недоступне.",
  },
  {
    title: "Складніше запитання коштує програміста",
    body: "«Порівняй це з тим за три роки» вже означає окрему вигрузку і людину, яка її напише. Для більшості це кінець історії.",
  },
  {
    title: "Сирі дані незручні навіть фахівцю",
    body: "Тисячі сторінок JSON, коди замість назв, реєстри між собою не пов'язані. ШІ вміє це розібрати, але доступу до даних у нього немає.",
  },
];

export function Gap() {
  return (
    <section id="gap" className="border-t border-line py-24 sm:py-32">
      <div className={SHELL}>
        <Reveal>
          <h2 className={H2}>Дані відкриті. ШІ вміє рахувати. Між ними прірва.</h2>
          <p className={SUB}>
            Держава публікує все безкоштовно: закупівлі, декларації посадовців, реєстр юросіб.
            Формально доступ має кожен. На практиці ним користується вузьке коло людей.
          </p>
        </Reveal>

        <div className="mt-14">
          {problems.map((item, i) => (
            <Reveal key={item.title} delay={i * 0.06}>
              <div
                className={`grid gap-6 py-8 md:grid-cols-[0.85fr_1.4fr] md:gap-12 ${
                  i > 0 ? "border-t border-line" : ""
                }`}
              >
                <h3 className="font-display text-[20px] leading-snug font-medium tracking-[-0.02em]">
                  {item.title}
                </h3>
                <p className="max-w-[54ch] text-[16.5px] leading-relaxed text-dim">{item.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------- how it works ---------------- */

const steps = [
  {
    title: "Вставити конфіг",
    body: "MCP це стандарт під'єднання, щось на кшталт USB-роз'єму для ШІ. П'ять рядків у налаштуваннях, без ключів API і без реєстрації.",
  },
  {
    title: "Локальний індекс",
    body: "Кеш тримає повний зріз закупівель з 2015 року, тому відповідь приходить за секунди, а не за годину очікування.",
  },
  {
    title: "Розумна видача",
    body: "Асистент отримує компактну вижимку, а повні документи підтягує лише тоді, коли вони справді потрібні для відповіді.",
  },
];

export function Setup() {
  return (
    <section id="setup" className="border-t border-line py-24 sm:py-32">
      <div className={`${SHELL} grid gap-14 lg:grid-cols-[1fr_1.05fr] lg:gap-20`}>
        <div>
          <Reveal>
            <h2 className={H2}>Один раз під'єднати, далі просто розмова</h2>
          </Reveal>
          <div className="mt-12 flex flex-col gap-9">
            {steps.map((step, i) => (
              <Reveal key={step.title} delay={i * 0.06}>
                <div className="border-t border-line pt-5">
                  <h3 className="text-[18px] font-semibold tracking-tight">{step.title}</h3>
                  <p className="mt-2 max-w-[46ch] text-[16px] leading-relaxed text-dim">
                    {step.body}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>

        <Reveal delay={0.1} className="lg:pt-4">
          <ConfigCard />
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="font-mono text-[12px] text-dim">
              Claude, Cursor та інші клієнти з підтримкою MCP
            </p>
            <a
              href="/docs/"
              className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-accent-soft hover:underline"
            >
              Документація і перелік tools
              <ArrowUpRight className="size-4" strokeWidth={2} />
            </a>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ---------------- questions ---------------- */

const asks = [
  {
    who: "Підприємець",
    text: "«Хто в моїй області закуповував будматеріали за останній рік і за якими цінами?»",
    span: "md:col-span-3",
  },
  {
    who: "Журналіст",
    text: "«Покажи всі закупівлі цього управління за три роки і побудуй графік зміни цін.»",
    span: "md:col-span-3",
  },
  {
    who: "Депутат ради",
    text: "«Хто найчастіше виграє тендери нашої міськради?»",
    span: "md:col-span-2",
  },
  {
    who: "Дослідниця",
    text: "«Збери закупівлі медикаментів по всіх областях у таблицю.»",
    span: "md:col-span-2",
  },
  {
    who: "Аудитор",
    text: "«Чи не пов'язані між собою учасники цього тендера?»",
    span: "md:col-span-2",
  },
];

export function Asks() {
  return (
    <section id="asks" className="border-t border-line py-24 sm:py-32">
      <div className={SHELL}>
        <Reveal>
          <h2 className={H2}>Дашборд відповідає на закладене. ДАНО на будь-що.</h2>
          <p className={SUB}>
            Ми не вирішуємо за вас, яке запитання ставити. Далі ШІ будує таблиці, графіки,
            графи зв'язків, готує звіт і зберігає файл.
          </p>
        </Reveal>

        <div className="mt-14 grid gap-4 md:grid-cols-6">
          <Reveal className="md:col-span-6">
            <article className="flex flex-col justify-between gap-8 rounded-2xl bg-accent p-8 sm:p-10">
              <p className="max-w-[24ch] font-display text-[clamp(21px,2.7vw,32px)] leading-[1.22] font-medium tracking-[-0.03em] text-white">
                «Скільки сусідні громади платили за такий самий ремонт дороги? Ми не переплачуємо?»
              </p>
              <span className="font-mono text-[11.5px] tracking-[0.12em] text-white/70 uppercase">
                Посадовиця громади
              </span>
            </article>
          </Reveal>

          {asks.map((ask, i) => (
            <Reveal key={ask.who} delay={i * 0.05} className={ask.span}>
              <article className="flex h-full flex-col justify-between gap-7 rounded-2xl border border-line bg-ink-2 p-7 transition-colors duration-300 hover:border-white/20">
                <p className="text-[17.5px] leading-[1.42] tracking-tight">{ask.text}</p>
                <span className="font-mono text-[11.5px] tracking-[0.12em] text-dim uppercase">
                  {ask.who}
                </span>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------- stats ---------------- */

type Stat = { value: number; decimals: number; prefix?: string; suffix?: string; label: string };

const stats: Stat[] = [
  { value: 15, decimals: 0, suffix: "M+", label: "закупівель у локальному індексі" },
  { value: 2015, decimals: 0, label: "рік, з якого доступні дані" },
  { value: 2, decimals: 0, label: "MCP-сервери: Prozorro і НАЗК" },
  { value: 0, decimals: 0, suffix: " ₴", label: "вартість, без реєстрації" },
];

function Counter({ stat, delay }: { stat: Stat; delay: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.4 });
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(reduce ? stat.value : 0);

  useEffect(() => {
    if (!inView || reduce) return;
    let raf = 0;
    let start: number | null = null;
    const duration = 1200;
    const tick = (t: number) => {
      if (start === null) start = t + delay * 1000;
      const p = Math.min(Math.max((t - start) / duration, 0), 1);
      setShown(stat.value * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, reduce, stat.value, delay]);

  return (
    <span ref={ref} className="tabular-nums">
      {shown.toFixed(stat.decimals)}
      {stat.suffix ?? ""}
    </span>
  );
}

export function Stats() {
  return (
    <section className="border-t border-line py-20 sm:py-24">
      <div className={`${SHELL} grid grid-cols-2 gap-10 lg:grid-cols-4`}>
        {stats.map((stat, i) => (
          <Reveal key={stat.label} delay={i * 0.06}>
            <div className="font-display text-[clamp(30px,4vw,48px)] leading-none font-medium tracking-[-0.045em]">
              <Counter stat={stat} delay={i * 0.05} />
            </div>
            <p className="mt-3 max-w-[22ch] text-[14.5px] text-dim">{stat.label}</p>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* ---------------- limits ---------------- */

const limits = [
  {
    q: "Ви робите власний ШІ?",
    a: "Ні. Ви під'єднуєте той асистент, яким уже користуєтесь. ДАНО дає йому доступ до реєстрів і більше нічого.",
  },
  {
    q: "Ви збираєте дані про людей?",
    a: "Нічого понад те, що держава вже опублікувала сама. Ми не створюємо нових масивів персональних даних і не збагачуємо їх зі сторонніх джерел.",
  },
  {
    q: "Інструмент виносить звинувачення?",
    a: "Ні. Він показує факти і ознаки, що потребують уваги: розбіжність цін, збіги у складі учасників. Висновок робить людина.",
  },
  {
    q: "Ви ухвалюєте рішення за тендерні комітети?",
    a: "Ні, і не маємо на це повноважень. Рішення про закупівлю лишається за замовником і його комітетом.",
  },
];

export function Limits() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section id="limits" className="border-t border-line py-24 sm:py-32">
      <div className={`${SHELL} grid gap-12 lg:grid-cols-[0.9fr_1.3fr] lg:gap-20`}>
        <Reveal>
          <h2 className={H2}>Чого ДАНО не робить</h2>
          <p className={SUB}>
            Це важливо проговорити, щоб не створювати хибних очікувань.
          </p>
        </Reveal>

        <Reveal delay={0.08}>
          <div className="border-t border-line">
            {limits.map((item, i) => {
              const isOpen = open === i;
              return (
                <div key={item.q} className="border-b border-line">
                  <button
                    type="button"
                    onClick={() => setOpen(isOpen ? null : i)}
                    aria-expanded={isOpen}
                    className="flex w-full items-center justify-between gap-6 py-6 text-left transition-colors hover:text-accent-soft"
                  >
                    <span className="text-[18px] font-semibold tracking-tight">{item.q}</span>
                    {isOpen ? (
                      <Minus className="size-5 shrink-0 text-dim" strokeWidth={1.5} />
                    ) : (
                      <Plus className="size-5 shrink-0 text-dim" strokeWidth={1.5} />
                    )}
                  </button>
                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
                        className="overflow-hidden"
                      >
                        <p className="max-w-[62ch] pb-7 text-[16.5px] leading-relaxed text-dim">
                          {item.a}
                        </p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ---------------- footer ---------------- */

export function Footer() {
  return (
    <footer className="border-t border-line bg-ink-2">
      <div className={`${SHELL} py-20`}>
        <div className="flex flex-wrap items-center justify-between gap-8 border-b border-line pb-14">
          <h2 className={`${H2} max-w-[17ch]`}>
            П'ять рядків, і ваш асистент бачить державні реєстри
          </h2>
          <LiquidMetalButton href="#setup">Підключити</LiquidMetalButton>
        </div>

        <div className="flex flex-wrap justify-between gap-8 pt-10 text-[14px] text-dim">
          <div className="flex items-start gap-3">
            <Mark className="mt-0.5 size-5 shrink-0 text-dim" />
            <p className="max-w-[52ch]">
              Департамент цифрового розвитку, інформаційної політики та кіберзахисту Одеської
              обласної державної адміністрації
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-6">
            <a href="/docs/" className="text-fg transition-colors hover:text-accent-soft">
              Документація MCP
            </a>
            <a
              href="https://modelcontextprotocol.io"
              target="_blank"
              rel="noreferrer"
              className="transition-colors hover:text-fg"
            >
              Специфікація MCP
            </a>
            <p>Відкриті дані. Відкритий код.</p>
          </div>
        </div>
      </div>
    </footer>
  );
}
