export type GraphNode = {
  x: number;
  y: number;
  z: number;
  kind: "buyer" | "supplier" | "person";
  cluster: number;
};

export type GraphEdge = { a: number; b: number; flagged: boolean };

/** Deterministic PRNG so the layout is identical on every render and machine. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * An illustrative procurement graph: a few buyers, the suppliers that bid on
 * their tenders, and the people who appear in more than one company. The shape
 * is generated, not real data, and the section says so.
 */
export function buildGraph() {
  const random = rng(20260819);
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  const CLUSTERS = 5;
  const centres: Array<[number, number, number]> = [];

  for (let c = 0; c < CLUSTERS; c++) {
    // spread cluster centres over a sphere so nothing overlaps in projection
    const phi = Math.acos(1 - (2 * (c + 0.5)) / CLUSTERS);
    const theta = Math.PI * (1 + Math.sqrt(5)) * c;
    const r = 6.2;
    centres.push([
      r * Math.sin(phi) * Math.cos(theta),
      r * Math.sin(phi) * Math.sin(theta) * 0.62,
      r * Math.cos(phi),
    ]);
  }

  centres.forEach((centre, c) => {
    const buyerIndex = nodes.length;
    nodes.push({ x: centre[0], y: centre[1], z: centre[2], kind: "buyer", cluster: c });

    const suppliers = 5 + Math.floor(random() * 4);
    for (let i = 0; i < suppliers; i++) {
      const spread = 2.6 + random() * 1.5;
      const index = nodes.length;
      nodes.push({
        x: centre[0] + (random() - 0.5) * spread * 2,
        y: centre[1] + (random() - 0.5) * spread * 1.6,
        z: centre[2] + (random() - 0.5) * spread * 2,
        kind: "supplier",
        cluster: c,
      });
      edges.push({ a: buyerIndex, b: index, flagged: false });
    }
  });

  // people tying several suppliers together: the pattern an auditor looks for
  const suppliers = nodes
    .map((n, i) => ({ n, i }))
    .filter(({ n }) => n.kind === "supplier");

  for (let p = 0; p < 4; p++) {
    const picks = [0, 1, 2].map(() => suppliers[Math.floor(random() * suppliers.length)]);
    const cx = picks.reduce((sum, s) => sum + s.n.x, 0) / picks.length;
    const cy = picks.reduce((sum, s) => sum + s.n.y, 0) / picks.length;
    const cz = picks.reduce((sum, s) => sum + s.n.z, 0) / picks.length;

    const personIndex = nodes.length;
    nodes.push({ x: cx, y: cy, z: cz, kind: "person", cluster: -1 });
    picks.forEach((s) => edges.push({ a: personIndex, b: s.i, flagged: true }));
  }

  return { nodes, edges };
}
