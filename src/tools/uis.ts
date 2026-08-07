/**
 * Tools UNESCO UIS — a segunda fonte do servidor, atrás de tools próprias
 * (`uis_*`) para que cada resposta carregue exatamente UM bloco de proveniência
 * (contrato v1.0, §Segregação: CC BY-SA da UIS nunca contamina respostas
 * ILOSTAT CC BY, e vice-versa).
 *
 *  - uis_search_indicators — catálogo local (D1), 5.063 indicadores em 4 temas;
 *  - uis_list_geo_units   — 462 códigos de país/região (D1);
 *  - uis_get_data         — dados via Data API, release fixada, footnotes.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { UIS_LIMITS } from "../config.js";
import { IlostatUserError as UserError } from "../ilostat/key.js";
import { provenance } from "../ilostat/provenance.js";
import { fetchUisData, type UisRecord } from "../uis/api.js";
import { searchUisCatalog, searchUisGeoUnits, UIS_THEMES, type UisTheme } from "../uis/catalog.js";
import { uisDataVintage, uisProvenance } from "../uis/provenance.js";
import type { Env } from "../types.js";
import type { RecordUsage } from "../usage-core.js";
import { withUsage } from "../usage-wrap.js";
import { withToolErrors } from "./errors.js";
import { PROVENANCE_MODE_SCHEMA, provenanceOutputShape } from "./shared.js";

export const UIS_SEARCH_INDICATORS = "uis_search_indicators";
export const UIS_LIST_GEO_UNITS = "uis_list_geo_units";
export const UIS_GET_DATA = "uis_get_data";

export function uisSearchIndicatorsHandler(env: Env) {
  return withToolErrors(
    async (args: {
      query: string;
      theme?: UisTheme | undefined;
      limit?: number | undefined;
      provenance_mode?: "concise" | "detailed" | undefined;
    }) => {
      const limit = args.limit ?? 20;
      const result = await searchUisCatalog(env, args.query, args.theme, limit);
      const data = {
        total_matches: result.total,
        showing: result.entries.length,
        indicators: result.entries.map((e) => ({
          code: e.code,
          name: e.name,
          theme: e.theme,
          last_data_update: e.last_data_update,
          records: e.record_count,
          years: e.year_min !== null && e.year_max !== null ? `${e.year_min}-${e.year_max}` : null,
          geo_types: e.geo_types,
        })),
        ...(result.total > result.entries.length
          ? { hint: `Showing the ${result.entries.length} largest of ${result.total} matches — add terms or a theme filter to narrow, or raise limit.` }
          : {}),
      };
      const p = uisProvenance({
        dataset: {
          id: "UIS indicator catalogue",
          version: result.releaseVersion,
          name: "UNESCO UIS catalogue of indicators",
        },
        retrievedAt: result.retrievedAt,
        sourceUrl: result.sourceUrl,
        servedFromCache: true,
      });
      const r = provenance.result(data, p, { mode: args.provenance_mode ?? "concise" });
      return { ...r, structuredContent: { ...r.structuredContent, ...data } };
    },
  );
}

export function uisListGeoUnitsHandler(env: Env) {
  return withToolErrors(
    async (args: {
      search?: string | undefined;
      type?: "NATIONAL" | "REGIONAL" | undefined;
      limit?: number | undefined;
      provenance_mode?: "concise" | "detailed" | undefined;
    }) => {
      const limit = args.limit ?? 100;
      const result = await searchUisGeoUnits(env, args.search, args.type, limit);
      const data = {
        total_matches: result.total,
        showing: result.entries.length,
        geo_units: result.entries.map((g) => ({ id: g.id, name: g.name, type: g.type })),
        ...(result.total > result.entries.length
          ? { hint: `Showing ${result.entries.length} of ${result.total} — use search/type to narrow, or raise limit.` }
          : {}),
      };
      const p = uisProvenance({
        dataset: { id: "UIS geo units", version: result.releaseVersion, name: "UNESCO UIS list of geo units" },
        retrievedAt: result.retrievedAt,
        sourceUrl: result.sourceUrl,
        servedFromCache: true,
      });
      const r = provenance.result(data, p, { mode: args.provenance_mode ?? "concise" });
      return { ...r, structuredContent: { ...r.structuredContent, ...data } };
    },
  );
}

/**
 * Avisos da origem: tipos/subtipos de footnote com contagem (o canal de
 * qualificação da UIS — ex.: fonte da pesquisa domiciliar, estimativa UIS).
 * O texto integral de cada footnote permanece na linha correspondente.
 */
