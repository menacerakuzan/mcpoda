import { Reveal } from "./Reveal";

type Stage = { period: string; title: string; body: string; state: "done" | "now" | "next" };

const STAGES: Stage[] = [
  {
    period: "Перевірено",
    title: "Дані доступні без ключів",
    body: "Prozorro, НАЗК і ЄДР віддають дані без реєстрації. Пакети опубліковано в npm, підключення — п'ять рядків конфігу.",
    state: "done",
  },
  {
    period: "Готово",
    title: "Сервер Prozorro і локальний індекс",
    body: "Пошук, картка процедури, учасники, договори та порівняння цін. Індекс — понад 30 млн закупівель з 2015 року.",
    state: "done",
  },
  {
    period: "Готово",
    title: "Сервери НАЗК і ЄДР",
    body: "Декларації та реєстр юросіб. Перевірка тендера (proyav_check_tender) зіставляє учасників обох джерел в одній відповіді.",
    state: "done",
  },
  {
    period: "Далі",
    title: "Публічний HTTP-доступ без встановлення",
    body: "Постійний домен і хостинг індексу, щоб підключення було одним посиланням, без npx і локальної збірки бази.",
    state: "next",
  },
];

const DOT: Record<Stage["state"], string> = {
  done: "border-accent-soft bg-accent-soft",
  now: "border-accent-soft bg-ink",
  next: "border-line bg-ink",
};

export function Roadmap() {
  return (
    <section className="border-t border-line py-24 sm:py-32">
      <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
        <Reveal>
          <h2 className="max-w-[19ch] font-display text-[clamp(26px,3.6vw,44px)] leading-[1.12] font-medium tracking-[-0.038em]">
            Де проєкт зараз
          </h2>
          <p className="mt-5 max-w-[58ch] text-[17px] leading-relaxed text-dim">
            Чесно про стан справ: усі три сервери опубліковані та працюють. Нижче те, що вже
            перевірено, і те, що будується.
          </p>
        </Reveal>

        <div className="mt-14 grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          {STAGES.map((stage, i) => (
            <Reveal key={stage.title} delay={i * 0.06}>
              <div className="relative border-t border-line pt-6">
                <span
                  className={`absolute -top-[5px] left-0 size-[9px] rounded-full border-2 ${DOT[stage.state]}`}
                />
                <p className="font-mono text-[11px] tracking-[0.14em] text-dim uppercase">
                  {stage.period}
                </p>
                <h3 className="mt-3 text-[17px] leading-snug font-semibold tracking-tight">
                  {stage.title}
                </h3>
                <p className="mt-2 text-[14.5px] leading-relaxed text-dim">{stage.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
