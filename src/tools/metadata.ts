/**
 * get_indicator_metadata + list_dimension_values — estrutura e códigos válidos
 * de um dataflow, servidos do cache KV (estrutura por dataflow; codelist POR
 * CODELIST — CL_MEASURE/CL_AREA são compartilhadas entre dataflows).
 */

import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { IlostatUserError } from "../ilostat/key.js";
import { ilostatProvenance, provenance } from "../ilostat/provenance.js";
import { codelistUrl, getCodelist, getDataflowStructure, structureUrl } from "../ilostat/sdmx.js";
import type { Env } from "../types.js";
import type { RecordUsage } from "../usage-core.js";
import { withUsage } from "../usage-wrap.js";
import { withToolErrors } from "./errors.js";
import { PROVENANCE_MODE_SCHEMA, provenanceOutputShape } from "./shared.js";

export const GET_INDICATOR_METADATA = "get_indicator_metadata";
export const LIST_DIMENSION_VALUES = "list_dimension_values";

export function getIndicatorMetadataHandler(env: Env) {
  return withToolErrors(
    async (args: { dataflow: string; provenance_mode?: "concise" | "detailed" | undefined }) => {
      const { structure, retrievedAt, servedFromCache } = await getDataflowStructure(env, args.dataflow);
      const data = {
        id: structure.id,
        agency: structure.agency,
        version: structure.version,
        name: structure.name,
        data_vintage: structure.dataVintage,
        dimensions: structure.dimensions.map((d) => ({
          id: d.id,
          codelist: d.codelist?.id ?? null,
        })),
        time_dimension: structure.timeDimension,
        ...(structure.defaults ? { source_defaults: structure.defaults } : {}),
        hint:
          "Filter get_data by these dimension ids; discover valid codes with " +
          "list_dimension_values. The time dimension is filtered via start_period/end_period.",
      };
      const p = ilostatProvenance({
        dataset: { id: structure.id, version: structure.version, name: structure.name },
        dataVintage: structure.dataVintage,
        retrievedAt,
        sourceUrl: structureUrl(structure.id),
        servedFromCache,
      });
      const r = provenance.result(data, p, { mode: args.provenance_mode ?? "concise" });
      return { ...r, structuredContent: { ...r.structuredContent, ...data } };
    },
  );
}

export function listDimensionValuesHandler(env: Env) {
  return withToolErrors(
    async (args: {
      dataflow: string;
      dimension: string;
      search?: string | undefined;
      limit?: number | undefined;
      provenance_mode?: "concise" | "detailed" | undefined;
    }) => {
      const { structure } = await getDataflowStructure(env, args.dataflow);
      if (args.dimension === structure.timeDimension) {
        throw new IlostatUserError(
          `${args.dimension} is the time dimension — it has no codelist. ` +
            "Filter it in get_data via start_period/end_period (e.g. \"2015\", \"2024\").",
        );
      }
      const dim = structure.dimensions.find((d) => d.id === args.dimension);
      if (!dim) {
        throw new IlostatUserError(
          `Dimension "${args.dimension}" does not exist in dataflow ${structure.id}. ` +
            `Valid dimensions: ${structure.dimensions.map((d) => d.id).join(", ")}.`,
        );
      }
      if (!dim.codelist) {
        throw new IlostatUserError(`Dimension ${dim.id} has no enumerated codelist.`);
      }

      const { codelist, retrievedAt, servedFromCache } = await getCodelist(env, dim.codelist);
      const needle = args.search?.toLowerCase();
      const matching = needle
        ? codelist.codes.filter(
            (c) => c.id.toLowerCase().includes(needle) || (c.name ?? "").toLowerCase().includes(needle),
          )
        : codelist.codes;
      const limit = args.limit ?? 200;
      const data = {
        dataflow: structure.id,
        dimension: dim.id,
        codelist: codelist.id,
        total_codes: matching.length,
        showing: Math.min(matching.length, limit),
        values: matching.slice(0, limit).map((c) => ({ id: c.id, name: c.name })),
        ...(matching.length > limit
          ? { hint: `Showing ${limit} of ${matching.length} codes — use search to narrow.` }
          : {}),
      };
      const p = ilostatProvenance({
        dataset: { id: codelist.id, version: codelist.version, name: codelist.name },
        retrievedAt,
        sourceUrl: codelistUrl(dim.codelist),
        servedFromCache,
      });
      const r = provenance.result(data, p, { mode: args.provenance_mode ?? "concise" });
      return { ...r, structuredContent: { ...r.structuredContent, ...data } };
    },
  );
}

export function registerMetadataTools(server: McpServer, env: Env, record: RecordUsage): void {
  server.registerTool(
    GET_INDICATOR_METADATA,
    {
      title: "Get ILOSTAT indicator metadata",
      description:
        "Structure of one ILOSTAT dataflow: dimensions (in SDMX key order), their codelists, the " +
        "time dimension, the source's default selection and the data vintage (last update at the " +
        "ILO). Use before get_data to know which filters exist. Does not return statistical values " +
        "and does not list the codes themselves (use list_dimension_values).",
      inputSchema: z.object({
        dataflow: z.string().min(1).describe('Dataflow id from search_indicators (e.g. "DF_UNE_DEAP_SEX_AGE_RT")'),
        provenance_mode: PROVENANCE_MODE_SCHEMA,
      }),
      outputSchema: z.looseObject({
        id: z.string(),
        version: z.string(),
        name: z.string().nullable(),
        data_vintage: z.string().nullable(),
        dimensions: z.array(z.object({ id: z.string(), codelist: z.string().nullable() })),
        time_dimension: z.string().nullable(),
        ...provenanceOutputShape(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    withUsage(GET_INDICATOR_METADATA, record, getIndicatorMetadataHandler(env)),
  );

  server.registerTool(
    LIST_DIMENSION_VALUES,
    {
      title: "List valid codes of a dimension",
      description:
        "Valid codes (id + label) of one dimension of an ILOSTAT dataflow — e.g. the country/area " +
        "codes of REF_AREA or the sex categories of SEX. Use to build correct get_data filters. " +
        "Does not return statistical values; not applicable to the time dimension (filter it via " +
        "start_period/end_period in get_data).",
      inputSchema: z.object({
        dataflow: z.string().min(1).describe("Dataflow id the dimension belongs to"),
        dimension: z.string().min(1).describe('Dimension id from get_indicator_metadata (e.g. "REF_AREA", "SEX")'),
        search: z.string().min(1).optional().describe("Case-insensitive filter on code id or label"),
        limit: z.number().int().min(1).max(500).optional().describe("Maximum codes returned (default 200)"),
        provenance_mode: PROVENANCE_MODE_SCHEMA,
      }),
      outputSchema: z.looseObject({
        dataflow: z.string(),
        dimension: z.string(),
        codelist: z.string(),
        total_codes: z.number(),
        showing: z.number(),
        values: z.array(z.object({ id: z.string(), name: z.string().nullable() })),
        ...provenanceOutputShape(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    withUsage(LIST_DIMENSION_VALUES, record, listDimensionValuesHandler(env)),
  );
}
