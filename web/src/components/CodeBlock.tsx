import { useState } from "react";
import { Check, Copy } from "lucide-react";

type Tab = { id: string; label: string; code: string };

function highlight(code: string) {
  return code.split("\n").map((raw, i) => {
    const parts = raw.split(/("(?:[^"\\]|\\.)*")/g);
    return (
      <div key={i} className="whitespace-pre">
        {parts.map((part, j) => {
          if (part.startsWith('"')) {
            const isKey = raw.includes(`${part}:`);
            return (
              <span key={j} className={isKey ? "text-accent-soft" : "text-emerald-300/90"}>
                {part}
              </span>
            );
          }
          return (
            <span key={j} className={/^\s*(\/\/|#|←|•)/.test(part) ? "text-dim" : undefined}>
              {part}
            </span>
          );
        })}
      </div>
    );
  });
}

export function CodeBlock({
  tabs,
  filename,
  className = "",
}: {
  tabs: Tab[];
  filename?: string;
  className?: string;
}) {
  const [active, setActive] = useState(0);
  const [copied, setCopied] = useState(false);
  const current = tabs[active];

  const copy = async () => {
    await navigator.clipboard.writeText(current.code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className={`overflow-hidden rounded-2xl border border-line bg-ink-2 ${className}`}>
      <div className="flex items-center justify-between gap-4 border-b border-line pr-3 pl-3">
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
          {tabs.length > 1 ? (
            tabs.map((tab, i) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActive(i)}
                className={`shrink-0 rounded-lg px-3 py-2.5 font-mono text-[12px] transition-colors ${
                  i === active ? "bg-white/8 text-fg" : "text-dim hover:text-fg"
                }`}
              >
                {tab.label}
              </button>
            ))
          ) : (
            <span className="px-1 py-3 font-mono text-[12px] text-dim">
              {filename ?? current.label}
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={copy}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line px-3 py-1.5 font-mono text-[12px] text-fg transition-colors hover:border-white/25 hover:bg-white/5"
        >
          {copied ? (
            <>
              <Check className="size-3.5 text-accent-soft" strokeWidth={2} /> Скопійовано
            </>
          ) : (
            <>
              <Copy className="size-3.5" strokeWidth={1.75} /> Копіювати
            </>
          )}
        </button>
      </div>

      <pre className="overflow-x-auto px-4 py-4 font-mono text-[12.5px] leading-[1.8] text-[#c6cdd6]">
        <code>{highlight(current.code)}</code>
      </pre>
    </div>
  );
}
