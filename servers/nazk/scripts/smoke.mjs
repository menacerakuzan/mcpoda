import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const c = new Client({ name: "smoke", version: "0.1.0" });
await c.connect(new StdioClientTransport({ command: "node", args: ["dist/index.js"] }));
const call = async (name, args) => {
  const t = Date.now();
  const r = await c.callTool({ name, arguments: args });
  return { ms: Date.now() - t, d: JSON.parse(r.content[0].text) };
};

const { tools } = await c.listTools();
console.log("інструменти:", tools.map((t) => t.name).join(", "));

const search = await call("proyav_search_declarations", { query: "Петренко", year: 2024 });
console.log(`\nпошук: ${search.d.totalMatches} збігів, показано ${search.d.returned} (${search.ms} мс)`);
search.d.results.slice(0, 3).forEach((r) =>
  console.log(`   ${r.name} — ${(r.position ?? "?").slice(0, 34)} | ${r.year} | ${r.type}`),
);

const first = search.d.results[0];
const card = await call("proyav_get_declaration", { id: first.id });
const c1 = card.d;
console.log(`\nдекларація ${c1.year} (${card.ms} мс): ${c1.declarant.name}`);
console.log(`   орган: ${(c1.declarant.agency ?? "—").slice(0, 50)}`);
console.log(`   дохід: ${c1.income.total ?? "—"} | нерухомість: ${c1.realEstate.length} | транспорт: ${c1.vehicles.length}`);
console.log(`   родина: ${c1.family.members} осіб (${c1.family.relations.join(", ") || "—"})`);

const history = await call("proyav_declarant_history", { declarantId: first.declarantId });
console.log(`\nісторія: ${history.d.declarations.length} декларацій, роки ${history.d.years.join(", ")}`);
if (history.d.note) console.log(`   ⚠ ${history.d.note}`);
history.d.declarations.slice(0, 3).forEach((d) =>
  console.log(`   ${d.year} ${d.current ? "чинна " : "замінена"} подана ${d.submitted.slice(0, 10)}`),
);

if (history.d.declarations.length >= 2) {
  const [newer, older] = history.d.declarations;
  const diff = await call("proyav_compare_declarations", { olderId: older.id, newerId: newer.id });
  const dd = diff.d;
  console.log(`\nпорівняння ${dd.from?.year} → ${dd.to?.year} (${diff.ms} мс)`);
  (dd.warnings ?? []).forEach((w) => console.log(`   ⚠ ${w}`));
  console.log(`   дохід: ${dd.income?.before} → ${dd.income?.after} (зміна ${dd.income?.change})`);
  console.log(`   нерухомість: ${dd.realEstate?.before} → ${dd.realEstate?.after}, зʼявилось ${dd.realEstate?.appeared.length}`);
}
await c.close();
