/**
 * get_data — a tool central: dados estatísticos de um dataflow, com recorte
 * obrigatório (teto de 30 áreas, decisão do decisor 07/08/2026) e bloco de
 * proveniência v1.0 com a chave de dimensões da consulta.
 *
 * Consulta típica = 1 chamada REST (a estrutura, fonte do data_vintage, vem do
 * cache KV). Dados nunca são cacheados no MVP.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { buildDataKey } from "../ilostat/key.js";
import type { ObservationRow } from "../ilostat/parser.js";
import { ilostatProvenance, provenance } from "../ilostat/provenance.js";
import { fetchData, getDataflowStructure } from "../ilostat/sdmx.js";
import type { Env } from "../types.js";
import type { RecordUsage } from "../usage-core.js";
import { withUsage } from "../usage-wrap.js";
import { withToolErrors } from "./errors.js";
import { PROVENANCE_MODE_SCHEMA, provenanceOutputShape } from "./shared.js";

export const GET_DATA = "get_data";

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
 * Avisos da origem: valores distintos de OBS_STATUS (o canal de status/disclaimer
 * do SDMX — ex.: "Break in series"), verbatim + contagem. Atributos técnicos
 * (DECIMALS, SOURCE etc.) ficam nas linhas, não em notices.
 */
export function noticesFromRows(rows: ObservationRow[]): string[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const v = row.attributes?.OBS_STATUS;
    if (!v) continue;
    const label = `OBS_STATUS ${v.id ?? "?"}${v.name ? ` (${v.name})` : ""}`;
    counts.set(label, (counts.get(label) ?? 0) + 1);
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
                "No observations for this selection. Check the codes with list_dimension_values " +
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
        "otherwise transform values (raw ILOSTAT data only), and does not search indicators " +
        "(use search_indicators).",
      inputSchema: z.object({
        dataflow: z.string().min(1).describe('Dataflow id from search_indicators (e.g. "DF_UNE_DEAP_SEX_AGE_RT")'),
        filters: z
          .record(z.string(), z.union([z.string(), z.array(z.string()).min(1)]))
          .optional()
          .describe(
            "Dimension id → code or list of codes (from list_dimension_values). " +
              "REF_AREA is required (up to 30 area codes).",
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
      }),
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
