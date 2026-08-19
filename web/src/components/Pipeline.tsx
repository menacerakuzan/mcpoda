import { Bot, Database, FileBarChart, User } from "lucide-react";
import { Mark } from "./Mark";
import { Reveal } from "./Reveal";

const STEPS = [
  { icon: User, title: "Людина", body: "Питає звичайними словами" },
  { icon: Bot, title: "ШІ-асистент", body: "Той, яким ви вже користуєтесь" },
  { icon: Mark, title: "ПРОЯВ MCP", body: "Індекс, кеш і компактна видача", accent: true },
  { icon: Database, title: "Реєстри", body: "Prozorro, НАЗК, ЄДР" },
  { icon: FileBarChart, title: "Результат", body: "Таблиця, графік, граф, звіт" },
];

/**
 * Where we sit in the chain. Most people meeting MCP for the first time assume
 * we are building another chatbot, so the diagram says plainly that we are the
 * pipe between their assistant and the registries.
 */
export function Pipeline() {
  return (
    <section className="border-t border-line py-20 sm:py-24">
      <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
        <Reveal>
          <div className="grid gap-x-16 gap-y-5 lg:grid-cols-[1fr_1.15fr]">
            <h2 className="font-display text-[clamp(23px,2.6vw,32px)] leading-[1.15] font-medium tracking-[-0.035em]">
              Ми не робимо ще одного чат-бота
            </h2>
            <p className="max-w-[60ch] text-[16.5px] leading-relaxed text-dim">
              ПРОЯВ це ланка між асистентом, який уже вміє аналізувати, і реєстрами, до яких він
              не дотягується. Асистент лишається ваш, дані лишаються державні.
            </p>
          </div>
        </Reveal>

        <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {STEPS.map((step, i) => {
            const Icon = step.icon;
            return (
              <Reveal key={step.title} delay={i * 0.07}>
                <div
                  className={`relative flex h-full flex-col gap-4 rounded-2xl border p-5 ${
                    step.accent
                      ? "border-accent/60 bg-accent/[0.08]"
                      : "border-line bg-ink-2"
                  }`}
                >
                  <Icon
                    className={`size-5 ${step.accent ? "text-accent-soft" : "text-dim"}`}
                    strokeWidth={1.6}
                  />
                  <div>
                    <h3 className="text-[15.5px] font-semibold tracking-tight">{step.title}</h3>
                    <p className="mt-1 text-[13.5px] leading-relaxed text-dim">{step.body}</p>
                  </div>

                  {i < STEPS.length - 1 && (
                    <span
                      aria-hidden="true"
                      className="absolute top-1/2 -right-3 hidden h-px w-3 bg-line lg:block"
                    />
                  )}
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
