/**
 * `search` / `fetch` — the ChatGPT Deep Research contract (OpenAI), over the
 * ILOSTAT dataflow catalogue. The contract, the envelope, the ranking and the
 * registration live in `@sbissoli/mcp-search` (portfolio package); this module
 * is the ILOSTAT adapter: what can be found (the index) and how a document
 * reads (the text).
 *
 * Why these two tools exist: ChatGPT deep research, company knowledge and the
 * research workflows of the Responses API only use an MCP server that exposes
 * exactly `search` and `fetch` — the `ilo_*` tools, however rich, are invisible
 * to them. They are the ONLY tools without the `ilo_` prefix (name fixed by
 * OpenAI; `DEEP_RESEARCH_TOOLS` is the allowlist the tests use).
 *
 * The index: every dataflow of the catalogue (`listCatalog` — D1 in the Worker,
 * the in-memory catalogue on stdio; ~1,200 rows), id `ind:<DATAFLOW_ID>`,
 * keywords from the id's segments plus the topic and note of `KEY_DATAFLOWS`
 * when the dataflow is one of the curated ones. Built on first use, kept for
 * 24 h in this module (one per process; the Worker keeps it across requests of
 * the same isolate). Ranked by the package index — relevance, not the ANDed
 * substrings of `ilo_search_indicators`.
 *
 * `fetch` renders the document from the same reading `ilo_get_indicator_metadata`
 * does (`getDataflowStructure`, KV-cached) and reuses its provenance block as the
 * envelope extras, so the provenance gate covers these two the same way it covers
 * the other tools. Unknown ids are refused from the index, without touching the
 * upstream.
 *
 * `url` is the public ILOSTAT data explorer, never the SDMX API — it is what
 * ChatGPT cites. Pattern verified in the browser on 2026-09-03 (see
 * `explorerUrl`): the explorer is a Shiny app that answers 200 to ANY id, so the
 * check is visual ("N / M records" on the page), not by HTTP status.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import {
  DEEP_RESEARCH_TOOLS,
  createIndex,
  registerDeepResearchTools as registerFromPackage,
  type FetchReply,
  type IndexEntry,
  type SearchIndex,
  type SearchReply,
} from "@sbissoli/mcp-search";
import { listCatalog, type CatalogEntry } from "../ilostat/catalog.js";
import { ilostatProvenance, provenanceExtras } from "../ilostat/provenance.js";
import { getDataflowStructure, structureUrl } from "../ilostat/sdmx.js";
import type { DataflowStructure } from "../ilostat/structure.js";
import { KEY_DATAFLOWS } from "../resources.js";
import type { Env } from "../types.js";
import type { RecordUsage } from "../usage-core.js";
import { provenanceOutputShape } from "./shared.js";

export { DEEP_RESEARCH_TOOLS };

/** Prefix of every document id (`ind:DF_UNE_2EAP_SEX_AGE_RT`). */
export const DEEP_RESEARCH_ID_PREFIX = "ind:";

/** Results per `search` call (the contract has no paging; ten is what the examples show). */
export const DEEP_RESEARCH_LIMIT = 10;

/** The catalogue changes a few times a year; a day is nothing. */
const INDEX_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Public data explorer page of a dataflow (ilostat.ilo.org links to it; it
 * redirects to a numbered rshiny instance — cite the stable entry point). The id
 * the explorer expects is the dataflow without `DF_` plus the frequency suffix:
 * `UNE_2EAP_SEX_AGE_RT_A` preselects the dataset; without the suffix the
 * explorer opens empty.
 */
export function explorerUrl(dataflowId: string, freq = "A"): string {
  const bare = dataflowId.replace(/^DF_/, "");
  return `https://rplumber.ilo.org/dataexplorer/?lang=en&id=${encodeURIComponent(`${bare}_${freq}`)}`;
}

// ==================== INDEX ====================

interface LoadedIndex {
  index: SearchIndex;
  /** Every indexed id — `fetch` refuses what is not here before touching the upstream. */
  ids: ReadonlySet<string>;
  /** Provenance of the catalogue listing — the `search` provenance. */
  retrievedAt: string;
  sourceUrl: string;
  createdAt: number;
}

interface CuratedNote {
  topic: string;
  name: string;
  note?: string;
}

const CURATED: ReadonlyMap<string, CuratedNote> = new Map(
  KEY_DATAFLOWS.flatMap((group) =>
    group.entries.map((e) => [e.id, { topic: group.topic, name: e.name, ...(e.note ? { note: e.note } : {}) }] as const),
  ),
);

/** `DF_UNE_2EAP_SEX_AGE_RT` → ["UNE", "2EAP", "SEX", "AGE", "RT"] — the id's own vocabulary. */
function idSegments(dataflowId: string): string[] {
  return dataflowId
    .replace(/^DF_/, "")
    .split("_")
    .filter((s) => s.length >= 2);
}

export function indexEntries(entries: readonly CatalogEntry[]): IndexEntry[] {
  return entries
    .filter((e) => e.id)
    .map((e) => {
      const curated = CURATED.get(e.id);
      return {
        id: `${DEEP_RESEARCH_ID_PREFIX}${e.id}`,
        title: e.name || e.id,
        url: explorerUrl(e.id),
        keywords: [...idSegments(e.id), ...(curated ? [curated.topic, curated.name, curated.note ?? ""] : [])].filter(Boolean),
        text: curated ? `${e.name} — ${curated.topic}${curated.note ? ` (${curated.note})` : ""}.` : e.name,
      };
    });
}

