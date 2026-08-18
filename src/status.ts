/**
 * Payload público de liveness/status (GET /status): versão do servidor + metadados
 * reais do último deploy (binding version_metadata), para que registries, monitores
 * e usuários verifiquem que o servidor está de pé e em qual build — sem o handshake
 * MCP — e para que os badges do README reflitam o código deployado, não texto
 * digitado. O bloco deploy é omitido quando o binding está ausente (dev local/testes).
 */

import { CONTRACT_VERSION } from "@sbissoli/mcp-provenance";
import { SERVER_CONFIG } from "./config.js";
import { TOOL_NAMES } from "./tools/index.js";
import type { Env } from "./types.js";

export function buildStatus(env: Env) {
  const meta = env.CF_VERSION_METADATA;
  return {
    status: "ok" as const,
    name: SERVER_CONFIG.name,
    version: SERVER_CONFIG.version,
    mcp: SERVER_CONFIG.mcpRoute,
    /** Contagem/nomes das tools e versão do contrato de proveniência — lidos pelos
     *  badges dinâmicos do README (shields.io dynamic/json), por isso ficam aqui. */
    tools: TOOL_NAMES.length,
    tool_names: [...TOOL_NAMES],
    provenance_contract: CONTRACT_VERSION,
    ...(meta
      ? { deploy: { id: meta.id, tag: meta.tag || null, timestamp: meta.timestamp } }
      : {}),
  };
}
