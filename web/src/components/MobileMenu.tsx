import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { Mark } from "./Mark";
import { DOCS } from "../lib/paths";

const LINKS = [
  { href: "#gap", label: "Навіщо" },
  { href: "#setup", label: "Як працює" },
  { href: "#asks", label: "Приклади" },
  { href: "#limits", label: "Межі" },
  { href: DOCS, label: "Документація" },
];

const ease = [0.76, 0, 0.24, 1] as const;

export function MobileMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Escape closes, and the page must not scroll behind the sheet.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.28, ease }}
            onClick={onClose}
            className="absolute inset-0 bg-ink/92 backdrop-blur-md"
          />

          <motion.div
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.34, ease }}
            className="relative flex h-full flex-col px-5 pt-6 pb-10"
          >
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2.5">
                <Mark className="size-[22px] text-accent-soft" />
                <span className="font-display text-[17px] font-medium tracking-tight">ПРОЯВ</span>
              </span>
              <button
                type="button"
                onClick={onClose}
                aria-label="Закрити меню"
                className="grid size-[44px] place-items-center rounded-full border border-line"
              >
                <X className="size-[20px]" strokeWidth={1.6} />
              </button>
            </div>

            <nav className="mt-16 flex flex-col gap-7">
              {LINKS.map((link, i) => (
                <motion.a
                  key={link.href}
                  href={link.href}
                  onClick={onClose}
                  initial={{ opacity: 0, x: -18 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.4, delay: 0.08 + i * 0.055, ease }}
                  className="font-display text-[27px] leading-[1.2] font-medium tracking-[-0.03em]"
                >
                  {link.label}
                </motion.a>
              ))}
            </nav>

            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.36, ease }}
              className="mt-auto border-t border-line pt-8"
            >
              <a
                href="#setup"
                onClick={onClose}
                className="flex h-[52px] items-center justify-center rounded-full bg-accent text-[15px] font-semibold text-white"
              >
                Підключити за 2 хвилини
              </a>
              <p className="mt-5 text-[13px] leading-relaxed text-dim">
                Департамент цифрового розвитку, інформаційної політики та кіберзахисту Одеської
                обласної державної адміністрації
              </p>
            </motion.div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
