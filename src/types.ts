import type { InMemoryCatalog } from "./ilostat/catalog-memory.js";
import type { UsageTracker } from "./usage.js";

/**
 * Subconjunto de KVNamespace usado pelo cache SDMX — o que o Worker liga é o KV
 * real; o runtime stdio (src/cli.ts) liga um cache em memória com a mesma forma.
 */
export interface SdmxCache {
  get<T>(key: string, type: "json"): Promise<T | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export interface Env {
  /** Bearer auth opcional (`wrangler secret put API_KEY`). Ausente = acesso aberto. */
  API_KEY?: string;
  /** Origin permitida no CORS do endpoint MCP. Default "*" (wrangler.jsonc). */
  ALLOWED_ORIGIN?: string;
  /**
   * Cache SDMX (KV): codelists por codelist (compartilhadas entre dataflows) e
   * meta de estrutura de dataflow. Opcional para dev/teste sem binding: sem ele,
   * toda chamada vai ao upstream.
   */
  SDMX_CACHE?: SdmxCache;
  /**
   * Catálogo de dataflows (D1) — busca de indicadores 100% local. Obrigatório em
   * produção; opcional aqui para que testes unitários construam o servidor sem D1.
   */
  CATALOG_DB?: D1Database;
  /**
   * Catálogo em memória (runtime stdio, sem D1): baixado do endpoint oficial na
   * primeira busca, com o retrieved_at real. Ignorado quando CATALOG_DB existe.
   */
  CATALOG_MEMORY?: InMemoryCatalog;
  /**
   * Durable Object de estatísticas de uso. Opcional para que testes e dev local rodem
   * sem o binding: sem ele, nada é registrado e /metrics responde com aviso.
   */
  USAGE?: DurableObjectNamespace<UsageTracker>;
  /**
   * Binding version_metadata (id/tag/timestamp do deploy). Opcional: GET /status
   * omite o bloco deploy quando ausente (dev local / testes).
   */
  CF_VERSION_METADATA?: { id: string; tag: string; timestamp: string };
  /**
   * Telemetria de tool calls no Analytics Engine (src/analytics.ts). Opcional:
   * sem o binding (dev local / testes / stdio), nada é gravado.
   */
  ANALYTICS?: AnalyticsEngineDataset;
  /**
   * Segredo do marcador de uso próprio (`wrangler secret put SELF_MARKER`):
   * requisições com o header x-mcp-self igual a ele ganham blob4="self" na
   * telemetria. Ausente = nenhuma requisição é marcada.
   */
  SELF_MARKER?: string;
  /**
   * Token temporário do claim no mcpindex.ai (`wrangler secret put
   * MCPINDEX_CHALLENGE`), servido em /.well-known/mcpindex-challenge durante a
   * janela de 15 min da verificação de posse. Ausente = a rota responde 404.
   */
  MCPINDEX_CHALLENGE?: string;
}
