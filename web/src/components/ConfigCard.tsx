import { useState } from "react";
import { Check, Copy } from "lucide-react";

export const CONFIG = `{
  "mcpServers": {
    "dano-prozorro": {
      "command": "npx",
      "args": ["-y", "@dano/prozorro"]
    },
    "dano-nazk": {
      "command": "npx",
      "args": ["-y", "@dano/nazk"]
    }
  }
}`;

const line = (text: string, i: number) => {
  const parts = text.split(/("(?:[^"\\]|\\.)*")/g);
  return (
    <div key={i} className="whitespace-pre">
      {parts.map((part, j) => {
        if (!part.startsWith('"')) return <span key={j}>{part}</span>;
        const isKey = /^\s*"/.test(part) && text.includes(`${part}:`);
        return (
          <span key={j} className={isKey ? "text-accent-soft" : "text-emerald-300/90"}>
            {part}
          </span>
        );
      })}
    </div>
  );
};

export function ConfigCard({ className = "" }: { className?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(CONFIG);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div
      className={`overflow-hidden rounded-2xl border border-line bg-ink-2/85 backdrop-blur-md ${className}`}
      style={{ boxShadow: "0 30px 70px -40px rgba(0,0,0,.9)" }}
    >
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <span className="font-mono text-[12px] text-dim">claude_desktop_config.json</span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 font-mono text-[12px] text-fg transition-colors hover:border-white/25 hover:bg-white/5"
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
      <pre className="overflow-x-auto px-4 py-4 font-mono text-[12.5px] leading-[1.85] text-[#c6cdd6]">
        <code>{CONFIG.split("\n").map(line)}</code>
      </pre>
    </div>
  );
}
