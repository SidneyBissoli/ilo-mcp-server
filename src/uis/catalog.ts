/**
 * Catálogo UIS em D1 (mesma database do catálogo ILOSTAT, tabelas próprias
 * `uis_indicators`/`uis_geounits`/`uis_meta`) — busca 100% local, sem chamada ao
 * upstream por consulta. Medição do mini-spike (docs/06): 5.063 indicadores em
 * 4 temas + 462 geo units.
 *
 * Seed: scripts/seed-uis-catalog.mjs grava também o instante REAL da extração e
 * a release corrente em `uis_meta` — é esse `retrieved_at` que o bloco de
 * proveniência reporta (respostas do catálogo são sempre served_from_cache=true).
 */

import { IlostatUserError as UserError } from "../ilostat/key.js";
import type { Env } from "../types.js";
import { UIS_BASE } from "./api.js";

export const UIS_THEMES = ["EDUCATION", "SCIENCE_TECHNOLOGY_INNOVATION", "CULTURE", "DEMOGRAPHIC_SOCIOECONOMIC"] as const;
export type UisTheme = (typeof UIS_THEMES)[number];

export const UIS_CATALOG_SOURCE_URL = `${UIS_BASE}/definitions/indicators`;
export const UIS_GEOUNITS_SOURCE_URL = `${UIS_BASE}/definitions/geounits`;

export interface UisIndicatorEntry {
  code: string;
  name: string;
  theme: string;
  last_data_update: string | null;
  record_count: number | null;
  year_min: number | null;
  year_max: number | null;
  geo_types: string | null;
}

export interface UisGeoUnitEntry {
  id: string;
  name: string;
  type: string;
}

interface UisCatalogMeta {
  retrievedAt: string;
  releaseVersion: string | null;
}

function requireDb(env: Env): D1Database {
  if (!env.CATALOG_DB) {
    throw new Error("binding CATALOG_DB ausente — o catálogo D1 não foi provisionado");
  }
  return env.CATALOG_DB;
}

async function uisMeta(db: D1Database): Promise<UisCatalogMeta> {
  const rows = await db
    .prepare("SELECT key, value FROM uis_meta WHERE key IN ('retrieved_at', 'release_version')")
    .all<{ key: string; value: string }>();
  const map = new Map((rows.results ?? []).map((r) => [r.key, r.value]));
  const retrievedAt = map.get("retrieved_at");
  if (!retrievedAt) {
    throw new Error("catálogo UIS sem uis_meta.retrieved_at — rodar o seed (scripts/seed-uis-catalog.mjs)");
  }
  return { retrievedAt, releaseVersion: map.get("release_version") ?? null };
}

export interface UisIndicatorSearchResult {
  entries: UisIndicatorEntry[];
  total: number;
  retrievedAt: string;
  releaseVersion: string | null;
  sourceUrl: string;
}

/**
 * Busca por termos no nome/código do indicador (AND entre termos,
 * case-insensitive), opcionalmente restrita a um tema; ordenada pela contagem de
 * registros disponíveis (proxy de proeminência — a API não publica peso de busca).
 */
export async function searchUisCatalog(
  env: Env,
  query: string,
  theme: UisTheme | undefined,
  limit: number,
): Promise<UisIndicatorSearchResult> {
  const db = requireDb(env);
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) {
    throw new UserError('Empty query: pass one or more search terms (e.g. "literacy rate youth").');
  }

  const conds = terms.map((_, i) => `(name_lc LIKE ?${i + 1} OR code_lc LIKE ?${i + 1})`);
  const params: string[] = terms.map((t) => `%${t.replace(/[%_]/g, "")}%`);
  if (theme) {
    conds.push(`theme = ?${params.length + 1}`);
    params.push(theme);
  }
  const where = conds.join(" AND ");

  const [rows, count, meta] = await Promise.all([
    db
      .prepare(
        `SELECT code, name, theme, last_data_update, record_count, year_min, year_max, geo_types ` +
          `FROM uis_indicators WHERE ${where} ` +
          `ORDER BY record_count DESC, code LIMIT ${Math.max(1, Math.min(limit, 100))}`,
      )
      .bind(...params)
      .all<UisIndicatorEntry>(),
    db
      .prepare(`SELECT COUNT(*) AS n FROM uis_indicators WHERE ${where}`)
      .bind(...params)
      .first<{ n: number }>(),
    uisMeta(db),
  ]);

  return {
    entries: rows.results ?? [],
    total: count?.n ?? 0,
    retrievedAt: meta.retrievedAt,
    releaseVersion: meta.releaseVersion,
    sourceUrl: UIS_CATALOG_SOURCE_URL,
  };
}

export interface UisGeoUnitSearchResult {
  entries: UisGeoUnitEntry[];
  total: number;
  retrievedAt: string;
  releaseVersion: string | null;
  sourceUrl: string;
}

/** Geo units (462 no total) — filtro opcional por texto e tipo (NATIONAL/REGIONAL). */
export async function searchUisGeoUnits(
  env: Env,
  search: string | undefined,
  type: "NATIONAL" | "REGIONAL" | undefined,
  limit: number,
): Promise<UisGeoUnitSearchResult> {
  const db = requireDb(env);
  const conds: string[] = [];
  const params: string[] = [];
  if (search) {
    params.push(`%${search.toLowerCase().replace(/[%_]/g, "")}%`);
    conds.push(`(name_lc LIKE ?${params.length} OR id = ?${params.length + 1})`);
    params.push(search.toUpperCase());
  }
  if (type) {
    params.push(type);
    conds.push(`type = ?${params.length}`);
  }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

  const [rows, count, meta] = await Promise.all([
    db
      .prepare(`SELECT id, name, type FROM uis_geounits ${where} ORDER BY name LIMIT ${Math.max(1, Math.min(limit, 500))}`)
      .bind(...params)
      .all<UisGeoUnitEntry>(),
    db
      .prepare(`SELECT COUNT(*) AS n FROM uis_geounits ${where}`)
      .bind(...params)
      .first<{ n: number }>(),
    uisMeta(db),
  ]);

  return {
    entries: rows.results ?? [],
    total: count?.n ?? 0,
    retrievedAt: meta.retrievedAt,
    releaseVersion: meta.releaseVersion,
    sourceUrl: UIS_GEOUNITS_SOURCE_URL,
  };
}
