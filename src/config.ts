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
  name: "ilo-mcp-server",
  /** Versão do servidor — manter em sincronia com package.json. */
  version: "0.3.0",
  /** Título de exibição (clientes MCP mostram ao usuário). */
  title: "ILO Labour Statistics (ILOSTAT)",
  /** Uma frase: o que o servidor serve e de qual fonte. */
  description:
    "MCP server for ILOSTAT, the International Labour Organization's statistical database: " +
    "search 1,200+ indicator dataflows and retrieve labour statistics by country, year, sex " +
    "and age — every response carries a deterministic provenance and attribution block.",
  /**
   * Contato exibido na landing page. A URL raiz do Worker é o que sysadmins upstream
   * veem no User-Agent — precisa resolver para identificação humana + contato.
   */
  contactName: "Sidney da S. P. Bissoli",
  contactEmail: "sbissoli76@gmail.com",
  /** Rota do endpoint MCP (Streamable HTTP). */
  mcpRoute: "/mcp",
  /**
   * Instruções do handshake MCP: o que o servidor cobre e quando o cliente NÃO deve
   * usá-lo (critério do diretório Anthropic).
   */
  instructions:
    "Labour statistics from ILOSTAT (International Labour Organization) via the official " +
    "SDMX API: unemployment, employment, wages, working time and related indicators, by " +
    "country, year and disaggregations such as sex and age. Typical flow: " +
    "ilo_search_indicators to find a dataflow, then ilo_get_data with country and period " +
    "filters; use ilo_get_indicator_metadata / ilo_list_dimension_values to discover valid " +
    "filter codes. Resources ilostat://guide (code conventions, limits) and " +
    "ilostat://reference/key-dataflows (verified dataflow ids by topic) save discovery calls; " +
    "prompts ilo_country_labour_profile, ilo_compare_countries and ilo_indicator_trend are " +
    "ready-made workflows. Do not use this server for non-labour statistics (education, " +
    "health, trade) or for data not published by the ILO.",
  /**
   * Hostnames aceitos no header Host. A lista SUBSTITUI os defaults do
   * createMcpHandler (localhost e *.workers.dev) — por isso inclui também o
   * hostname workers.dev e os de dev local, além do domínio próprio.
   */
  extraAllowedHostnames: [
    "ilo.sidneybissoli.com",
    "ilo-mcp-server.sidneybissoli.workers.dev",
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
  /** Teto de áreas (REF_AREA) por chamada de ilo_get_data — decisão do decisor, 07/08/2026. */
  maxAreasPerCall: 30,
  /** TTL do cache KV de codelists (7 dias — codelists mudam raramente). */
  codelistTtlSeconds: 7 * 24 * 3600,
  /** TTL do cache KV de estrutura de dataflow (24 h — fonte do data_vintage). */
  structureTtlSeconds: 24 * 3600,
} as const;
