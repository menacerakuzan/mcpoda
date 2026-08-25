#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools/index.js";

const server = new McpServer(
  { name: "proyav-prozorro", version: "0.1.0" },
  {
    instructions: [
      "Доступ до відкритих даних Prozorro: державні та комунальні закупівлі України.",
      "",
      "Типовий порядок роботи: proyav_search_tenders знаходить процедури за словами і повертає",
      "компактні картки, далі proyav_get_tender розкриває конкретну процедуру з учасниками",
      "та переможцем. proyav_recent_tenders показує, що змінилося щойно.",
      "",
      "Сервер лише читає. Він не робить висновків про порушення: відхилення ціни від схожих",
      "закупівель або збіг у складі учасників це привід перевірити, а не доведений факт.",
    ].join("\n"),
  },
);

registerTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
