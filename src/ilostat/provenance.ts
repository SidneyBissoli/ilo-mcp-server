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

import { createProvenanceContext, type CanonicalProvenance, type Revision } from "@sbissoli/mcp-provenance";
import { PROVENANCE_OPTIONS } from "../config.js";
import { ILOSTAT_AGENCY, SDMX_BASE } from "./sdmx.js";
import { currentRetrieval } from "./upstream.js";

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
  /** Padrão: `ILOSTAT_REVISION` (vigente, sem nota). */
  revision?: Revision;
}

/**
 * `revision` do contrato (v1.3), decisão do dono de 08/10/2026: `current` em toda
 * resposta — o ILOSTAT serve só a release vigente e pode revisá-la depois. `final`
 * não se usa, nem quando o OBS_STATUS da OIT marca o valor: isso exigiria prova
 * valor a valor (contrato §3) e é item futuro; o OBS_STATUS segue em `notices`,
 * verbatim. Enquanto o servidor emitir 1.2 a lib descarta a chave do fio; o
 * canônico já a carrega.
 */
export const ILOSTAT_REVISION: Revision = { status: "current", note: null };

/**
 * A mesma decisão, para respostas que trazem VALORES (`ilo_get_data`), com a nota
 * que o servidor já publica na descrição da tool e nas instructions
 * (`src/tools/data.ts`, `src/config.ts`), em versão curta. Catálogo, estrutura e
 * codelists não levam a nota: ela fala de valores.
 */
export const ILOSTAT_VALUES_REVISION: Revision = {
  status: "current",
  note:
    "Current ILOSTAT release, dated by data_vintage (the dataflow LAST_UPDATE): the ILO revises " +
    "published figures and re-estimates modelled series (_2 ids) at each release, past years included.",
};

/**
 * Bloco canônico para uma resposta do ILOSTAT. `retrieval` é o que o
 * coletor da chamada mediu (idas, tentativas, anomalias — `upstream.ts`);
 * `null` quando nada foi à origem (catálogo, acerto de KV) ou fora de um
 * coletor. `retrieved_at` continua sendo o instante da extração original,
 * vindo do KV no acerto — não é o do coletor.
 */
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
    retrieval: currentRetrieval(),
    revision: input.revision ?? ILOSTAT_REVISION,
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
