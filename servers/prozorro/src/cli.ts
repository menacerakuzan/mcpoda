#!/usr/bin/env node
import { catchUp, crawl } from "./index/crawl.js";
import { enrich } from "./index/enrich.js";
import { crawlMonitorings, detailMonitorings } from "./index/audit.js";
import { databasePath, indexStats, openDatabase, recordCounts } from "./index/db.js";
import { SourceError } from "./http.js";

/** Operator commands. The MCP server itself never crawls: it only reads. */

const [command, ...rest] = process.argv.slice(2);
const flag = (name: string) => {
  const hit = rest.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};

const db = openDatabase();

/**
 * Keeps the process alive for the whole of a long command.
 *
 * A backfill exited by itself after three hundred thousand records with only
 * Node's «Detected unsettled top-level await» to show for it. Nothing threw:
 * the event loop simply ran dry while a request was still in flight, because
 * `AbortSignal.timeout` does not hold the loop open, and a pass that spends
 * most of its time waiting on the network can reach a moment where no handle
 * is ref'd at all. A ref'd interval removes that whole failure mode — the
 * process now ends when the work ends, and not before.
 */
const keepAlive = setInterval(() => {}, 60_000);
const done = () => {
  clearInterval(keepAlive);
  db.close();
};

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

  // A single crawl run is meant to go for hours unattended, and http.ts already
  // retries a request three times before giving up. That was not enough: a real
  // overnight run died after twelve million requests on one network blip that
  // outlasted those three retries. Network failures (SourceError) get the crawl
  // itself restarted from the saved cursor, with a growing pause between tries.
  // A validation error — the --from guard below — is not transient and must
  // surface immediately instead of retrying forever against a mistake.
  let progress;
  let attempt = 0;
  // Only cleared once a page has actually committed: crawl() persists the
  // cursor after every successful page, so from that point the saved cursor
  // already carries this run's progress and re-sending --from would restart
  // it from scratch on every retry. But if the very first page fails before
  // anything commits, the saved cursor is still the old pre-run one — keeping
  // --from here is what makes the retry honour what was actually asked for.
  let progressed = false;
  for (;;) {
    try {
      progress = await crawl(db, {
        maxPages,
        from: progressed ? undefined : from,
        descending: recent,
        onProgress: (p) => {
          progressed = true;
          const seconds = (Date.now() - started) / 1000;
          const rate = Math.round(p.entries / Math.max(seconds, 0.001));
          process.stderr.write(
            `\rсторінок ${p.pages} · записів ${p.entries} · нових ${p.inserted} · ${rate}/с · до ${p.cursorDate?.slice(0, 10) ?? "?"}   `,
          );
        },
      });
      break;
    } catch (error) {
      process.stderr.write("\n");

      if (!(error instanceof SourceError)) {
        console.error(`помилка: ${error instanceof Error ? error.message : error}`);
        done();
        process.exit(1);
      }

      attempt++;
      const pause = Math.min(5_000 * 2 ** (attempt - 1), 5 * 60_000);
      console.error(
        `джерело недоступне (${error.message}), спроба ${attempt}, пауза ${Math.round(pause / 1000)} с`,
      );
      await new Promise((resolve) => setTimeout(resolve, pause));
    }
  }

  process.stderr.write("\n");
  console.error(
    `готово: ${progress.entries} записів, ${progress.inserted} нових, ${progress.updated} оновлених`,
  );

  // The counts are what proyav_index_status reads; measuring them here costs
  // one pass at the end of a job that already took hours, and saves every
  // later request from paying for it.
  recordCounts(db);
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

  // The counts are what proyav_index_status reads; measuring them here costs
  // one pass at the end of a job that already took hours, and saves every
  // later request from paying for it.
  recordCounts(db);
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

  // The counts are what proyav_index_status reads; measuring them here costs
  // one pass at the end of a job that already took hours, and saves every
  // later request from paying for it.
  recordCounts(db);
} else if (command === "audit") {
  // Both passes in one command: there are tens of thousands of monitorings,
  // not millions, so there is no reason to make anyone run two.
  const started = Date.now();
  const detailLimit = Number(flag("detail") ?? 5000);

  console.error("стрічка моніторингів Держаудитслужби");
  const crawled = await crawlMonitorings(db, {
    maxPages: Number(flag("pages") ?? 0),
    onProgress: (p) => {
      process.stderr.write(
        `\rсторінок ${p.pages} · моніторингів ${p.seen} · нових ${p.inserted} · до ${p.cursorDate?.slice(0, 10) ?? "?"}   `,
      );
    },
  });
  process.stderr.write("\n");

  console.error(`висновки: до ${detailLimit} записів, найновіші першими`);
  const detailed = await detailMonitorings(db, {
    limit: detailLimit,
    onProgress: (p) => {
      const rate = (p.seen / Math.max((Date.now() - started) / 1000, 0.001)).toFixed(1);
      process.stderr.write(
        `\rоброблено ${p.seen}/${detailLimit} · заповнено ${p.detailed} · помилок ${p.failed} · ${rate}/с   `,
      );
    },
  });
  process.stderr.write("\n");

  console.error(
    `готово за ${Math.round((Date.now() - started) / 1000)} с: ${crawled.inserted} нових моніторингів, ${detailed.detailed} висновків`,
  );
} else if (command === "stats") {
  const stats = indexStats(db);
  console.log(JSON.stringify({ path: databasePath(), ...stats }, null, 2));
} else {
  console.error(
    "команди: crawl [--pages=N] [--from=РРРР-ММ-ДД] [--recent] | update [--enrich=N] | enrich [--limit=N] [--concurrency=N] | audit [--pages=N] [--detail=N] | stats",
  );
  process.exit(1);
}

done();
