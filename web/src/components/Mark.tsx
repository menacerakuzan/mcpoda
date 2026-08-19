/** The dot-matrix mark: scattered points resolving into one bright centre. */
export function Mark({ className = "" }: { className?: string }) {
  const dots: Array<[number, number, number]> = [
    [12, 3, 1.6],
    [7, 8, 1.6],
    [12, 8, 1.6],
    [17, 8, 1.6],
    [2.6, 13, 1.6],
    [7, 13, 1.6],
    [12, 13, 2.5],
    [17, 13, 1.6],
    [21.4, 13, 1.6],
    [7, 18, 1.6],
    [12, 18, 1.6],
    [17, 18, 1.6],
    [12, 22.6, 1.6],
  ];

  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      {dots.map(([cx, cy, r], i) => (
        <circle key={i} cx={cx} cy={cy} r={r} opacity={r > 2 ? 1 : 0.78} />
      ))}
    </svg>
  );
}
