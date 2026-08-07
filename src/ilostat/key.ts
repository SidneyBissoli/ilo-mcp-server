/**
 * Montagem e validação da chave SDMX de consulta de dados.
 *
 * Regras vinculantes (spike + decisão do decisor, 07/08/2026):
 *  - NUNCA emitir consulta irrestrita (`/all`) — o upstream responde 504 após ~61 s;
 *  - teto de 30 áreas (REF_AREA) por chamada, com erro pedagógico pedindo
 *    recorte/paginação — sem fatiamento server-side no MVP;
 *  - FREQ não filtrada assume o default do dataflow (annotation DEFAULT) ou "A".
 */

import { ILOSTAT_LIMITS } from "../config.js";
import type { DataflowStructure } from "./structure.js";

/** Erro de uso da tool: mensagem pedagógica para o modelo/usuário, não bug do servidor. */
export class IlostatUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IlostatUserError";
  }
}

export interface DataKey {
  /** Chave posicional SDMX (ex.: `BRA+ARG.A..SEX_T.AGE_YTHADULT_YGE15`). */
  key: string;
  /** Valor efetivo por dimensão, na ordem do DSD (`*` = sem filtro). */
  effectiveFilters: Record<string, string>;
}

function asList(v: string | string[] | undefined): string[] {
  if (v === undefined) return [];
  return (Array.isArray(v) ? v : [v]).map((s) => s.trim()).filter(Boolean);
}

/**
 * Monta a chave posicional a partir dos filtros nomeados, validando contra a
 * estrutura do dataflow. Lança IlostatUserError com orientação de correção.
 */
export function buildDataKey(
  structure: DataflowStructure,
  filters: Record<string, string | string[]>,
): DataKey {
  const dimIds = structure.dimensions.map((d) => d.id);

  const unknown = Object.keys(filters).filter(
    (k) => !dimIds.includes(k) && k !== structure.timeDimension,
  );
  if (unknown.length) {
    throw new IlostatUserError(
      `Unknown dimension(s) for dataflow ${structure.id}: ${unknown.join(", ")}. ` +
        `Valid dimensions are: ${dimIds.join(", ")}. ` +
        `Use get_indicator_metadata to inspect the dataflow's dimensions.`,
    );
  }
  if (structure.timeDimension && filters[structure.timeDimension] !== undefined) {
    throw new IlostatUserError(
      `${structure.timeDimension} is not part of the SDMX key — use start_period/end_period instead.`,
    );
  }

  const parts: string[] = [];
  const effectiveFilters: Record<string, string> = {};
  for (const dim of structure.dimensions) {
    let values = asList(filters[dim.id]);

    if (dim.id === "REF_AREA") {
      if (!values.length) {
        throw new IlostatUserError(
          `REF_AREA is required: unrestricted queries time out at the ILO gateway (HTTP 504). ` +
            `Pass up to ${ILOSTAT_LIMITS.maxAreasPerCall} area codes (e.g. ["BRA","ARG"]) — ` +
            `for broad panels, split the areas into batches of ${ILOSTAT_LIMITS.maxAreasPerCall} ` +
            `and/or paginate by period (start_period/end_period). ` +
            `Use list_dimension_values with dimension REF_AREA to discover codes.`,
        );
      }
      if (values.length > ILOSTAT_LIMITS.maxAreasPerCall) {
        throw new IlostatUserError(
          `Too many areas: ${values.length} (maximum ${ILOSTAT_LIMITS.maxAreasPerCall} per call). ` +
            `Split the areas into batches of up to ${ILOSTAT_LIMITS.maxAreasPerCall} and/or ` +
            `narrow the period with start_period/end_period.`,
        );
      }
    }

    // FREQ sem filtro assume o default do dataflow (ou anual) — mantém a consulta limitada.
    if (dim.id === "FREQ" && !values.length) {
      values = [structure.defaults?.FREQ ?? "A"];
    }

    parts.push(values.join("+"));
    effectiveFilters[dim.id] = values.length ? values.join("+") : "*";
  }

  const key = parts.join(".");
  if (!key.replace(/\./g, "").length) {
    throw new IlostatUserError(
      "Query too broad: no dimension filter given. Filter at least REF_AREA " +
        "(the upstream rejects unrestricted queries with a gateway timeout).",
    );
  }
  return { key, effectiveFilters };
}
