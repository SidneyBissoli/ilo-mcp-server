/**
 * Catálogo de dataflows em memória — alternativa ao D1 para o runtime stdio
 * (src/cli.ts), onde não há bindings da Cloudflare.
 *
 * Mesma semântica de busca de src/ilostat/catalog.ts (D1): termos em AND,
 * case-insensitive, sobre nome e id; ordenação por SEARCH_WEIGHT desc, id asc;
 * paginação por limit/offset. O catálogo é baixado do endpoint oficial na
 * primeira busca (lazy) e o `retrieved_at` reportado é o instante REAL desse
 * download — o mesmo contrato do seed do D1.
 */

import { CATALOG_SOURCE_URL, type CatalogEntry, type CatalogListing, type CatalogSearchResult } from "./catalog.js";
import { IlostatUserError } from "./key.js";
import { nowIso, upstreamHeaders } from "./sdmx.js";

const STRUCTURE_JSON = "application/vnd.sdmx.structure+json";

interface RawDataflow {
  id: string;
  agencyID?: string;
  version?: string;
  name?: string;
  names?: { en?: string };
  annotations?: Array<{ id?: string; type?: string; title?: string; text?: string }>;
}

export interface CatalogRow extends CatalogEntry {
  idLc: string;
  nameLc: string;
  searchWeight: number;
}

/** Converte a mensagem `/dataflow/ILO?detail=allstubs` nas linhas do catálogo. */
export function catalogRowsFromMessage(msg: unknown): CatalogRow[] {
  const dataflows = ((msg as { data?: { dataflows?: RawDataflow[] } }).data?.dataflows ?? []) as RawDataflow[];
  return dataflows.map((df) => {
    const name = df.name ?? df.names?.en ?? df.id;
    const a = (df.annotations ?? []).find((x) => (x.type ?? x.id) === "SEARCH_WEIGHT");
    const w = Number(a?.title ?? a?.text);
    return {
      id: df.id,
      agency: df.agencyID ?? "ILO",
      version: df.version ?? "1.0",
      name,
      idLc: df.id.toLowerCase(),
      nameLc: name.toLowerCase(),
      searchWeight: Number.isFinite(w) ? w : 0,
    };
  });
}

/** Busca com a mesma semântica da consulta SQL do D1. */
export function searchRows(rows: CatalogRow[], query: string, limit: number, offset: number): { entries: CatalogEntry[]; total: number } {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) {
    throw new IlostatUserError("Empty query: pass one or more search terms (e.g. \"unemployment rate\").");
  }
  const matching = rows
    .filter((r) => terms.every((t) => r.nameLc.includes(t) || r.idLc.includes(t)))
    .sort((a, b) => b.searchWeight - a.searchWeight || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const lim = Math.max(1, Math.min(limit, 100));
  const off = Math.max(0, Math.floor(offset));
  return {
    entries: matching.slice(off, off + lim).map(({ id, agency, version, name }) => ({ id, agency, version, name })),
    total: matching.length,
  };
}

export class InMemoryCatalog {
  private loaded: Promise<{ rows: CatalogRow[]; retrievedAt: string }> | null = null;

  constructor(private readonly loader: () => Promise<unknown> = defaultLoader) {}

  private load() {
    this.loaded ??= this.loader().then((msg) => {
      const rows = catalogRowsFromMessage(msg);
      if (rows.length < 100) throw new Error(`catálogo suspeito: só ${rows.length} dataflows`);
      return { rows, retrievedAt: nowIso() };
    });
    // Falha no download não fica presa: a próxima busca tenta de novo.
    this.loaded.catch(() => {
      this.loaded = null;
    });
    return this.loaded;
  }

  async search(query: string, limit: number, offset = 0): Promise<CatalogSearchResult> {
    const { rows, retrievedAt } = await this.load();
    return { ...searchRows(rows, query, limit, offset), retrievedAt, sourceUrl: CATALOG_SOURCE_URL };
  }

  /** O catálogo inteiro — o mesmo contrato de `listCatalog` sobre o D1. */
  async all(): Promise<CatalogListing> {
    const { rows, retrievedAt } = await this.load();
    return {
      entries: rows.map(({ id, agency, version, name }) => ({ id, agency, version, name })),
      retrievedAt,
      sourceUrl: CATALOG_SOURCE_URL,
    };
  }
}

async function defaultLoader(): Promise<unknown> {
  const res = await fetch(CATALOG_SOURCE_URL, { headers: upstreamHeaders(STRUCTURE_JSON) });
  if (!res.ok) throw new Error(`ILOSTAT catalogue HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return await res.json();
}
