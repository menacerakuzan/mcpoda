export class SourceError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    message: string,
  ) {
    super(message);
    this.name = "SourceError";
  }
}

const USER_AGENT = "proyav-mcp/0.1 (+https://github.com/menacerakuzan/mcpoda)";
const TIMEOUT_MS = 20_000;
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One place for every outbound call: identifies us to the source, gives up
 * rather than hanging the assistant, and backs off on the codes that are worth
 * retrying. Anything else is surfaced as a plain error the model can read.
 */
export async function requestJson<T>(
  url: string,
  init: RequestInit = {},
  attempt = 0,
): Promise<T> {
  let response: Response;

  try {
    response = await fetch(url, {
      ...init,
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    // Two different failure shapes both land here and both need the same
    // treatment for a job meant to run unattended for hours: TimeoutError
    // (found the hard way — a crawl died after twelve million requests on
    // one slow response) and the plain `TypeError: fetch failed` Node/undici
    // throws for DNS blips, connection resets and similar network hiccups
    // (found the same way, a second time: a backfill died silently at
    // 17:57 on exactly this, because it wasn't covered and there was no
    // SourceError for the outer crawl loop to catch and retry). Anything
    // that isn't one of these two known-transient shapes is rethrown as-is.
    const isTimeout = error instanceof Error && error.name === "TimeoutError";
    const isNetworkFailure =
      error instanceof TypeError && error.message === "fetch failed";

    if (isTimeout || isNetworkFailure) {
      if (attempt < 3) {
        await sleep(400 * 2 ** attempt);
        return requestJson<T>(url, init, attempt + 1);
      }
      const reason = isTimeout
        ? `Джерело не відповіло за ${TIMEOUT_MS} мс`
        : `Мережева помилка: ${(error as Error & { cause?: unknown }).cause ?? error.message}`;
      throw new SourceError(isTimeout ? 408 : 0, url, reason);
    }
    throw error;
  }

  if (!response.ok) {
    if (RETRY_STATUS.has(response.status) && attempt < 3) {
      await sleep(400 * 2 ** attempt);
      return requestJson<T>(url, init, attempt + 1);
    }
    const body = await response.text().catch(() => "");
    throw new SourceError(
      response.status,
      url,
      `Джерело відповіло ${response.status}. ${body.slice(0, 200)}`,
    );
  }

  return (await response.json()) as T;
}
