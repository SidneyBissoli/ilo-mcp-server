/**
 * Construção do McpServer — chamado pela factory do createMcpHandler a cada request
 * (exigência do modelo stateless do MCP SDK v2).
 *
 * Padrões do portfólio:
 *  - anotações obrigatórias em toda tool (title, readOnlyHint, destructiveHint;
 *    nome ≤ 64 chars; descrição diz o que a tool NÃO faz);
 *  - todo retorno carrega o envelope de proveniência v1.0 (@sbissoli/mcp-provenance);
 *  - instrumentação de uso fora do caminho crítico (withUsage → Durable Object).
 *
 * As tools vivem em src/tools/ (um módulo por grupo — os grupos são também as
 * áreas do catálogo de evals em evals/catalog.ts).
 */

import { McpServer } from "@modelcontextprotocol/server";
import { SERVER_CONFIG } from "./config.js";
import { registerCatalogTools } from "./tools/catalog.js";
import { registerDataTools } from "./tools/data.js";
import { registerMetadataTools } from "./tools/metadata.js";
import type { Env } from "./types.js";
import type { RecordUsage } from "./usage-core.js";

export { provenance } from "./ilostat/provenance.js";
export { withUsage } from "./usage-wrap.js";

export function buildServer(env: Env, record: RecordUsage = () => {}): McpServer {
  const server = new McpServer(
    { name: SERVER_CONFIG.name, version: SERVER_CONFIG.version, title: SERVER_CONFIG.title },
    { instructions: SERVER_CONFIG.instructions },
  );

  registerCatalogTools(server, env, record);
  registerMetadataTools(server, env, record);
  registerDataTools(server, env, record);

  return server;
}
