/**
 * Catálogo de dataflows em D1 — busca de indicadores 100% local (sem chamada ao
 * upstream por consulta; medição do spike: 1.210 dataflows / 557 KB).
 *
 * Seed: scripts/seed-catalog.mjs gera o SQL a partir do catálogo oficial
 * (`/dataflow/ILO?detail=allstubs`) e grava também o instante real da extração em
 * `catalog_meta` — é esse `retrieved_at` que o bloco de proveniência reporta
 * (respostas do catálogo são sempre served_from_cache=true).
 */

import type { Env } from "../types.js";
import { IlostatUserError } from "./key.js";

export interface CatalogEntry {
  id: string;
  agency: string;
  version: string;
  name: string;
}

export interface CatalogSearchResult {
  entries: CatalogEntry[];
  total: number;
  /** Instante real da extração do catálogo no upstream (gravado no seed). */
  retrievedAt: string;
  /** URL canônica do catálogo oficial. */
  sourceUrl: string;
}

export const CATALOG_SOURCE_URL = "https://sdmx.ilo.org/rest/dataflow/ILO?detail=allstubs";

function requireDb(env: Env): D1Database {
  if (!env.CATALOG_DB) {
    throw new Error("binding CATALOG_DB ausente — o catálogo D1 não foi provisionado");
  }
  return env.CATALOG_DB;
}

async function catalogMeta(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare("SELECT value FROM catalog_meta WHERE key = ?1").bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

/**
 * Busca por termos no nome/id do dataflow (AND entre termos, case-insensitive),
 * ordenada pelo peso de busca do próprio catálogo da OIT (annotation SEARCH_WEIGHT).
 */
export async function searchCatalog(env: Env, query: string, limit: number): Promise<CatalogSearchResult> {
  const db = requireDb(env);
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) {
    throw new IlostatUserError("Empty query: pass one or more search terms (e.g. \"unemployment rate\").");
  }

  const where = terms.map((_, i) => `(name_lc LIKE ?${i + 1} OR id_lc LIKE ?${i + 1})`).join(" AND ");
  const params = terms.map((t) => `%${t.replace(/[%_]/g, "")}%`);

  const [rows, count, retrievedAt] = await Promise.all([
    db
      .prepare(
        `SELECT id, agency, version, name FROM dataflows WHERE ${where} ` +
          `ORDER BY search_weight DESC, id LIMIT ${Math.max(1, Math.min(limit, 100))}`,
      )
      .bind(...params)
      .all<CatalogEntry>(),
    db
      .prepare(`SELECT COUNT(*) AS n FROM dataflows WHERE ${where}`)
      .bind(...params)
      .first<{ n: number }>(),
    catalogMeta(db, "retrieved_at"),
  ]);

  if (!retrievedAt) {
    throw new Error("catálogo D1 sem catalog_meta.retrieved_at — rodar o seed (scripts/seed-catalog.mjs)");
  }

  return {
    entries: rows.results ?? [],
    total: count?.n ?? 0,
    retrievedAt,
    sourceUrl: CATALOG_SOURCE_URL,
  };
}
