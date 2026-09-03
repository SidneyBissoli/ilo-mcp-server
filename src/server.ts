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
 * áreas do catálogo de evals em evals/catalog.ts). Resources (documentação de
 * referência) e prompts (workflows) vivem em src/resources.ts e src/prompts.ts —
 * ambos offline, sem estado e sem instrumentação de uso.
 */

import { McpServer } from "@modelcontextprotocol/server";
import { SERVER_CONFIG } from "./config.js";
import { announceServedVersions } from "./discover.js";
import { registerPrompts } from "./prompts.js";
import { registerResources } from "./resources.js";
import { registerCatalogTools } from "./tools/catalog.js";
import { registerDataTools } from "./tools/data.js";
import { registerDeepResearchTools } from "./tools/deep-research.js";
import { registerMetadataTools } from "./tools/metadata.js";
import type { Env } from "./types.js";
import type { RecordUsage } from "./usage-core.js";

export { provenance } from "./ilostat/provenance.js";
export { withUsage } from "./usage-wrap.js";

export function buildServer(env: Env, record: RecordUsage = () => {}): McpServer {
  const server = new McpServer(
    {
      name: SERVER_CONFIG.name,
      version: SERVER_CONFIG.version,
      title: SERVER_CONFIG.title,
      // O site do servidor no handshake — campo serverInfo.websiteUrl da
      // 2025-11-25. Mesma URL do server.json e da homepage do package.json
      // (tests/serverinfo-sync.test.ts prende as tres).
      websiteUrl: SERVER_CONFIG.websiteUrl,
      // Mesma URL declarada em server.json — tests/icon-sync.test.ts prende as
      // duas juntas, para o handshake e os diretorios nunca mostrarem imagens
      // diferentes.
      icons: [
        {
          src: "https://ilo.sidneybissoli.com/icon.png",
          mimeType: "image/png",
          sizes: ["512x512"],
        },
      ],
    },
    { instructions: SERVER_CONFIG.instructions },
  );

  // server/discover anuncia todas as revisões atendidas, não só as modernas —
  // ver src/discover.ts. Antes das tools: se o SDK mudar por baixo, o servidor
  // falha ao construir e não meio-construído.
  announceServedVersions(server);

  registerCatalogTools(server, env, record);
  registerMetadataTools(server, env, record);
  registerDataTools(server, env, record);
  // search/fetch — the ChatGPT Deep Research contract; the only tools without
  // the ilo_ prefix (src/tools/deep-research.ts).
  registerDeepResearchTools(server, env, record);
  registerResources(server);
  registerPrompts(server);

  return server;
}