// One index per process; the stdio runtime and the Worker isolate each keep
// their own. Concurrent first calls share the build; a failed build is not kept.
let loaded: LoadedIndex | null = null;
let loading: Promise<LoadedIndex> | null = null;

async function buildIndex(env: Env): Promise<LoadedIndex> {
  const { entries, retrievedAt, sourceUrl } = await listCatalog(env);
  const docs = indexEntries(entries);
  return { index: createIndex(docs), ids: new Set(docs.map((d) => d.id)), retrievedAt, sourceUrl, createdAt: Date.now() };
}

/** The index, built on first use and kept for `INDEX_TTL_MS`. */
export async function getIndex(env: Env): Promise<LoadedIndex> {
  if (loaded && Date.now() - loaded.createdAt < INDEX_TTL_MS) return loaded;
  if (!loading) {
    loading = buildIndex(env)
      .then((idx) => {
        loaded = idx;
        return idx;
      })
      .finally(() => {
        loading = null;
      });
  }
  return loading;
}

/** Tests only: forget the built index. */
export function resetIndex(): void {
  loaded = null;
  loading = null;
}

// ==================== DOCUMENT ====================

const line = (label: string, value: unknown): string | null =>
  value === null || value === undefined || value === "" ? null : `- **${label}:** ${String(value)}`;

export function renderDataflow(structure: DataflowStructure): string {
  const curated = CURATED.get(structure.id);
  const freq = structure.defaults?.FREQ ?? "A";
  const defaults = structure.defaults
    ? Object.entries(structure.defaults)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ")
    : null;
  const filterHint = structure.dimensions
    .filter((d) => d.id !== "FREQ" && d.id !== "MEASURE")
    .map((d) => d.id)
    .slice(0, 3)
    .join(", ");
  return [
    `# ${structure.name ?? structure.id}`,
    "",
    line("Dataflow id", structure.id),
    line("Agency", structure.agency),
    line("Version", structure.version),
    line("Data vintage (last update at the ILO)", structure.dataVintage),
    line("Topic", curated?.topic),
    curated?.note ? `- **Note:** ${curated.note}` : null,
    "",
    "## Dimensions (SDMX key order)",
    ...structure.dimensions.map((d) => `- ${d.id}${d.codelist ? ` — codelist ${d.codelist.id}` : ""}`),
    line("Time dimension", structure.timeDimension),
    line("ILO default selection", defaults),
    "",
    "## How to query",
    `Call \`ilo_get_data\` with \`dataflow: "${structure.id}"\` and filters on the dimensions above` +
      (filterHint ? ` (e.g. ${filterHint})` : "") +
      "; resolve codes with `ilo_list_dimension_values`. Frequency defaults to " +
      `\`${freq}\`; filter time with \`start_period\`/\`end_period\`.`,
    "",
    `Source: International Labour Organization, ILOSTAT. Data explorer: ${explorerUrl(structure.id, freq)}`,
  ]
    .filter((l): l is string => l !== null)
    .join("\n");
}

// ==================== HANDLERS ====================

export function deepResearchHandlers(env: Env) {
  async function search(query: string): Promise<SearchReply> {
    const idx = await getIndex(env);
    const results = idx.index.search(query, { limit: DEEP_RESEARCH_LIMIT }).map(({ id, title, url }) => ({ id, title, url }));
    const p = ilostatProvenance({
      dataset: { id: "dataflow/ILO", version: null, name: "ILOSTAT dataflow catalogue" },
      retrievedAt: idx.retrievedAt,
      sourceUrl: idx.sourceUrl,
      servedFromCache: true,
    });
    return { results, extras: provenanceExtras(p) };
  }

  async function fetch(id: string): Promise<FetchReply | null> {
    if (!id.startsWith(DEEP_RESEARCH_ID_PREFIX)) return null;
    const dataflowId = id.slice(DEEP_RESEARCH_ID_PREFIX.length);
    // Refuse unknown ids from the catalogue — the upstream is never asked about them.
    const idx = await getIndex(env);
    if (!idx.ids.has(id)) return null;
    const { structure, retrievedAt, servedFromCache } = await getDataflowStructure(env, dataflowId);
    const freq = structure.defaults?.FREQ ?? "A";
    const p = ilostatProvenance({
      dataset: { id: structure.id, version: structure.version, name: structure.name },
      dataVintage: structure.dataVintage,
      retrievedAt,
      sourceUrl: structureUrl(structure.id),
      servedFromCache,
    });
    return {
      document: {
        id,
        title: structure.name ?? structure.id,
        text: renderDataflow(structure),
        url: explorerUrl(structure.id, freq),
        metadata: {
          dataflow: structure.id,
          version: structure.version,
          data_vintage: structure.dataVintage,
          dimensions: structure.dimensions.map((d) => d.id),
          time_dimension: structure.timeDimension,
          ...(CURATED.has(structure.id) ? { topic: CURATED.get(structure.id)!.topic } : {}),
        },
      },
      extras: provenanceExtras(p),
    };
  }

  return { search, fetch };
}

// ==================== REGISTRATION ====================

export function registerDeepResearchTools(server: McpServer, env: Env, record: RecordUsage): void {
  registerFromPackage(server, {
    ...deepResearchHandlers(env),
    locale: "en",
    corpus:
      "ILOSTAT labour statistics (≈1,200 SDMX dataflows: employment, unemployment, wages, working time, informality, SDG labour indicators)",
    richTools: "the `ilo_*` tools",
    limit: DEEP_RESEARCH_LIMIT,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    extendOutputSchema: (schema) => schema.extend(provenanceOutputShape()),
    record,
  });
}
