/**
 * Cliente da UIS Data API (api.uis.unesco.org) com cache KV da release corrente.
 *
 * Medições do mini-spike (docs/06 do projeto, 07/08/2026):
 *  - JSON puro (não SDMX): `{hints, records[], indicatorMetadata[]}`;
 *  - sem autenticação e sem rate limiting declarado; cache CloudFront agressivo
 *    keyed pela URL completa — por isso toda chamada de dados fixa `version`
 *    explícita (release corrente resolvida de /versions/default, KV TTL 24 h);
 *  - teto upstream de 100.000 registros por consulta (HTTP 400 pedagógico com a
 *    contagem exata — a mensagem é repassada ao cliente).
 */

import { UIS_LIMITS } from "../config.js";
import { IlostatUserError as UserError } from "../ilostat/key.js";
import type { Env } from "../types.js";

export const UIS_BASE = "https://api.uis.unesco.org/api/public";
export const UIS_API_VERSION = "1.0.2";

/** Erro do upstream UIS (não é uso errado da tool): status + trecho do corpo. */
export class UisUpstreamError extends Error {
  readonly status: number;
  constructor(status: number, context: string, bodySnippet: string) {
    super(`UNESCO UIS upstream HTTP ${status} (${context}): ${bodySnippet}`);
    this.name = "UisUpstreamError";
    this.status = status;
  }
}

/** ISO-8601 sem milissegundos (formato canônico do contrato de proveniência). */
function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

const USER_AGENT = "ilostat-mcp (https://ilostat.sidneybissoli.com; sbissoli76@gmail.com)";

export interface UisRelease {
  version: string;
  publicationDate: string;
  themes: Array<{ theme: string; lastUpdate: string; description: string }>;
}

export interface UisReleaseWithOrigin {
  release: UisRelease;
  retrievedAt: string;
  servedFromCache: boolean;
}

const RELEASE_KV_KEY = "uis:default-version";

interface Cached<T> {
  retrievedAt: string;
  value: T;
}

/**
 * Release corrente (`/versions/default`) — KV TTL 24 h. É a fonte do
 * `data_vintage` UIS e a `version` fixada em toda consulta de dados.
 */
export async function getDefaultRelease(env: Env): Promise<UisReleaseWithOrigin> {
  const hit = await env.SDMX_CACHE?.get<Cached<UisRelease>>(RELEASE_KV_KEY, "json");
  if (hit) return { release: hit.value, retrievedAt: hit.retrievedAt, servedFromCache: true };

  const url = `${UIS_BASE}/versions/default`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) {
    throw new UisUpstreamError(res.status, "default version", (await res.text()).slice(0, 300));
  }
  const body = (await res.json()) as {
    version: string;
    publicationDate: string;
    themeDataStatus?: Array<{ theme: string; lastUpdate: string; description: string }>;
  };
  const retrievedAt = nowIso();
  const release: UisRelease = {
    version: body.version,
    publicationDate: body.publicationDate,
    themes: body.themeDataStatus ?? [],
  };
  await env.SDMX_CACHE?.put(RELEASE_KV_KEY, JSON.stringify({ retrievedAt, value: release }), {
    expirationTtl: UIS_LIMITS.releaseTtlSeconds,
  });
  return { release, retrievedAt, servedFromCache: false };
}

export interface UisFootnote {
  type: string | null;
  subtype: string | null;
  value: string | null;
}

export interface UisRecord {
  indicatorId: string;
  geoUnit: string;
  year: number;
  value: number | null;
  magnitude: string | null;
  qualifier: string | null;
  footnotes?: UisFootnote[];
}

export interface UisDataQuery {
  indicators: string[];
  geoUnits?: string[] | undefined;
  start?: number | undefined;
  end?: number | undefined;
  footnotes?: boolean | undefined;
}

export interface UisDataWithOrigin {
  records: UisRecord[];
  retrievedAt: string;
  /** URL canônica que reproduz a consulta, com a release fixada (vai na proveniência). */
  sourceUrl: string;
  release: UisRelease;
}

/**
 * URL canônica de dados — sempre com `version` explícita (pinagem da release +
 * aproveitamento do cache CloudFront, que é keyed pela URL completa).
 */
export function uisDataUrl(query: UisDataQuery, version: string): string {
  const qs = new URLSearchParams();
  for (const ind of query.indicators) qs.append("indicator", ind);
  for (const g of query.geoUnits ?? []) qs.append("geoUnit", g);
  if (query.start !== undefined) qs.set("start", String(query.start));
  if (query.end !== undefined) qs.set("end", String(query.end));
  if (query.footnotes) qs.set("footnotes", "true");
  qs.set("version", version);
  return `${UIS_BASE}/data/indicators?${qs.toString()}`;
}

/** Dados nunca são cacheados: toda chamada é um fetch real ao upstream. */
export async function fetchUisData(env: Env, query: UisDataQuery): Promise<UisDataWithOrigin> {
  const { release } = await getDefaultRelease(env);
  const url = uisDataUrl(query, release.version);
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  const retrievedAt = nowIso();
  if (res.status === 400) {
    // O 400 do upstream é pedagógico (traz a contagem exata quando estoura o teto
    // de 100k registros) — repassa a mensagem e orienta os filtros da tool.
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new UserError(
      `${body?.message ?? "The UIS API rejected the query (HTTP 400)."} ` +
        "Narrow the query: fewer indicators, specific geo_units, or a shorter start/end year range.",
    );
  }
  if (!res.ok) {
    throw new UisUpstreamError(res.status, `data ${query.indicators.join(",")}`, (await res.text()).slice(0, 300));
  }
  const body = (await res.json()) as { records?: UisRecord[] };
  return { records: body.records ?? [], retrievedAt, sourceUrl: url, release };
}
