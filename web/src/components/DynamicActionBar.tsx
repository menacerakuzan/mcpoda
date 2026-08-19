import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { LucideIcon } from "lucide-react";

export type ActionItem = {
  id: string;
  label: string;
  icon: LucideIcon;
  content: React.ReactNode;
  height: number;
  width: number;
};

const BAR_HEIGHT = 56;
/** Equal optical inset on all four sides of the closed pill. */
const BAR_INSET = 10;
const spring = { type: "spring" as const, stiffness: 420, damping: 38, mass: 0.9 };

/**
 * The bar morphs open to preview what each source actually holds. It is the one
 * place on the page where motion carries information: the panel grows out of the
 * control you touched, so it stays obvious where the content came from.
 */
export function DynamicActionBar({ actions }: { actions: ActionItem[] }) {
  const [active, setActive] = useState<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const row = useRef<HTMLDivElement>(null);
  const baseId = useId();

  // The closed width is whatever the buttons actually measure, plus the inset.
  // Hard-coding it drifts the moment a label or the font changes.
  const [closedWidth, setClosedWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = row.current;
    if (!el) return;
    // +2 for the pill's 1px border on each side (the motion div is border-box)
    const measure = () => setClosedWidth(Math.round(el.getBoundingClientRect().width) + 2);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Web fonts land after first paint and change the button widths under us.
  useEffect(() => {
    document.fonts?.ready.then(() => {
      const el = row.current;
      if (el) setClosedWidth(Math.round(el.getBoundingClientRect().width) + 2);
    });
  }, []);

  const current = active !== null ? actions[active] : null;

  const open = (index: number) => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    setActive(index);
  };

  const scheduleClose = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setActive(null), 120);
  };

  return (
    <div
      className="relative"
      onMouseLeave={scheduleClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") setActive(null);
      }}
    >
      <motion.div
        layout
        initial={false}
        animate={
          current
            ? { width: current.width, height: current.height + BAR_HEIGHT }
            : { width: closedWidth ?? "auto", height: BAR_HEIGHT }
        }
        transition={spring}
        className="flex flex-col overflow-hidden rounded-[22px] border border-line/80 bg-ink-2/80 backdrop-blur-xl"
        style={{ boxShadow: "0 24px 60px -24px rgba(0,0,0,.9)" }}
      >
        <div
          ref={row}
          className="mx-auto flex w-max shrink-0 items-center justify-center gap-1"
          style={{ height: BAR_HEIGHT, paddingInline: BAR_INSET }}
        >
          {actions.map((action, index) => {
            const Icon = action.icon;
            const isActive = active === index;
            return (
              <button
                key={action.id}
                type="button"
                aria-expanded={isActive}
                aria-controls={`${baseId}-${action.id}`}
                onMouseEnter={() => open(index)}
                onFocus={() => open(index)}
                onClick={() => setActive(isActive ? null : index)}
                className={`flex items-center gap-2 rounded-2xl px-3.5 py-2 text-[14px] font-semibold transition-colors duration-200 ${
                  isActive ? "bg-accent text-white" : "text-dim hover:bg-white/6 hover:text-fg"
                }`}
              >
                <Icon className="size-[17px]" strokeWidth={1.75} />
                {action.label}
              </button>
            );
          })}
        </div>

        <div className="min-h-0 grow overflow-hidden">
          <AnimatePresence mode="wait">
            {current && (
              <motion.div
                key={current.id}
                id={`${baseId}-${current.id}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                className="h-full"
              >
                {current.content}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}
