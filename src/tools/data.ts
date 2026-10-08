/**
 * ilo_get_data — a tool central: dados estatísticos de um dataflow, com recorte
 * obrigatório (teto de 30 áreas, decisão do decisor 07/08/2026) e bloco de
 * proveniência com a chave de dimensões da consulta.
 *
 * Consulta típica = 1 chamada REST (a estrutura, fonte do data_vintage, vem do
 * cache KV). Dados nunca são cacheados no MVP.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { buildDataKey } from "../ilostat/key.js";
import type { ObservationRow } from "../ilostat/parser.js";
import { ILOSTAT_VALUES_REVISION, ilostatProvenance, provenance } from "../ilostat/provenance.js";
import { fetchData, getDataflowStructure } from "../ilostat/sdmx.js";
import type { Env } from "../types.js";
import type { RecordUsage } from "../usage-core.js";
import { withUsage } from "../usage-wrap.js";
import { withToolErrors } from "./errors.js";
import { PROVENANCE_MODE_SCHEMA, provenanceOutputShape } from "./shared.js";

export const GET_DATA = "ilo_get_data";

/** Um código de dimensão ou uma lista deles. */
const CODIGOS_DE_DIMENSAO = z.union([z.string(), z.array(z.string()).min(1)]);

/** Rótulo do período para o dimension_key (a chave SDMX não carrega o período). */
export function timePeriodLabel(
  start: string | undefined,
  end: string | undefined,
  lastN: number | undefined,
): string | null {
  if (start || end) return `${start ?? ""}-${end ?? ""}`;
  if (lastN !== undefined) return `last ${lastN} observation(s)`;
  return null;
}

/**
 * Atributos que viram aviso: OBS_STATUS (o canal de status/disclaimer do SDMX —
 * ex.: "Break in series") e, desde 04/10/2026, a unidade e a escala
 * (UNIT_MEASURE, UNIT_MULT — ex.: "Thousands"). O número da linha só se lê
 * certo com a escala. A escala viaja SEMPRE nas linhas; `notices` só aparece no
 * modo `detailed` da proveniência (o `concise` não a projeta — contrato do
 * `@sbissoli/mcp-provenance`), onde resume a escala da resposta inteira.
 * Atributos técnicos (DECIMALS, SOURCE etc.) ficam só nas linhas.
 */
export const NOTICE_ATTRIBUTES = ["OBS_STATUS", "UNIT_MEASURE", "UNIT_MULT"] as const;

/** Avisos da origem: valores distintos dos NOTICE_ATTRIBUTES, verbatim + contagem. */
export function noticesFromRows(rows: ObservationRow[]): string[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const attr of NOTICE_ATTRIBUTES) {
      const v = row.attributes?.[attr];
      if (!v) continue;
      const label = `${attr} ${v.id ?? "?"}${v.name ? ` (${v.name})` : ""}`;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  return [...counts.entries()].map(([label, n]) => `${label}: ${n} observation(s)`).sort();
}

export function getDataHandler(env: Env) {
  return withToolErrors(
    async (args: {
      dataflow: string;
      filters?: Record<string, string | string[]> | undefined;
      start_period?: string | undefined;
      end_period?: string | undefined;
      last_n_observations?: number | undefined;
      provenance_mode?: "concise" | "detailed" | undefined;
    }) => {
      const { structure } = await getDataflowStructure(env, args.dataflow);
      const { key, effectiveFilters } = buildDataKey(structure, args.filters ?? {});
      const { parsed, retrievedAt, sourceUrl } = await fetchData(structure, key, {
        startPeriod: args.start_period,
        endPeriod: args.end_period,
        lastNObservations: args.last_n_observations,
      });

      const rows = parsed.rows.map((r) => ({
        ...r.dimensions,
        value: r.value,
        ...(r.attributes ? { attributes: r.attributes } : {}),
      }));
      const notices = noticesFromRows(parsed.rows);

      const data = {
        dataflow: { id: structure.id, version: structure.version, name: structure.name },
        columns: [...parsed.dimensionIds, "value"],
        rows_count: rows.length,
        rows,
        ...(rows.length === 0
          ? {
              hint:
                "No observations for this selection. Check the codes with ilo_list_dimension_values " +
                "and the period with start_period/end_period — some series do not cover all areas or years.",
            }
          : {}),
      };

      const timeLabel = timePeriodLabel(args.start_period, args.end_period, args.last_n_observations);
      const p = ilostatProvenance({
        dataset: { id: structure.id, version: structure.version, name: structure.name },
        dimensionKey: {
          ...effectiveFilters,
          ...(timeLabel && structure.timeDimension ? { [structure.timeDimension]: timeLabel } : {}),
        },
        dataVintage: structure.dataVintage,
        retrievedAt,
        sourceUrl,
        servedFromCache: false,
        notices,
        revision: ILOSTAT_VALUES_REVISION,
      });
      const r = provenance.result(data, p, { mode: args.provenance_mode ?? "concise" });
      return { ...r, structuredContent: { ...r.structuredContent, ...data } };
    },
  );
}

