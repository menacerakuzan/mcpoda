import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Every tool call, with how long it took.
 *
 * Written after 27.08.2026, when a person's session sat frozen for minutes and
 * the only reason anyone found out was that he said so — the server itself had
 * logged three lines at boot and nothing since. A slow call is now visible at
 * the moment it happens instead of being reconstructed afterwards from a
 * tunnel's request inspector.
 *
 * Arguments are deliberately not logged. They carry surnames on the
 * declarations server and search terms everywhere else; a log that quietly
 * accumulates who was looked up would be exactly the kind of new personal-data
 * pile LEGAL.md exists to avoid. The tool name and the duration answer the
 * operational question without keeping any of that.
 */

/** Past this, a call is worth noticing rather than just recording. */
const SLOW_MS = 3_000;

export function instrument(server: McpServer): McpServer {
  const register = server.registerTool.bind(server);

  server.registerTool = ((name: string, config: unknown, handler: (...args: never[]) => unknown) => {
    const timed = async (...args: never[]) => {
      const started = Date.now();
      try {
        const result = await handler(...args);
        report(name, Date.now() - started, "ok");
        return result;
      } catch (error) {
        report(name, Date.now() - started, "error");
        throw error;
      }
    };

    return register(name as never, config as never, timed as never);
  }) as typeof server.registerTool;

  return server;
}

function report(tool: string, ms: number, outcome: "ok" | "error") {
  const slow = ms >= SLOW_MS ? " ПОВІЛЬНО" : "";
  console.error(
    `[tool] ${new Date().toISOString()} ${tool} ${ms}ms ${outcome}${slow}`,
  );
}
