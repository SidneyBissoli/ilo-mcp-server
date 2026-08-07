/**
 * Cliente SDMX REST do ILOSTAT com cache KV.
 *
 * Regras vinculantes (spike, Sessão 04):
 *  - JSON é negociado SÓ via header `Accept` — `?format=` é ignorado pelo
 *    endpoint e devolve SDMX-ML (XML);
 *  - codelists são cacheadas POR CODELIST (CL_MEASURE/CL_AREA compartilhadas
 *    entre dataflows — ~90% de economia de KV);
 *  - `retrieved_at` de tudo que é servido de cache é o instante REAL do fetch
 *    original (é a data de extração juridicamente relevante), preservado junto
 *    ao valor cacheado.
 */

import { ILOSTAT_LIMITS } from "../config.js";
import type { Env } from "../types.js";
import { IlostatUserError } from "./key.js";
import { parseSdmxData, type ParsedSdmxData } from "./parser.js";
import {
  parseCodelistMessage,
  parseStructureMessage,
  type Codelist,
  type CodelistRef,
  type DataflowStructure,
} from "./structure.js";

export const SDMX_BASE = "https://sdmx.ilo.org/rest";
export const ILOSTAT_AGENCY = "ILO";
const STRUCTURE_JSON = "application/vnd.sdmx.structure+json";
const DATA_JSON = "application/vnd.sdmx.data+json";

/** Erro do upstream (não é uso errado da tool): status + trecho do corpo. */
export class IlostatUpstreamError extends Error {
  readonly status: number;
  constructor(status: number, context: string, bodySnippet: string) {
    super(`ILOSTAT upstream HTTP ${status} (${context}): ${bodySnippet}`);
    this.name = "IlostatUpstreamError";
    this.status = status;
  }
}

/** ISO-8601 sem milissegundos (formato canônico do contrato de proveniência). */
export function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

interface Cached<T> {
  retrievedAt: string;
  value: T;
}

async function kvGet<T>(env: Env, key: string): Promise<Cached<T> | null> {
  if (!env.SDMX_CACHE) return null;
  return await env.SDMX_CACHE.get<Cached<T>>(key, "json");
}

function kvPut(env: Env, key: string, cached: Cached<unknown>, ttlSeconds: number): Promise<void> {
  if (!env.SDMX_CACHE) return Promise.resolve();
  return env.SDMX_CACHE.put(key, JSON.stringify(cached), { expirationTtl: ttlSeconds });
}

/**
 * User-Agent identificável (política do portfólio: sysadmins upstream devem
 * conseguir chegar ao contato). Sem User-Agent, o gateway da OIT responde 500.
 */
const USER_AGENT = "ilostat-mcp (https://ilostat.sidneybissoli.com; sbissoli76@gmail.com)";

async function fetchJson(url: string, accept: string, context: string): Promise<unknown> {
  const res = await fetch(url, { headers: { Accept: accept, "User-Agent": USER_AGENT } });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    throw new IlostatUpstreamError(res.status, context, body);
  }
  return await res.json();
}

export interface StructureWithOrigin {
  structure: DataflowStructure;
  retrievedAt: string;
  servedFromCache: boolean;
}

const structureKvKey = (dataflowId: string) => `structure:${ILOSTAT_AGENCY}:${dataflowId}`;
const codelistKvKey = (ref: CodelistRef) => `codelist:${ref.agency}:${ref.id}:${ref.version}`;

/** URL canônica da estrutura de um dataflow (vai no bloco de proveniência). */
export function structureUrl(dataflowId: string): string {
  return `${SDMX_BASE}/dataflow/${ILOSTAT_AGENCY}/${encodeURIComponent(dataflowId)}/latest?references=all`;
}

/** URL canônica de uma codelist (vai no bloco de proveniência). */
export function codelistUrl(ref: CodelistRef): string {
  return `${SDMX_BASE}/codelist/${ref.agency}/${encodeURIComponent(ref.id)}/${encodeURIComponent(ref.version)}`;
}

/**
 * Estrutura compacta do dataflow (KV, TTL 24 h). No miss, um único fetch
 * `?references=all` alimenta também o cache por-codelist.
 */
