#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools/index.js";
import { INSTRUCTIONS } from "./instructions.js";

const server = new McpServer(
  { name: "proyav-edr", version: "0.1.0" },
  { instructions: INSTRUCTIONS },
);

registerTools(server);
await server.connect(new StdioServerTransport());
