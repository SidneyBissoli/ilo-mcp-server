import type { UsageTracker } from "./usage.js";

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
  SDMX_CACHE?: KVNamespace;
  /**
   * Catálogo de dataflows (D1) — busca de indicadores 100% local. Obrigatório em
   * produção; opcional aqui para que testes unitários construam o servidor sem D1.
   */
  CATALOG_DB?: D1Database;
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
}
