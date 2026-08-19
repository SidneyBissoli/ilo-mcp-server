/**
 * ilo_search_indicators — busca de indicadores (dataflows) no catálogo local (D1).
 * 100% local: nenhuma chamada ao upstream por consulta (decisão do spike).
 */

import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { searchCatalog } from "../ilostat/catalog.js";
import { ilostatProvenance, provenance } from "../ilostat/provenance.js";
import type { Env } from "../types.js";
import type { RecordUsage } from "../usage-core.js";
import { withUsage } from "../usage-wrap.js";
import { withToolErrors } from "./errors.js";
import { PROVENANCE_MODE_SCHEMA, provenanceOutputShape } from "./shared.js";

export const SEARCH_INDICATORS = "ilo_search_indicators";

export function searchIndicatorsHandler(env: Env) {
  return withToolErrors(
    async (args: {
      query: string;
      limit?: number | undefined;
      offset?: number | undefined;
      provenance_mode?: "concise" | "detailed" | undefined;
    }) => {
      const limit = args.limit ?? 20;
      const offset = args.offset ?? 0;
      const result = await searchCatalog(env, args.query, limit, offset);
      const hasMore = result.total > offset + result.entries.length;
      const data = {
        total_matches: result.total,
        showing: result.entries.length,
        offset,
        indicators: result.entries.map((e) => ({ id: e.id, name: e.name, version: e.version })),
        has_more: hasMore,
        ...(hasMore
          ? {
              next_offset: offset + result.entries.length,
              hint: `Showing ${result.entries.length} of ${result.total} matches (highest-ranked first) — add terms to narrow, or page with offset.`,
            }
          : {}),
      };
      const p = ilostatProvenance({
        dataset: { id: "ILO dataflow catalogue", version: null, name: "ILOSTAT catalogue of dataflows" },
        retrievedAt: result.retrievedAt,
        sourceUrl: result.sourceUrl,
        servedFromCache: true,
      });
      const r = provenance.result(data, p, { mode: args.provenance_mode ?? "concise" });
      return { ...r, structuredContent: { ...r.structuredContent, ...data } };
    },
  );
}

export function registerCatalogTools(server: McpServer, env: Env, record: RecordUsage): void {
  server.registerTool(
    SEARCH_INDICATORS,
    {
      title: "Search ILOSTAT indicators",
      description:
        "Search the ILOSTAT catalogue of ~1,200 indicator dataflows by keywords in the name or id " +
        "(e.g. \"unemployment rate sex age\"). All terms must match (AND, case-insensitive), so " +
        "start with 2–3 English words and drop terms if you get 0 results; results are ranked by " +
        "ILO relevance weight, not by match count. Reading the id tells you the shape: suffix _RT " +
        "= rate/ratio, _NB = number (usually thousands); dataflows whose second token starts with 2 " +
        "(e.g. DF_UNE_2EAP_…) are ILO modelled estimates with full country/year coverage, the " +
        "others are reported national data. Returns dataflow ids to use with ilo_get_data / " +
        "ilo_get_indicator_metadata. Searches the local catalogue only — it does not return " +
        "statistical values (use ilo_get_data), does not search dimension codes such as countries " +
        "(use ilo_list_dimension_values) and does not cover non-ILO sources.",
      inputSchema: z.object({
        query: z.string().min(1).describe("Keywords, matched against dataflow name and id (AND between terms)"),
        limit: z.number().int().min(1).max(100).optional().describe("Maximum results (default 20)"),
        offset: z.number().int().min(0).optional().describe("Results to skip, for pagination (default 0)"),
        provenance_mode: PROVENANCE_MODE_SCHEMA,
      }),
      outputSchema: z.looseObject({
        total_matches: z.number(),
        showing: z.number(),
        offset: z.number(),
        indicators: z.array(z.object({ id: z.string(), name: z.string(), version: z.string() })),
        has_more: z.boolean(),
        next_offset: z.number().optional(),
        ...provenanceOutputShape(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    withUsage(SEARCH_INDICATORS, record, searchIndicatorsHandler(env)),
  );
}
