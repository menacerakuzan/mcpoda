#!/usr/bin/env node
import { createReadStream } from "node:fs";
import { openDatabase, databasePath, indexStats, writeState } from "./db.js";
import { upsertCompany } from "./db.js";
import { SubjectStream } from "./parse.js";

/**
 * Operator command. The MCP server itself never imports: it only reads.
 * The export is a weekly full snapshot, not an incremental feed (verified
 * against data.gov.ua 26.08.2026), so there is no crawler here — just a
 * from-scratch import of whatever UO.xml the operator downloaded. See
 * README.md for the exact curl/unzip steps; that part is a manual,
 * documented shell command, not code, because there is no free API to call.
 */

const [command, ...rest] = process.argv.slice(2);
const flag = (name: string) => {
  const hit = rest.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};

const db = openDatabase();

if (command === "import") {
  const file = flag("file");
  if (!file) {
    console.error("використання: import --file=/шлях/до/UO.xml");
    db.close();
    process.exit(1);
  }

  const started = Date.now();
  console.error(`індекс: ${databasePath()}`);
  console.error(`читаю ${file}`);

  const decoder = new TextDecoder("windows-1251");
  const stream = new SubjectStream();
  let companies = 0;

  db.exec("begin");

  await new Promise<void>((resolve, reject) => {
    const input = createReadStream(file);
    input.on("data", (chunk: Buffer) => {
      const text = decoder.decode(chunk, { stream: true });
      for (const company of stream.push(text)) {
        upsertCompany(db, company);
        companies++;
        if (companies % 5000 === 0) {
          db.exec("commit");
          db.exec("begin");
          const rate = Math.round(companies / Math.max((Date.now() - started) / 1000, 0.001));
          process.stderr.write(`\rкомпаній ${companies} · ${rate}/с   `);
        }
      }
    });
    input.on("end", resolve);
    input.on("error", reject);
  });

  db.exec("commit");
  process.stderr.write("\n");

  writeState(db, "imported_at", new Date().toISOString());
  const stats = indexStats(db);
  console.error(
    `готово за ${Math.round((Date.now() - started) / 1000)} с: ${stats.companies} компаній, ${stats.people} осіб`,
  );
} else if (command === "stats") {
  console.log(JSON.stringify({ path: databasePath(), ...indexStats(db) }, null, 2));
} else {
  console.error("команди: import --file=/шлях/до/UO.xml | stats");
  process.exit(1);
}

db.close();
