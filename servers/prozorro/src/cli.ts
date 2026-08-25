#!/usr/bin/env node
import { catchUp, crawl } from "./index/crawl.js";
import { enrich } from "./index/enrich.js";
import { databasePath, indexStats, openDatabase } from "./index/db.js";

/** Operator commands. The MCP server itself never crawls: it only reads. */

const [command, ...rest] = process.argv.slice(2);
const flag = (name: string) => {
  const hit = rest.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};

const db = openDatabase();

if (command === "crawl") {
  const maxPages = Number(flag("pages") ?? 0);
  const from = flag("from");
  // Recent-first: the index becomes useful for today's procurement long before
  // the eleven-year history is covered.
  const recent = rest.includes("--recent");
  const started = Date.now();

  console.error(`індекс: ${databasePath()}`);
  console.error(
    from ? `починаємо з ${from}` : "продовжуємо з збереженого курсора",
  );

  const progress = await crawl(db, {
    maxPages,
    from,
    descending: recent,
    onProgress: (p) => {
      const seconds = (Date.now() - started) / 1000;
      const rate = Math.round(p.entries / Math.max(seconds, 0.001));
      process.stderr.write(
        `\rсторінок ${p.pages} · записів ${p.entries} · нових ${p.inserted} · ${rate}/с · до ${p.cursorDate?.slice(0, 10) ?? "?"}   `,
      );
    },
  });

  process.stderr.write("\n");
  console.error(
    `готово: ${progress.entries} записів, ${progress.inserted} нових, ${progress.updated} оновлених`,
  );
} else if (command === "update") {
  // What a scheduled job runs: read whatever changed since the last pass, then
  // fill in titles for the newest procedures that still lack them.
  const started = Date.now();
  console.error("догоняємо зміни від збереженого курсора");

  const crawled = await catchUp(db, {
    onProgress: (p) => {
      process.stderr.write(
        `\rсторінок ${p.pages} · записів ${p.entries} · нових ${p.inserted} · до ${p.cursorDate?.slice(0, 10) ?? "?"}   `,
      );
    },
  });
  process.stderr.write("\n");

  const enrichLimit = Number(flag("enrich") ?? 200);
  const enriched = enrichLimit
    ? await enrich(db, { limit: enrichLimit })
    : { updated: 0, failed: 0, processed: 0 };

  console.error(
    `готово за ${Math.round((Date.now() - started) / 1000)} с: ${crawled.inserted} нових, ${crawled.updated} оновлених, ${enriched.updated} збагачених`,
  );
} else if (command === "enrich") {
  const limit = Number(flag("limit") ?? 500);
  const started = Date.now();

  console.error(`збагачуємо ${limit} процедур, найновіші першими`);
  const progress = await enrich(db, {
    limit,
    concurrency: Number(flag("concurrency") ?? 4),
    onProgress: (p) => {
      const rate = (
        p.processed / Math.max((Date.now() - started) / 1000, 0.001)
      ).toFixed(1);
      process.stderr.write(
        `\rоброблено ${p.processed}/${limit} · оновлено ${p.updated} · помилок ${p.failed} · ${rate}/с   `,
      );
    },
  });
  process.stderr.write("\n");
  console.error(
    `готово: оновлено ${progress.updated}, не вдалося ${progress.failed}`,
  );
} else if (command === "stats") {
  const stats = indexStats(db);
  console.log(JSON.stringify({ path: databasePath(), ...stats }, null, 2));
} else {
  console.error(
    "команди: crawl [--pages=N] [--from=РРРР-ММ-ДД] [--recent] | update [--enrich=N] | enrich [--limit=N] [--concurrency=N] | stats",
  );
  process.exit(1);
}

db.close();
