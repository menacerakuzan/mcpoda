type Node = {
  id: string;
  title: string;
  body: string;
  square: { top: string; left: string; delay: number };
  label: { top: string; left?: string; right?: string; delay: number; anim: string; maxW: string };
  wires: Array<{ x1: string; y1: string; x2: string; y2: string; delay: number }>;
};

/**
 * The three registries, drawn as one wired system. Copy stays factual: each node
 * says what the source actually contains, so the diagram is information rather
 * than sci-fi dressing.
 */
const NODES: Node[] = [
  {
    id: "prozorro",
    title: "[ PROZORRO ]",
    body: "Тендери, учасники, переможці, ціни та історія кожної фірми.",
    square: { top: "26%", left: "63%", delay: 1500 },
    label: { top: "13%", right: "6%", delay: 1100, anim: "anim-slide-right", maxW: "max-w-[190px]" },
    wires: [
      { x1: "80%", y1: "17%", x2: "66%", y2: "17%", delay: 1200 },
      { x1: "66%", y1: "17%", x2: "63%", y2: "26%", delay: 1400 },
    ],
  },
  {
    id: "nazk",
    title: "[ НАЗК ]",
    body: "Декларації посадовців: доходи, майно, корпоративні права.",
    square: { top: "56%", left: "80%", delay: 1800 },
    label: { top: "40%", right: "3%", delay: 1400, anim: "anim-slide-right", maxW: "max-w-[190px]" },
    wires: [
      { x1: "92%", y1: "47%", x2: "84%", y2: "47%", delay: 1500 },
      { x1: "84%", y1: "47%", x2: "80%", y2: "56%", delay: 1700 },
    ],
  },
  {
    id: "edr",
    title: "[ ЄДР ]",
    body: "Засновники, керівники та зв'язки між компаніями.",
    square: { top: "70%", left: "60%", delay: 2100 },
    label: { top: "83%", left: "58%", delay: 1700, anim: "anim-slide-left", maxW: "max-w-[180px]" },
    wires: [
      { x1: "57%", y1: "87%", x2: "53%", y2: "87%", delay: 1800 },
      { x1: "53%", y1: "87%", x2: "60%", y2: "70%", delay: 2000 },
    ],
  },
];

function Wire({
  x1,
  y1,
  x2,
  y2,
  delay,
}: {
  x1: string;
  y1: string;
  x2: string;
  y2: string;
  delay: number;
}) {
  return (
    <svg
      className="anim-fade-in pointer-events-none absolute inset-0 size-full"
      style={{ animationDelay: `${delay}ms` }}
    >
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke="rgba(255,255,255,0.28)"
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function HeroNodes() {
  return (
    <div className="hero-nodes pointer-events-none absolute inset-0">
      {NODES.flatMap((node) =>
        node.wires.map((wire, i) => <Wire key={`${node.id}-${i}`} {...wire} />),
      )}

      {NODES.map((node) => (
        <div key={node.id}>
          <div
            className="anim-scale-in absolute size-[80px] border border-white/80 lg:size-[100px]"
            style={{
              top: node.square.top,
              left: node.square.left,
              animationDelay: `${node.square.delay}ms`,
            }}
          />
          <div
            className={`absolute ${node.label.anim} ${node.label.maxW}`}
            style={{
              top: node.label.top,
              left: node.label.left,
              right: node.label.right,
              animationDelay: `${node.label.delay}ms`,
            }}
          >
            <span className="font-mono text-[12px] leading-[15.6px] whitespace-nowrap text-white">
              {node.title}
            </span>
            <p className="mt-[4px] text-[11px] leading-[14px] text-white/50">{node.body}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
