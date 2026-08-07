/**
 * Identidade e tunáveis do servidor — o arquivo central que uma instância nova edita
 * (junto com wrangler.jsonc e package.json). Os demais módulos leem daqui.
 *
 * Idioma do servidor: inglês (persona-alvo internacional — economistas do
 * desenvolvimento, pesquisadores de trabalho, jornalistas de dados; dados e
 * metadados da OIT são publicados em inglês). Fuso: UTC.
 */

import type { ProvenanceContextOptions } from "@sbissoli/mcp-provenance";

export const SERVER_CONFIG = {
  /** Nome curto do servidor (handshake MCP, /status, landing). */
  name: "ilostat-mcp",
  /** Versão do servidor — manter em sincronia com package.json. */
  version: "0.1.0",
  /** Título de exibição (clientes MCP mostram ao usuário). */
  title: "ILOSTAT & UNESCO UIS — International Statistics (provenance-first)",
  /** Uma frase: o que o servidor serve e de qual fonte. */
  description:
    "MCP server for two official statistical sources: ILOSTAT (International Labour " +
    "Organization — labour statistics) and the UNESCO Institute for Statistics (education, " +
    "science, culture and communication). Every response carries a deterministic provenance " +
    "and attribution block for its source; the two sources are never mixed in one response.",
  /**
   * Contato exibido na landing page. A URL raiz do Worker é o que sysadmins upstream
   * veem no User-Agent — precisa resolver para identificação humana + contato.
   */
  contactEmail: "sbissoli76@gmail.com",
  /** Rota do endpoint MCP (Streamable HTTP). */
  mcpRoute: "/mcp",
  /**
   * Instruções do handshake MCP: o que o servidor cobre e quando o cliente NÃO deve
   * usá-lo (critério do diretório Anthropic).
   */
  instructions:
    "Statistics from two official sources, each behind its own tools. ILOSTAT " +
    "(International Labour Organization): unemployment, employment, wages, working time — " +
    "flow: search_indicators to find a dataflow, then get_data with country and period " +
    "filters (get_indicator_metadata / list_dimension_values give valid filter codes). " +
    "UNESCO UIS: education, science/R&D, culture and communication indicators — flow: " +
    "uis_search_indicators to find an indicator code, uis_list_geo_units for country/region " +
    "codes, then uis_get_data. Never mix the two sources in one answer without citing each " +
    "source's own attribution block (ILOSTAT is CC BY 4.0; UIS is CC BY-SA 4.0). Do not use " +
    "this server for statistics published by neither organization (e.g. health, trade, GDP).",
  /**
   * Hostnames aceitos no header Host. A lista SUBSTITUI os defaults do
   * createMcpHandler (localhost e *.workers.dev) — por isso inclui também o
   * hostname workers.dev e os de dev local, além do domínio próprio.
   */
  extraAllowedHostnames: [
    "ilostat.sidneybissoli.com",
    "ilostat-mcp.sidneybissoli.workers.dev",
    "localhost",
    "127.0.0.1",
  ] as string[],
} as const;

/** Contexto de proveniência do servidor: namespace reverse-DNS próprio, inglês, UTC. */
export const PROVENANCE_OPTIONS: ProvenanceContextOptions = {
  metaNamespace: "com.sidneybissoli.ilostat",
  locale: "en",
  timezone: "utc",
};

/**
 * Rate limit de entrada por cliente (IP), aplicado às rotas não-públicas.
 * Token bucket em memória por isolate: proteção contra abuso acidental/burst, não um
 * limite global exato (recicla com o isolate; instâncias em POPs distintos não somam).
 */
export const RATE_LIMIT = {
  /** Burst máximo por cliente. */
  clientBurst: 20,
  /** Reposição de tokens por segundo por cliente. */
  clientRefillPerSec: 5,
  /** Teto de buckets rastreados por isolate (evicção FIFO ao estourar). */
  maxClientBuckets: 1000,
} as const;

/** Tunáveis do domínio ILOSTAT (decisões do spike/decisor — ver README). */
export const ILOSTAT_LIMITS = {
  /** Teto de áreas (REF_AREA) por chamada de get_data — decisão do decisor, 07/08/2026. */
  maxAreasPerCall: 30,
  /** TTL do cache KV de codelists (7 dias — codelists mudam raramente). */
  codelistTtlSeconds: 7 * 24 * 3600,
  /** TTL do cache KV de estrutura de dataflow (24 h — fonte do data_vintage). */
  structureTtlSeconds: 24 * 3600,
} as const;

/** Tunáveis do domínio UIS (medições do mini-spike, docs/06 do projeto). */
export const UIS_LIMITS = {
  /** Teto de indicadores por chamada de uis_get_data. */
  maxIndicatorsPerCall: 25,
  /**
   * Teto de registros devolvidos numa resposta (proteção do contexto do cliente
   * MCP — o upstream aceita até 100k). Acima disso: erro pedagógico com a
   * contagem real; nunca truncar silenciosamente (dado parcial apresentado como
   * completo viola o contrato anti-alucinação). Reavaliar com uso real.
   */
  maxRecordsPerResponse: 5000,
  /** TTL do cache KV da release corrente (/versions/default — fonte do data_vintage). */
  releaseTtlSeconds: 24 * 3600,
} as const;
