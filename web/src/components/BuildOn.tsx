import { Reveal } from "./Reveal";

const IDEAS = [
  {
    title: "Перевірка тендерів",
    body: "Порівняння ціни з тим, за скільки схоже вже купували, і перевірка зв'язків між учасниками. Це те, що ми зберемо самі першим.",
    ours: true,
  },
  {
    title: "Ринкова аналітика",
    body: "Обсяги ніші за регіонами і роками, сезонність, хто реально виграє і з якою маржею до очікуваної вартості.",
  },
  {
    title: "Допомога малому бізнесу",
    body: "Помічник, який підказує підприємцю, у які торги є сенс заходити і з якою ціною, виходячи з історії замовника.",
  },
  {
    title: "Робота громад",
    body: "Порівняння власних витрат із сусідніми громадами перед тим, як оголошувати закупівлю.",
  },
  {
    title: "Журналістика і аудит",
    body: "Побудова графів зв'язків, вивантаження вибірок і підготовка матеріалів на основі первинних даних.",
  },
  {
    title: "Навчання",
    body: "Курс або практикум з відкритих даних, де студенти працюють із реальними реєстрами, а не з навчальним CSV.",
  },
];

/**
 * The point of the tool is that we do not know what people will build. Naming
 * six directions is honest about that: one of them is ours, the rest are open.
 */
export function BuildOn() {
  return (
    <section className="border-t border-line py-24 sm:py-32">
      <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
        <Reveal>
          <h2 className="max-w-[19ch] font-display text-[clamp(26px,3.6vw,44px)] leading-[1.12] font-medium tracking-[-0.038em]">
            Що можна побудувати поверх ДАНО
          </h2>
          <p className="mt-5 max-w-[58ch] text-[17px] leading-relaxed text-dim">
            Продукт це інструмент, а не одне готове рішення. Перевірку тендерів ми зберемо самі,
            щоб показати силу інструмента. Решту зробить хтось інший, і ми заздалегідь не знаємо хто.
          </p>
        </Reveal>

        <div className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
          {IDEAS.map((idea, i) => (
            <Reveal key={idea.title} delay={i * 0.05}>
              <div className="flex h-full flex-col gap-3 bg-ink p-7 transition-colors duration-300 hover:bg-ink-2">
                <div className="flex items-center gap-3">
                  <h3 className="text-[17px] font-semibold tracking-tight">{idea.title}</h3>
                  {idea.ours && (
                    <span className="rounded border border-accent/50 px-1.5 py-0.5 font-mono text-[10.5px] text-accent-soft">
                      робимо самі
                    </span>
                  )}
                </div>
                <p className="text-[15px] leading-relaxed text-dim">{idea.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
