import { parentPort } from "node:worker_threads";
import { getIndex, indexUnavailableReason } from "./access.js";
import { sharedPeopleAmong } from "./edrLink.js";

/**
 * node:sqlite has no async API, and a count(*) over the real 30M-row index
 * can take anywhere from seconds to minutes depending on how loaded the
 * disk is — found the hard way in production on 27.08.2026, when one
 * person's broad audit query froze the whole server for everyone else for
 * minutes at a time. Node is single-threaded, so any synchronous call on
 * the main thread blocks every concurrent request regardless of which tool
 * triggered it.
 *
 * This worker owns the only connection to the local index. Every operation
 * still blocks — just this thread, not the one accepting HTTP connections —
 * so a slow query now costs one caller a wait, not everyone a frozen
 * server. Queries queue up here one at a time, same as before; what
 * changed is that the queue no longer includes /health or unrelated /mcp
 * requests.
 */

if (!parentPort) {
  throw new Error("index/worker.js must run inside a worker_threads Worker");
}

type Request = { id: number; op: string; args: unknown[] };

parentPort.on("message", ({ id, op, args }: Request) => {
  try {
    // Reads the ЄДР index, which is a different file with its own connection —
    // so it is answered before the Prozorro index is even opened, and works on
    // an install that has one index but not the other.
    if (op === "edrShared") {
      parentPort!.postMessage({
        id,
        ok: true,
        result: sharedPeopleAmong(args[0] as string[]),
      });
      return;
    }

    if (op === "presence") {
      const index = getIndex();
      parentPort!.postMessage({
        id,
        ok: true,
        result: index ? { present: true, path: index.path } : { present: false, path: null },
        unavailableReason: indexUnavailableReason(),
      });
      return;
    }

    const index = getIndex();
    if (!index) {
      parentPort!.postMessage({ id, ok: true, result: null });
      return;
    }

    let result: unknown;
    switch (op) {
      case "stats":
        result = index.stats();
        break;
      case "lookup":
        result = index.lookup(args[0] as string);
        break;
      case "benchmark":
        result = index.benchmark(args[0] as Parameters<typeof index.benchmark>[0]);
        break;
      case "aggregate":
        result = index.aggregate(args[0] as Parameters<typeof index.aggregate>[0]);
        break;
      case "compareBuyers":
        result = index.compareBuyers(args[0] as Parameters<typeof index.compareBuyers>[0]);
        break;
      case "monitorings":
        result = index.monitorings(args[0] as string);
        break;
      case "search":
        result = index.search(args[0] as Parameters<typeof index.search>[0]);
        break;
      default:
        throw new Error(`невідома операція воркера індексу: ${op}`);
    }
    parentPort!.postMessage({ id, ok: true, result });
  } catch (error) {
    parentPort!.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
