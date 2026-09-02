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

const USER_AGENT = "proyav-nazk/0.1 (+https://github.com/menacerakuzan/mcpoda)";
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
    // Two failure shapes land here and both are transient: TimeoutError, and
    // the plain `TypeError: fetch failed` Node/undici throws for DNS blips
    // and dropped connections. Neither retried here until 27.08.2026, when
    // the same gap killed an unattended Prozorro crawl mid-run — this server
    // hits the live register on every single call, so it is exposed to the
    // same blip with no index to fall back on. Anything else is rethrown.
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
        : `Мережева помилка: ${(error as Error & { cause?: unknown }).cause ?? (error as Error).message}`;
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