export function noticesFromUisRecords(records: UisRecord[]): string[] {
  const counts = new Map<string, number>();
  for (const r of records) {
    for (const f of r.footnotes ?? []) {
      const label = `${f.type ?? "Footnote"}${f.subtype ? ` (${f.subtype})` : ""}`;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    if (r.magnitude) {
      const label = `Magnitude ${r.magnitude}`;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    if (r.qualifier) {
      const label = `Qualifier ${r.qualifier}`;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  return [...counts.entries()].map(([label, n]) => `${label}: ${n} record(s)`).sort();
}

export function uisGetDataHandler(env: Env) {
  return withToolErrors(
    async (args: {
      indicators: string[];
      geo_units?: string[] | undefined;
      start_year?: number | undefined;
      end_year?: number | undefined;
      include_footnotes?: boolean | undefined;
      provenance_mode?: "concise" | "detailed" | undefined;
    }) => {
      if (args.indicators.length > UIS_LIMITS.maxIndicatorsPerCall) {
        throw new UserError(
          `Too many indicators (${args.indicators.length}) — maximum ${UIS_LIMITS.maxIndicatorsPerCall} per call. ` +
            "Split the indicators into batches.",
        );
      }
      const { records, retrievedAt, sourceUrl, release } = await fetchUisData(env, {
        indicators: args.indicators,
        geoUnits: args.geo_units,
        start: args.start_year,
        end: args.end_year,
        footnotes: args.include_footnotes,
      });
      if (records.length > UIS_LIMITS.maxRecordsPerResponse) {
        // Nunca truncar silenciosamente: dado parcial apresentado como completo
        // viola o contrato anti-alucinação. Erro pedagógico com a contagem real.
        throw new UserError(
          `The query matched ${records.length} records — more than the ${UIS_LIMITS.maxRecordsPerResponse} ` +
            "this tool returns per call. Narrow it: specific geo_units, a shorter start_year/end_year " +
            "range, or fewer indicators.",
        );
      }

      const rows = records.map((r) => ({
        indicator: r.indicatorId,
        geo_unit: r.geoUnit,
        year: r.year,
        value: r.value,
        ...(r.magnitude ? { magnitude: r.magnitude } : {}),
        ...(r.qualifier ? { qualifier: r.qualifier } : {}),
        ...(r.footnotes?.length ? { footnotes: r.footnotes } : {}),
      }));

      const data = {
        columns: ["indicator", "geo_unit", "year", "value"],
        rows_count: rows.length,
        rows,
        ...(rows.length === 0
          ? {
              hint:
                "No records for this selection. Check the indicator codes with uis_search_indicators " +
                "and the geo unit codes with uis_list_geo_units — many indicators do not cover all " +
                "countries or years.",
            }
          : {}),
      };

      const dimensionKey: Record<string, string> = {
        indicator: args.indicators.join(","),
        ...(args.geo_units?.length ? { geoUnit: args.geo_units.join(",") } : {}),
        ...(args.start_year !== undefined || args.end_year !== undefined
          ? { year: `${args.start_year ?? ""}-${args.end_year ?? ""}` }
          : {}),
      };
      const p = uisProvenance({
        dataset: { id: args.indicators.join(","), version: release.version, name: null },
        dimensionKey,
        dataVintage: uisDataVintage(release),
        retrievedAt,
        sourceUrl,
        servedFromCache: false,
        notices: noticesFromUisRecords(records),
      });
      const r = provenance.result(data, p, { mode: args.provenance_mode ?? "concise" });
      return { ...r, structuredContent: { ...r.structuredContent, ...data } };
    },
  );
}

export function registerUisTools(server: McpServer, env: Env, record: RecordUsage): void {
  server.registerTool(
    UIS_SEARCH_INDICATORS,
    {
      title: "Search UNESCO UIS indicators",
      description:
        "Search the UNESCO Institute for Statistics catalogue of ~5,000 indicators — education, " +
        "science/R&D, culture and communication — by keywords in the name or code, optionally " +
        "filtered by theme. Returns indicator codes to use with uis_get_data, plus each " +
        "indicator's data availability (years, record count). Searches the catalogue only — it " +
        "does not return statistical values (use uis_get_data) and does not cover ILO labour " +
        "statistics (use search_indicators).",
      inputSchema: z.object({
        query: z.string().min(1).describe('Keywords, matched against indicator name and code (e.g. "literacy rate youth")'),
        theme: z
          .enum(UIS_THEMES)
          .optional()
          .describe("Restrict to one UIS theme"),
        limit: z.number().int().min(1).max(100).optional().describe("Maximum results (default 20)"),
        provenance_mode: PROVENANCE_MODE_SCHEMA,
      }),
      outputSchema: z.looseObject({
        total_matches: z.number(),
        showing: z.number(),
        indicators: z.array(
          z.object({
            code: z.string(),
            name: z.string(),
            theme: z.string(),
            last_data_update: z.string().nullable(),
            records: z.number().nullable(),
            years: z.string().nullable(),
            geo_types: z.string().nullable(),
          }),
        ),
        ...provenanceOutputShape(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    withUsage(UIS_SEARCH_INDICATORS, record, uisSearchIndicatorsHandler(env)),
  );

  server.registerTool(
    UIS_LIST_GEO_UNITS,
    {
      title: "List UNESCO UIS geo units",
      description:
        "Valid geographic codes for uis_get_data: 462 geo units — countries (NATIONAL, ISO " +
        "alpha-3 codes like BRA) and regional aggregates (REGIONAL). Filter by name/code and " +
        "type. Does not return statistical values, and does not apply to ILOSTAT tools (those " +
        "use list_dimension_values on REF_AREA).",
      inputSchema: z.object({
        search: z.string().min(1).optional().describe('Case-insensitive filter on name, or exact code (e.g. "BRA")'),
        type: z.enum(["NATIONAL", "REGIONAL"]).optional().describe("Only countries (NATIONAL) or only regional aggregates"),
        limit: z.number().int().min(1).max(500).optional().describe("Maximum results (default 100)"),
        provenance_mode: PROVENANCE_MODE_SCHEMA,
      }),
      outputSchema: z.looseObject({
        total_matches: z.number(),
        showing: z.number(),
        geo_units: z.array(z.object({ id: z.string(), name: z.string(), type: z.string() })),
        ...provenanceOutputShape(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    withUsage(UIS_LIST_GEO_UNITS, record, uisListGeoUnitsHandler(env)),
  );

  server.registerTool(
    UIS_GET_DATA,
    {
      title: "Get UNESCO UIS data",
      description:
        "Statistical records from the UNESCO Institute for Statistics Data API, filtered by " +
        "indicator codes (from uis_search_indicators, up to 25), geo unit codes (from " +
        "uis_list_geo_units) and year range. Set include_footnotes for per-record source notes. " +
        "Returns raw UIS records only — it does not aggregate, convert or otherwise transform " +
        "values, and does not cover ILO labour statistics (use get_data). Broad queries are " +
        "rejected with the record count — narrow by geo unit or years.",
      inputSchema: z.object({
        indicators: z
          .array(z.string().min(1))
          .min(1)
          .max(UIS_LIMITS.maxIndicatorsPerCall)
          .describe('Indicator codes from uis_search_indicators (e.g. ["CR.1"])'),
        geo_units: z
          .array(z.string().min(1))
          .min(1)
          .optional()
          .describe('Geo unit codes from uis_list_geo_units (e.g. ["BRA","ARG"]); omit for all'),
        start_year: z.number().int().min(1900).max(2100).optional().describe("First year, e.g. 2015"),
        end_year: z.number().int().min(1900).max(2100).optional().describe("Last year, e.g. 2024"),
        include_footnotes: z.boolean().optional().describe("Include per-record footnotes (source notes); default false"),
        provenance_mode: PROVENANCE_MODE_SCHEMA,
      }),
      outputSchema: z.looseObject({
        columns: z.array(z.string()),
        rows_count: z.number(),
        rows: z.array(z.record(z.string(), z.unknown())),
        ...provenanceOutputShape(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    withUsage(UIS_GET_DATA, record, uisGetDataHandler(env)),
  );
}