export async function getDataflowStructure(env: Env, dataflowId: string): Promise<StructureWithOrigin> {
  const hit = await kvGet<DataflowStructure>(env, structureKvKey(dataflowId));
  if (hit) return { structure: hit.value, retrievedAt: hit.retrievedAt, servedFromCache: true };

  const url = structureUrl(dataflowId);
  let msg: unknown;
  try {
    msg = await fetchJson(url, STRUCTURE_JSON, `structure of ${dataflowId}`);
  } catch (e) {
    if (e instanceof IlostatUpstreamError && e.status === 404) {
      throw new IlostatUserError(
        `Dataflow "${dataflowId}" not found at ILOSTAT. Use search_indicators to find valid dataflow ids.`,
      );
    }
    throw e;
  }
  const retrievedAt = nowIso();
  const { structure, codelists } = parseStructureMessage(msg);

  await kvPut(env, structureKvKey(dataflowId), { retrievedAt, value: structure }, ILOSTAT_LIMITS.structureTtlSeconds);
  // Alimenta o cache compartilhado por codelist — sem sobrescrever fetches anteriores
  // (o retrieved_at existente é mais antigo e continua válido; rewrite só desperdiça writes).
  for (const cl of codelists) {
    const ref: CodelistRef = { agency: cl.agency, id: cl.id, version: cl.version };
    const existing = await kvGet<Codelist>(env, codelistKvKey(ref));
    if (!existing) {
      await kvPut(env, codelistKvKey(ref), { retrievedAt, value: cl }, ILOSTAT_LIMITS.codelistTtlSeconds);
    }
  }

  return { structure, retrievedAt, servedFromCache: false };
}

export interface CodelistWithOrigin {
  codelist: Codelist;
  retrievedAt: string;
  servedFromCache: boolean;
}

/** Codelist por referência (KV, TTL 7 dias; compartilhada entre dataflows). */
export async function getCodelist(env: Env, ref: CodelistRef): Promise<CodelistWithOrigin> {
  const hit = await kvGet<Codelist>(env, codelistKvKey(ref));
  if (hit) return { codelist: hit.value, retrievedAt: hit.retrievedAt, servedFromCache: true };

  const url = codelistUrl(ref);
  const msg = await fetchJson(url, STRUCTURE_JSON, `codelist ${ref.id}`);
  const retrievedAt = nowIso();
  const codelist = parseCodelistMessage(msg)[0];
  if (!codelist) throw new Error(`codelist ${ref.id}: resposta sem codelist`);

  await kvPut(env, codelistKvKey(ref), { retrievedAt, value: codelist }, ILOSTAT_LIMITS.codelistTtlSeconds);
  return { codelist, retrievedAt, servedFromCache: false };
}

export interface DataQueryParams {
  startPeriod?: string | undefined;
  endPeriod?: string | undefined;
  lastNObservations?: number | undefined;
}

export interface DataWithOrigin {
  parsed: ParsedSdmxData;
  retrievedAt: string;
  /** URL REST canônica que reproduz a consulta (vai no bloco de proveniência). */
  sourceUrl: string;
}

/** URL canônica de dados — sempre com recorte; consulta irrestrita nunca é emitida. */
export function dataUrl(structure: DataflowStructure, key: string, params: DataQueryParams): string {
  const qs = new URLSearchParams();
  if (params.startPeriod) qs.set("startPeriod", params.startPeriod);
  if (params.endPeriod) qs.set("endPeriod", params.endPeriod);
  if (params.lastNObservations !== undefined) qs.set("lastNObservations", String(params.lastNObservations));
  const q = qs.toString();
  return (
    `${SDMX_BASE}/data/${structure.agency},${structure.id},${structure.version}/${key}` + (q ? `?${q}` : "")
  );
}

/** Dados nunca são cacheados no MVP: toda chamada é um fetch real ao upstream. */
export async function fetchData(
  structure: DataflowStructure,
  key: string,
  params: DataQueryParams,
): Promise<DataWithOrigin> {
  const url = dataUrl(structure, key, params);
  const res = await fetch(url, { headers: { Accept: DATA_JSON, "User-Agent": USER_AGENT } });
  const retrievedAt = nowIso();
  if (res.status === 404) {
    // SDMX REST: 404 NoResultsFound — recorte válido, mas sem observações.
    return {
      parsed: { rows: [], dimensionIds: structure.dimensions.map((d) => d.id), name: structure.name },
      retrievedAt,
      sourceUrl: url,
    };
  }
  if (res.status === 504) {
    throw new IlostatUserError(
      "The ILO gateway timed out (HTTP 504) — the query is too broad. Narrow it: fewer areas " +
        "(maximum 30 per call), a shorter period (start_period/end_period), or filter more dimensions.",
    );
  }
  if (!res.ok) {
    throw new IlostatUpstreamError(res.status, `data ${structure.id}/${key}`, (await res.text()).slice(0, 300));
  }
  const parsed = parseSdmxData(await res.json());
  return { parsed, retrievedAt, sourceUrl: url };
}
