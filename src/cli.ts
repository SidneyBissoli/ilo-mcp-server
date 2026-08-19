#!/usr/bin/env node
/**
 * Runtime stdio local — o MESMO servidor (buildServer) sem a Cloudflare no
 * caminho: fala direto com a API SDMX oficial do ILOSTAT.
 *
 * Diferenças em relação ao Worker hospedado, todas por ausência de binding:
 *  - cache SDMX em memória do processo (KV → Map com TTL): estruturas e
 *    codelists são reaproveitadas dentro da sessão, não entre sessões;
 *  - catálogo de busca em memória (D1 → download do endpoint oficial na
 *    primeira busca; `retrieved_at` real desse download);
 *  - sem estatísticas de uso, sem rate limit, sem auth (não há rede de entrada).
 * Tools, validações, limites e o bloco de proveniência são idênticos.
 *
 * Logs vão para stderr — stdout é exclusivo do JSON-RPC.
 */

import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { SERVER_CONFIG } from "./config.js";
import { InMemoryCatalog } from "./ilostat/catalog-memory.js";
import { SDMX_BASE } from "./ilostat/sdmx.js";
import { buildServer } from "./server.js";
import type { Env, SdmxCache } from "./types.js";

/** Cache em memória com a forma do KV que o código do servidor usa (get json / put com TTL). */
export class MemoryCache implements SdmxCache {
  private readonly store = new Map<string, { value: string; expiresAt: number | null }>();

  async get<T>(key: string, _type: "json"): Promise<T | null> {
    const hit = this.store.get(key);
    if (!hit) return null;
    if (hit.expiresAt !== null && hit.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return JSON.parse(hit.value) as T;
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    const ttl = options?.expirationTtl;
    this.store.set(key, { value, expiresAt: ttl ? Date.now() + ttl * 1000 : null });
  }
}

export function localEnv(): Env {
  return { SDMX_CACHE: new MemoryCache(), CATALOG_MEMORY: new InMemoryCatalog() };
}

async function main(): Promise<void> {
  const server = buildServer(localEnv());
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`${SERVER_CONFIG.name} ${SERVER_CONFIG.version} — stdio, upstream ${SDMX_BASE}`);
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
