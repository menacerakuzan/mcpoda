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
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new SourceError(
        408,
        url,
        `Джерело не відповіло за ${TIMEOUT_MS} мс`,
      );
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
