import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({ command: "node", args: ["dist/index.js"] });
const client = new Client({ name: "smoke", version: "0.1.0" });
await client.connect(transport);

const { tools } = await client.listTools();
console.log("tools:", tools.map((t) => t.name).join(", "));

const call = async (name, args) => {
  const started = Date.now();
  const res = await client.callTool({ name, arguments: args });
  const payload = JSON.parse(res.content[0].text);
  console.log(`\n── ${name} (${Date.now() - started} ms)`);
  return payload;
};

const search = await call("proyav_search_tenders", {
  text: "ремонт дороги",
  status: ["active.tendering"],
  perPage: 3,
});
console.log("total:", search.totalMatches, "| returned:", search.returned);
console.log(search.results.map((r) => `  ${r.tenderID}  ${r.value ?? "-"}  ${r.title?.slice(0, 46)}`).join("\n"));

const recent = await call("proyav_recent_tenders", { limit: 3 });
console.log(recent.entries.map((e) => `  ${e.tenderID}  ${e.status}  ${e.buyer.name?.slice(0, 40)}`).join("\n"));

const uuid = recent.entries[0].id;
const card = await call("proyav_get_tender", { id: uuid });
console.log(`  ${card.tenderID} | ${card.status} | ${card.expectedValue} | ${card.title?.slice(0, 50)}`);
console.log(`  позицій: ${card.counts.items}, пропозицій: ${card.counts.bids}, переможців: ${card.winners.length}`);

const byNumber = await call("proyav_get_tender", { id: recent.entries[1].tenderID });
console.log(byNumber.error ? `  resolve: ${byNumber.error}` : `  resolve ok -> ${byNumber.id}`);

await client.close();
