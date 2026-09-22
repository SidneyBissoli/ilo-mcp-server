/**
 * Catálogo de dataflows em D1 — busca de indicadores 100% local (sem chamada ao
 * upstream por consulta; medição do spike: 1.210 dataflows / 557 KB). Sem D1
 * (runtime stdio, src/cli.ts), delega ao catálogo em memória (catalog-memory.ts).
 *
 * Seed: scripts/seed-catalog.mjs gera o SQL a partir do catálogo oficial
 * (`/dataflow/ILO?detail=allstubs`) e grava também o instante real da extração em
 * `catalog_meta` — é esse `retrieved_at` que o bloco de proveniência reporta
 * (respostas do catálogo são sempre served_from_cache=true).
 */

import type { Env } from "../types.js";
import { IlostatUserError } from "./key.js";
import { expandQuery, vocabularyNotes } from "./vocabulary.js";

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
  /** Termos que a tabela de vocabulário traduziu para a palavra da OIT. */
  notes: string[];
}

export interface CatalogListing {
  entries: CatalogEntry[];
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
 *
 * Cada termo vira um OR das grafias que a OIT usa para ele (src/ilostat/vocabulary.ts):
 * quem escreve "labor" ou "wages" casa "labour" e "earnings" em vez de receber
 * zero calado. O `notes` devolvido diz quando isso aconteceu.
 */
/**
 * Um termo expandido vira o WHERE que casa o INÍCIO de uma palavra.
 *
 * Era `LIKE '%p%'` até a 0.6.x — e `LIKE '%p%'` É o casamento sem fronteira, que
 * inventa resultado sem dar erro. O caso caro deste catálogo: `male` casa dentro
 * de `female`, então perguntar por homens trazia mulheres, calado. A mesma
 * classe medida em 22/09/2026 no IBGE (`uber` dentro de `TUBÉRCULOS`, `idade`
 * dentro de `atividade`) e corrigida em `@sbissoli/mcp-search` 0.6.0 para quem
 * casa em memória. Aqui o filtro vai para o D1, então o conserto tem de ser em
 * SQL — e os dois caminhos deste servidor (D1 e `CATALOG_MEMORY`) precisam
 * responder igual, senão a resposta muda com o transporte.
 *
 * `GLOB 'p*'` = começa o texto; `GLOB '*[^a-z0-9]p*'` = vem logo depois de algo
 * que não é letra nem dígito. Juntos: começa uma palavra. Só no início, de
 * propósito — a tabela de vocabulário guarda radicais (`labour`, `child`) que
 * precisam alcançar `labour force` e `children`.
 *
 * `LIKE` não serviria: a fronteira precisa de classe de caracteres, que `LIKE`
 * não tem. E `GLOB` não tem caractere de escape, então `*`, `?` e `[` saem do
 * padrão — `patterns[0]` é o texto que o USUÁRIO digitou. Padrão que fica vazio
 * depois disso não pode virar `GLOB '*'`, que casaria o catálogo inteiro.
 */
function termToSql(patterns: readonly string[], params: string[]): string {
  const conds = patterns.flatMap((p) => {
    const limpo = p.replace(/[*?[\]]/g, "");
    if (!limpo) return [];
    params.push(`${limpo}*`, `*[^a-z0-9]${limpo}*`);
    const inicio = params.length - 1;
    const apos = params.length;
    return [
      `name_lc GLOB ?${inicio} OR name_lc GLOB ?${apos} ` +
        `OR id_lc GLOB ?${inicio} OR id_lc GLOB ?${apos}`,
    ];
  });
  // Consulta feita só de metacaractere não casa nada, em vez de casar tudo.
  return conds.length ? conds.join(" OR ") : "0 = 1";
}

export async function searchCatalog(
  env: Env,
  query: string,
  limit: number,
  offset = 0,
): Promise<CatalogSearchResult> {
  // Runtime stdio (sem D1): catálogo em memória com a mesma semântica de busca.
  if (!env.CATALOG_DB && env.CATALOG_MEMORY) return env.CATALOG_MEMORY.search(query, limit, offset);
  const db = requireDb(env);
  const expanded = expandQuery(query);
  if (!expanded.length) {
    throw new IlostatUserError("Empty query: pass one or more search terms (e.g. \"unemployment rate\").");
  }

  const params: string[] = [];
  const where = expanded.map((t) => `(${termToSql(t.patterns, params)})`).join(" AND ");

  const [rows, count, retrievedAt] = await Promise.all([
    db
      .prepare(
        `SELECT id, agency, version, name FROM dataflows WHERE ${where} ` +
          `ORDER BY search_weight DESC, id LIMIT ${Math.max(1, Math.min(limit, 100))} ` +
          `OFFSET ${Math.max(0, Math.floor(offset))}`,
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
    notes: vocabularyNotes(expanded),
  };
}

/**
 * O catálogo inteiro (~1.200 linhas, ~100 KB) — alimenta o índice em memória de
 * `search`/`fetch` (src/tools/deep-research.ts), que ranqueia por relevância em
 * vez do AND de substrings desta busca. Mesma origem e mesmo `retrieved_at`.
 */
export async function listCatalog(env: Env): Promise<CatalogListing> {
  if (!env.CATALOG_DB && env.CATALOG_MEMORY) return env.CATALOG_MEMORY.all();
  const db = requireDb(env);
  const [rows, retrievedAt] = await Promise.all([
    db.prepare("SELECT id, agency, version, name FROM dataflows ORDER BY id").all<CatalogEntry>(),
    catalogMeta(db, "retrieved_at"),
  ]);
  if (!retrievedAt) {
    throw new Error("catálogo D1 sem catalog_meta.retrieved_at — rodar o seed (scripts/seed-catalog.mjs)");
  }
  return { entries: rows.results ?? [], retrievedAt, sourceUrl: CATALOG_SOURCE_URL };
}
