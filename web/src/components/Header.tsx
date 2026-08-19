import { useState } from "react";
import { FileText, Landmark, Menu, ScrollText } from "lucide-react";
import { DynamicActionBar, type ActionItem } from "./DynamicActionBar";
import { LiquidMetalButton } from "./LiquidMetalButton";
import { Mark } from "./Mark";
import { MobileMenu } from "./MobileMenu";
import { DOCS } from "../lib/paths";

const Row = ({
  title,
  meta,
  note,
}: {
  title: string;
  meta: string;
  note: string;
}) => (
  <div className="group flex items-center justify-between gap-4 rounded-xl px-3 py-2.5 transition-colors hover:bg-white/5">
    <div className="min-w-0">
      <p className="truncate text-[14.5px] font-semibold text-fg">{title}</p>
      <p className="truncate text-[13px] text-dim">{note}</p>
    </div>
    <span className="shrink-0 rounded-lg border border-line px-2 py-1 font-mono text-[11px] text-dim">
      {meta}
    </span>
  </div>
);

const Sources = () => (
  <div className="flex flex-col gap-0.5 px-3 pt-1 pb-3">
    <Row title="Prozorro" meta="закупівлі" note="Тендери, учасники, переможці, ціни, історія фірми" />
    <Row title="НАЗК" meta="декларації" note="Доходи, майно, корпоративні права, дані родини" />
    <Row title="ЄДР" meta="юрособи" note="Засновники, керівники, зв'язки між компаніями" />
  </div>
);

const Asks = () => (
  <div className="flex flex-col gap-0.5 px-3 pt-1 pb-3">
    <Row title="Ми не переплачуємо за ремонт дороги?" meta="громада" note="Порівняння з сусідніми замовниками" />
    <Row title="Хто виграє тендери нашої міськради?" meta="депутат" note="Частка перемог по постачальниках" />
    <Row title="Чи пов'язані учасники цього тендера?" meta="аудитор" note="Граф зв'язків через ЄДР і декларації" />
  </div>
);

const Setup = () => (
  <div className="flex flex-col gap-0.5 px-3 pt-1 pb-3">
    <Row title="Відкрити налаштування асистента" meta="крок" note="Claude, Cursor або інший клієнт з MCP" />
    <Row title="Вставити п'ять рядків конфігу" meta="крок" note="Без ключів API і без реєстрації" />
    <Row title="Перезапустити і питати" meta="крок" note="Далі розмова звичайними словами" />
  </div>
);

const actions: ActionItem[] = [
  { id: "sources", label: "Джерела", icon: Landmark, content: <Sources />, width: 470, height: 200 },
  { id: "asks", label: "Приклади", icon: ScrollText, content: <Asks />, width: 500, height: 200 },
  { id: "setup", label: "Підключення", icon: FileText, content: <Setup />, width: 470, height: 200 },
];

export function Header() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="absolute inset-x-0 top-0 z-30 px-5 pt-5 sm:px-8 sm:pt-6">
      <div className="mx-auto flex max-w-[1240px] items-start justify-between gap-6">
        <div className="flex shrink-0 items-center gap-6 pt-3">
          <a href="#top" className="flex items-center gap-2.5">
            <Mark className="size-[22px] text-accent-soft" />
            <span className="font-display text-[17px] font-medium tracking-tight">ДАНО</span>
          </a>
          <a
            href={DOCS}
            className="hidden text-[14px] text-dim transition-colors hover:text-fg lg:inline"
          >
            Документація
          </a>
        </div>

        <div className="hidden md:block">
          <DynamicActionBar actions={actions} />
        </div>

        <div className="flex shrink-0 items-center gap-3 pt-0.5">
          <LiquidMetalButton href="#setup">Підключити</LiquidMetalButton>
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="Відкрити меню"
            aria-expanded={menuOpen}
            className="grid size-[52px] place-items-center rounded-full border border-white/12 bg-ink-2/70 backdrop-blur-md transition-colors hover:border-white/25 lg:hidden"
          >
            <Menu className="size-[20px]" strokeWidth={1.6} />
          </button>
        </div>
      </div>

      <MobileMenu open={menuOpen} onClose={() => setMenuOpen(false)} />
    </header>
  );
}
