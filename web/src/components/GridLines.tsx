const VERTICAL = ["12.6%", "37.5%", "61.9%", "86.2%"];
const HORIZONTAL = ["32.7%", "71.4%"];

/**
 * A measuring grid over the footage. It gives the hero a coordinate system the
 * node diagram can hang off, and it reads as instrumentation rather than decor.
 */
export function GridLines() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {VERTICAL.map((left, i) => (
        <div
          key={left}
          className="anim-grid-v absolute top-0 h-full w-px bg-white/[0.055]"
          style={{ left, animationDelay: `${600 + i * 100}ms` }}
        />
      ))}

      {HORIZONTAL.map((top, i) => (
        <div
          key={top}
          className="anim-grid-h absolute left-0 h-px w-full bg-white/[0.055]"
          style={{ top, animationDelay: `${800 + i * 150}ms` }}
        />
      ))}

      {HORIZONTAL.map((top, hi) =>
        VERTICAL.map((left, vi) => (
          <div
            key={`${top}-${left}`}
            className="anim-scale-in absolute"
            style={{ top, left, animationDelay: `${1000 + (hi * 4 + vi) * 80}ms` }}
          >
            <span className="absolute h-px w-[10px] -translate-x-1/2 -translate-y-1/2 bg-white/70" />
            <span className="absolute h-[10px] w-px -translate-x-1/2 -translate-y-1/2 bg-white/70" />
          </div>
        )),
      )}
    </div>
  );
}
