/**
 * Proveniência ILOSTAT — contexto único do servidor + builder da fonte.
 *
 * Base legal (docs/02 do projeto, verificada em 04/08/2026): dados e metadados
 * do ILOSTAT sob CC BY 4.0 desde 03/05/2023; atribuição ILO obrigatória em toda
 * resposta; sem logo da OIT.
 *
 * Regra de `derived` (decisão do decisor, 07/08/2026): conversão de unidade e
 * arredondamento NÃO contam como derivação (`derived=false` + nota documentando);
 * `derived=true` fica reservado a transformação real (agregação, taxa calculada
 * pelo servidor). O MVP não transforma nada: `derived` é sempre false.
 */

import { createProvenanceContext, type CanonicalProvenance } from "@sbissoli/mcp-provenance";
import { PROVENANCE_OPTIONS } from "../config.js";
import { ILOSTAT_AGENCY, SDMX_BASE } from "./sdmx.js";

export const provenance = createProvenanceContext(PROVENANCE_OPTIONS);

export const ILOSTAT_LICENSE = {
  id: "CC-BY-4.0",
  name: "Creative Commons Attribution 4.0 International",
  url: "https://creativecommons.org/licenses/by/4.0/",
  terms_url: "https://www.ilo.org/rights-and-permissions",
  /** Data da verificação verbatim da licença (docs/02 do projeto). */
  verified_at: "2026-08-04",
} as const;

/** Atribuição ILO no formato exigido, com a data de extração real. */
export function ilostatCitation(retrievedAtIso: string): string {
  return `International Labour Organization, ILOSTAT, https://ilostat.ilo.org/data/, accessed ${retrievedAtIso.slice(0, 10)}.`;
}

export interface IlostatProvenanceInput {
  dataset?: { id: string; version: string | null; name: string | null } | null;
  dimensionKey?: Record<string, string> | null;
  dataVintage?: string | null;
  retrievedAt: string;
  sourceUrl: string;
  servedFromCache?: boolean | null;
  notices?: string[];
}

/** Bloco canônico v1.0 para uma resposta do ILOSTAT. */
export function ilostatProvenance(input: IlostatProvenanceInput): CanonicalProvenance {
  return provenance.build({
    source: { name: "ILOSTAT", agency: ILOSTAT_AGENCY, database: "ILOSTAT", endpoint: SDMX_BASE },
    dataset: input.dataset ?? null,
    dimension_key: input.dimensionKey ?? null,
    data_vintage: input.dataVintage ?? null,
    retrieved_at: input.retrievedAt,
    source_url: input.sourceUrl,
    license: ILOSTAT_LICENSE,
    citation: ilostatCitation(input.retrievedAt),
    ...(input.notices?.length ? { notices: input.notices } : {}),
    served_from_cache: input.servedFromCache ?? null,
  });
}

/**
 * O bloco de proveniência como extras de envelope — `structuredContent`
 * ({provenance, attribution}) e `_meta` — sem o texto ao leitor. É como a
 * proveniência viaja em `search`/`fetch` (src/tools/deep-research.ts), cujo
 * `content` é o JSON do contrato Deep Research, sem rodapé.
 */
export function provenanceExtras(p: CanonicalProvenance): {
  structured: Record<string, unknown>;
  meta: Record<string, unknown>;
} {
  const { structuredContent, _meta } = provenance.result({}, p);
  return { structured: structuredContent, meta: _meta };
}
