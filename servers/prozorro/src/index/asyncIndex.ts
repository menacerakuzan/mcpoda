import { Worker } from "node:worker_threads";
import type { IndexStats } from "./db.js";
import type { lookupByTenderId, monitoringsFor, searchIndex, IndexSearch } from "./queries.js";
import type { benchmark } from "../analysis/benchmark.js";
import type { aggregate, compareBuyers } from "../analysis/aggregate.js";

/**
 * The async front door to the local index, backed by index/worker.ts. Every
 * export here returns a Promise and can be awaited from a request handler
 * without risking that request's query blocking any other concurrent one —
 * see worker.ts for why that risk is real, not theoretical.
 */

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<
  number,
  { resolve: (v: { result: unknown; unavailableReason?: string | null }) => void; reject: (e: unknown) => void }
>();

function ensureWorker(): Worker {
  if (worker) return worker;

  const w = new Worker(new URL("./worker.js", import.meta.url));
  w.on("message", (msg: { id: number; ok: boolean; result?: unknown; error?: string; unavailableReason?: string | null }) => {
    const call = pending.get(msg.id);
    if (!call) return;
    pending.delete(msg.id);
    if (msg.ok) call.resolve({ result: msg.result, unavailableReason: msg.unavailableReason });
    else call.reject(new Error(msg.error));
  });
  w.on("error", (error) => {
    for (const call of pending.values()) call.reject(error);
    pending.clear();
    worker = null;
  });
  w.on("exit", () => {
    for (const call of pending.values()) call.reject(new Error("індекс-воркер зупинився"));
    pending.clear();
    worker = null;
  });
  // A worker kept alive only for this must not itself keep the process from
  // exiting on SIGTERM/SIGINT.
  w.unref();

  worker = w;
  return w;
}

function call(op: string, ...args: unknown[]) {
  const w = ensureWorker();
  const id = nextId++;
  return new Promise<{ result: unknown; unavailableReason?: string | null }>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, op, args });
  });
}

export type IndexPresence = { present: boolean; path: string | null; unavailableReason: string | null };

export async function indexPresence(): Promise<IndexPresence> {
  const { result, unavailableReason } = (await call("presence")) as {
    result: { present: boolean; path: string | null };
    unavailableReason?: string | null;
  };
  return { ...result, unavailableReason: unavailableReason ?? null };
}

export async function stats(): Promise<IndexStats | null> {
  const { result } = await call("stats");
  return result as IndexStats | null;
}

export async function lookup(tenderID: string): Promise<ReturnType<typeof lookupByTenderId> | null> {
  const { result } = await call("lookup", tenderID);
  return result as ReturnType<typeof lookupByTenderId> | null;
}

export async function runBenchmark(
  options: Parameters<typeof benchmark>[1],
): Promise<ReturnType<typeof benchmark> | null> {
  const { result } = await call("benchmark", options);
  return result as ReturnType<typeof benchmark> | null;
}

export async function runAggregate(
  options: Parameters<typeof aggregate>[1],
): Promise<ReturnType<typeof aggregate> | null> {
  const { result } = await call("aggregate", options);
  return result as ReturnType<typeof aggregate> | null;
}

export async function runCompareBuyers(
  options: Parameters<typeof compareBuyers>[1],
): Promise<ReturnType<typeof compareBuyers> | null> {
  const { result } = await call("compareBuyers", options);
  return result as ReturnType<typeof compareBuyers> | null;
}

export async function search(query: IndexSearch): Promise<ReturnType<typeof searchIndex> | null> {
  const { result } = await call("search", query);
  return result as ReturnType<typeof searchIndex> | null;
}

/**
 * Pairs among the given EDRPOU codes that share a person in the ЄДР register.
 * Returns an empty list when that index is not installed, so a caller never
 * has to ask whether it is there.
 */
export async function edrSharedPeople(
  edrpouList: string[],
): Promise<Array<{ a: string; b: string; name: string; roleA: string; roleB: string }>> {
  const { result } = await call("edrShared", edrpouList);
  return (result as Array<{ a: string; b: string; name: string; roleA: string; roleB: string }>) ?? [];
}

/**
 * State audit monitorings recorded against one procedure. Empty when the audit
 * feed has not been crawled yet, which is the normal state of a fresh index.
 */
export async function monitorings(
  tenderUuid: string,
): Promise<ReturnType<typeof monitoringsFor>> {
  const { result } = await call("monitorings", tenderUuid);
  return (result as ReturnType<typeof monitoringsFor>) ?? [];
}
