/**
 * search_indicators — busca de indicadores (dataflows) no catálogo local (D1).
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

export const SEARCH_INDICATORS = "search_indicators";

export function searchIndicatorsHandler(env: Env) {
  return withToolErrors(
    async (args: { query: string; limit?: number | undefined; provenance_mode?: "concise" | "detailed" | undefined }) => {
      const limit = args.limit ?? 20;
      const result = await searchCatalog(env, args.query, limit);
      const data = {
        total_matches: result.total,
        showing: result.entries.length,
        indicators: result.entries.map((e) => ({ id: e.id, name: e.name, version: e.version })),
        ...(result.total > result.entries.length
          ? { hint: `Showing the ${result.entries.length} highest-ranked of ${result.total} matches — add terms to narrow, or raise limit.` }
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
        "(e.g. \"unemployment rate sex age\"). Returns dataflow ids to use with get_data / " +
        "get_indicator_metadata. Searches the catalogue only — it does not return statistical " +
        "values (use get_data) and does not cover non-ILO sources.",
      inputSchema: z.object({
        query: z.string().min(1).describe("Keywords, matched against dataflow name and id (AND between terms)"),
        limit: z.number().int().min(1).max(100).optional().describe("Maximum results (default 20)"),
        provenance_mode: PROVENANCE_MODE_SCHEMA,
      }),
      outputSchema: z.looseObject({
        total_matches: z.number(),
        showing: z.number(),
        indicators: z.array(z.object({ id: z.string(), name: z.string(), version: z.string() })),
        ...provenanceOutputShape(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    withUsage(SEARCH_INDICATORS, record, searchIndicatorsHandler(env)),
  );
}