export function registerDataTools(server: McpServer, env: Env, record: RecordUsage): void {
  server.registerTool(
    GET_DATA,
    {
      title: "Get ILOSTAT data",
      description:
        "Statistical observations from one ILOSTAT dataflow, filtered by dimension codes " +
        "(filters, e.g. {\"REF_AREA\": [\"BRA\",\"ARG\"], \"SEX\": \"SEX_T\"}) and period " +
        "(start_period/end_period, e.g. \"2015\"/\"2024\"). REF_AREA is required, maximum 30 areas " +
        "per call — for broad panels, split areas into batches and/or paginate by period. " +
        "Unfiltered dimensions return all their categories. Does not aggregate, convert or " +
        "otherwise transform values (raw ILOSTAT data only): read each value with the unit and " +
        "multiplier the ILO states in its row attributes (UNIT_MEASURE, UNIT_MULT — e.g. " +
        "UNIT_MULT 3 = thousands). Read TIME_PERIOD with the FREQ column (annual, quarterly or monthly) and " +
        "OBS_STATUS when present (break in series, estimated or provisional value). Values are the current " +
        "release, dated by data_vintage (the dataflow LAST_UPDATE): the ILO revises published figures and " +
        "re-estimates modelled series (_2 ids) at each release, past years included. Does not search " +
        "indicators (use ilo_search_indicators).",
      inputSchema: z.object({
        dataflow: z.string().min(1).describe('Dataflow id from ilo_search_indicators (e.g. "DF_UNE_DEAP_SEX_AGE_RT")'),
        // REF_AREA é exigência ESTRUTURAL, e não só de prosa, desde 11/09/2026.
        // A descrição já dizia "REF_AREA is required" nas duas pontas, e mesmo
        // assim a forma de chamada mais frequente era `{dataflow}` sozinho:
        // 57 erros em 99 chamadas em 28 dias, a maioria com essa forma exata.
        // Modelo lê o `required` do esquema, que dizia só `dataflow`. Agora o
        // esquema publica o que a fonte cobra — e a chamada que ele passa a
        // recusar é exatamente a que já falhava 100% das vezes, então nenhuma
        // chamada que funcionava deixa de funcionar.
        filters: z
          .object({
            REF_AREA: CODIGOS_DE_DIMENSAO.describe(
              'Area codes — REQUIRED, at most 30 per call (e.g. ["BRA","ARG"]). ' +
                "Without them the ILO gateway times out (HTTP 504). " +
                "Discover codes with ilo_list_dimension_values (dimension REF_AREA).",
            ),
          })
          .catchall(CODIGOS_DE_DIMENSAO)
          .describe(
            "Dimension id → code or list of codes (from ilo_list_dimension_values). " +
              "REF_AREA is required (up to 30 area codes); any other dimension is optional " +
              "and, left out, returns all of its categories.",
          ),
        start_period: z.string().min(1).optional().describe('First period, e.g. "2015"'),
        end_period: z.string().min(1).optional().describe('Last period, e.g. "2024"'),
        last_n_observations: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Alternative to periods: only the latest N observations per series"),
        provenance_mode: PROVENANCE_MODE_SCHEMA,
      }).strict(),
      outputSchema: z.looseObject({
        dataflow: z.object({ id: z.string(), version: z.string(), name: z.string().nullable() }),
        columns: z.array(z.string()),
        rows_count: z.number(),
        rows: z.array(z.record(z.string(), z.unknown())),
        ...provenanceOutputShape(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    withUsage(GET_DATA, record, getDataHandler(env)),
  );
}
