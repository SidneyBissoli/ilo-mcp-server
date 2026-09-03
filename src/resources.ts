/**
 * Resources MCP — documentação de referência que o cliente pode anexar ao contexto
 * ANTES de chamar tools (guia de consulta, dataflows-chave por tema, contrato de
 * proveniência). São estáticos e 100% offline: nenhum toca o upstream.
 *
 * Por que existem: o custo típico de uma sessão ILOSTAT está na descoberta (qual
 * dataflow, quais códigos). O guia e a lista de dataflows-chave poupam 2–3
 * chamadas de tool nas perguntas mais comuns; os ids listados existem no seed do
 * catálogo (scripts/seed-catalog.sql) e são verificados pelo teste de capabilities.
 *
 * Idioma: inglês (mesma persona das tools). URIs no esquema próprio `ilostat://`.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import { CONTRACT_VERSION } from "@sbissoli/mcp-provenance";
import { ILOSTAT_LIMITS, PROVENANCE_OPTIONS } from "./config.js";

export const GUIDE_URI = "ilostat://guide";
export const KEY_DATAFLOWS_URI = "ilostat://reference/key-dataflows";
export const PROVENANCE_URI = "ilostat://reference/provenance";

/** Lista canônica das resources — fonte única para GET /status e para os testes. */
export const RESOURCE_URIS: readonly string[] = [GUIDE_URI, KEY_DATAFLOWS_URI, PROVENANCE_URI];

/**
 * Dataflows-chave por tema. Fonte da verdade da resource key-dataflows E do teste
 * que prova que todo id existe no seed. Só dataflows "reais" (não modelados) exceto
 * onde indicado — os modelados (`-- ILO modelled estimates`) têm cobertura mundial
 * mas são estimativas; o guia explica a diferença.
 */
export const KEY_DATAFLOWS: ReadonlyArray<{
  topic: string;
  entries: ReadonlyArray<{ id: string; name: string; note?: string }>;
}> = [
  {
    topic: "Unemployment and labour underutilization",
    entries: [
      { id: "DF_UNE_DEAP_SEX_AGE_RT", name: "Unemployment rate by sex and age", note: "headline series (LFS-based)" },
      { id: "DF_UNE_TUNE_SEX_AGE_NB", name: "Unemployment by sex and age (thousands)" },
      { id: "DF_UNE_2EAP_SEX_AGE_RT", name: "Unemployment rate by sex and age", note: "ILO modelled estimates — full country/year coverage" },
      { id: "DF_LUU_XLU3_SEX_AGE_RT", name: "LU3: combined rate of unemployment and potential labour force" },
      { id: "DF_LUU_XLU4_SEX_AGE_RT", name: "LU4: composite rate of labour underutilization" },
      { id: "DF_LUU_XLUX_SEX_RT", name: "Jobs gap rate" },
    ],
  },
  {
    topic: "Employment and participation",
    entries: [
      { id: "DF_EMP_DWAP_SEX_AGE_RT", name: "Employment-to-population ratio by sex and age" },
      { id: "DF_EAP_DWAP_SEX_AGE_RT", name: "Labour force participation rate by sex and age" },
      { id: "DF_EMP_TEMP_SEX_AGE_NB", name: "Employment by sex and age (thousands)" },
      { id: "DF_EMP_TEMP_SEX_ECO_NB", name: "Employment by sex and economic activity" },
      { id: "DF_EMP_TEMP_SEX_STE_NB", name: "Employment by sex and status in employment" },
      { id: "DF_EAP_TEAP_SEX_AGE_NB", name: "Labour force by sex and age (thousands)" },
      { id: "DF_POP_XWAP_SEX_AGE_NB", name: "Working-age population by sex and age" },
      { id: "DF_EMP_2WAP_SEX_AGE_RT", name: "Employment-to-population ratio", note: "ILO modelled estimates" },
      { id: "DF_EAP_2WAP_SEX_AGE_RT", name: "Labour force participation rate", note: "ILO modelled estimates" },
    ],
  },
  {
    topic: "Wages and earnings",
    entries: [
      { id: "DF_EAR_EMTA_SEX_CUR_NB", name: "Average monthly earnings of employees by sex and currency", note: "CUR dimension: local currency, USD or PPP" },
      { id: "DF_EAR_EHRA_SEX_NB", name: "Average hourly earnings of employees by sex" },
      { id: "DF_EAR_EMTA_SEX_ECO_CUR_NB", name: "Average monthly earnings by sex, economic activity and currency" },
      { id: "DF_EAR_INEE_NOC_NB", name: "Monthly minimum wage" },
      { id: "DF_EAR_GGAP_OCU_RT", name: "Gender wage gap by occupation" },
      { id: "DF_LAP_2GDP_NOC_RT", name: "Labour income share as a percent of GDP", note: "ILO modelled estimates" },
    ],
  },
  {
    topic: "Working time",
    entries: [
      { id: "DF_HOW_TEMP_SEX_ECO_NB", name: "Average weekly hours actually worked per employed person by sex and economic activity" },
      { id: "DF_HOW_XEES_SEX_ECO_NB", name: "Average weekly hours actually worked per employee by sex and economic activity" },
    ],
  },
  {
    topic: "Informality, youth and decent work (SDG)",
    entries: [
      { id: "DF_EMP_NIFL_SEX_RT", name: "Informal employment rate by sex" },
      { id: "DF_EIP_NEET_SEX_RT", name: "NEET rate: youth not in employment, education or training, by sex" },
      { id: "DF_SDG_0852_SEX_AGE_RT", name: "SDG 8.5.2: Unemployment rate by sex and age" },
      { id: "DF_SDG_0831_SEX_ECO_RT", name: "SDG 8.3.1: Proportion of informal employment in total employment" },
      { id: "DF_SDG_0861_SEX_RT", name: "SDG 8.6.1: Youth (15–24) not in education, employment or training" },
      { id: "DF_SDG_0111_SEX_AGE_RT", name: "SDG 1.1.1: Working poverty rate by sex and age" },
      { id: "DF_SDG_0552_NOC_RT", name: "SDG 5.5.2: Women in senior and middle management positions" },
    ],
  },
  {
    topic: "Productivity",
    entries: [
      { id: "DF_GDP_211P_NOC_NB", name: "Output per worker, GDP constant 2021 international $ at PPP", note: "ILO modelled estimates" },
      { id: "DF_GDP_205U_NOC_NB", name: "Output per worker, GDP constant 2015 US$", note: "ILO modelled estimates" },
    ],
  },
];

export function guideMarkdown(): string {
  return `# ILOSTAT query guide (ilo-mcp-server)

Labour statistics from ILOSTAT, the International Labour Organization's database, via its
official SDMX API. Six read-only tools; every response carries a provenance block
(see \`${PROVENANCE_URI}\`).

## Workflow

1. **Find the dataflow** — \`ilo_search_indicators\` with English keywords
   (\`"unemployment rate sex age"\`). Terms are ANDed against the dataflow name and id.
   For the most common questions, skip the search: \`${KEY_DATAFLOWS_URI}\` lists
   verified dataflow ids by topic.
2. **Learn its dimensions** — \`ilo_get_indicator_metadata\` returns the dimension ids
   (typically \`REF_AREA, FREQ, MEASURE, SEX, AGE …\`), the time dimension and the
   source's default selection (a good starting filter set).
3. **Resolve codes** — \`ilo_list_dimension_values\` (with \`search\`) gives valid codes for
   one dimension. Skip it when you already know the conventions below.
4. **Get data** — \`ilo_get_data\` with \`filters\` (dimension id → code or list) and
   \`start_period\`/\`end_period\` (or \`last_n_observations\`).

## Deep Research (ChatGPT): \`search\` and \`fetch\`

\`search\` ranks a free-text query against the full dataflow catalogue and returns
\`{ id, title, url }\` (\`ind:<DATAFLOW_ID>\`); \`fetch\` renders one dataflow as Markdown
(dimensions, vintage, default selection, how to query). They exist for the ChatGPT Deep
Research contract; for data, use the \`ilo_*\` tools above.

## Code conventions (stable across dataflows)

- **REF_AREA** — ISO 3166-1 alpha-3 country codes (\`BRA\`, \`DEU\`, \`IND\`, \`USA\`, \`ZAF\`).
  Aggregates use \`X\`-codes: \`X01\` World, \`X06\` Africa, \`X21\` Americas,
  \`X26\` Latin America and the Caribbean, \`X36\` Arab States, \`X40\` Asia and the Pacific,
  \`X60\` Europe and Central Asia, \`X92\` European Union 27, \`X83\` G20, \`X85\` BRICS.
  Aggregates are usually available only in *ILO modelled estimates* dataflows.
- **SEX** — \`SEX_T\` total, \`SEX_M\` male, \`SEX_F\` female.
- **AGE** — \`AGE_YTHADULT_YGE15\` 15+, \`AGE_YTHADULT_Y15-24\` youth 15–24,
  \`AGE_YTHADULT_YGE25\` 25+, \`AGE_YTHADULT_Y15-64\`; \`AGE_AGGREGATE_*\`, \`AGE_5YRBANDS_*\`,
  \`AGE_10YRBANDS_*\` for finer bands.
- **FREQ** — \`A\` annual, \`Q\` quarterly, \`M\` monthly. Most dataflows are annual.
- **TIME_PERIOD** — never in \`filters\`: use \`start_period\`/\`end_period\` (\`"2015"\`, \`"2024"\`).
- **Dataflow id suffixes** — \`_RT\` rate/ratio (%), \`_NB\` number (usually thousands),
  \`_2…\` (second token starting with 2) = ILO modelled estimates (full coverage, estimated),
  \`_D…\`/\`_T…\`/\`_X…\` = reported national data (labour force surveys etc.).

## Limits and behaviour

- \`REF_AREA\` is **required** in \`ilo_get_data\`, at most ${ILOSTAT_LIMITS.maxAreasPerCall} areas per
  call — batch areas and/or paginate by period for wide panels.
- Unfiltered dimensions return all their categories; filter \`SEX\`/\`AGE\` to keep results small.
- Values are raw ILOSTAT observations — no aggregation, conversion or interpolation.
- \`OBS_STATUS\` notices (e.g. "Break in series") are reproduced verbatim in provenance
  \`notices\`; mention them when reporting trends.
- Empty result ≠ error: the series may not cover that area/year — check codes and period.
- Reported (non-modelled) series have gaps; for cross-country comparisons with equal
  coverage prefer the modelled-estimates dataflow of the same indicator.

## Reporting

Cite the ILO on every figure (the \`citation\` field is ready to paste), state the
\`data_vintage\` (last update at the ILO) and, when relevant, \`retrieved_at\`.
`;
}

export function keyDataflowsMarkdown(): string {
  const sections = KEY_DATAFLOWS.map((s) => {
    const rows = s.entries
      .map((e) => `| \`${e.id}\` | ${e.name} | ${e.note ?? ""} |`)
      .join("\n");
    return `## ${s.topic}\n\n| Dataflow id | Indicator | Note |\n|---|---|---|\n${rows}\n`;
  }).join("\n");
  return `# Key ILOSTAT dataflows by topic

Verified dataflow ids for the most common questions — use them directly in
\`ilo_get_indicator_metadata\` / \`ilo_get_data\` without searching. "ILO modelled estimates"
are model-based series with complete country and year coverage (good for comparisons and
regional aggregates); the others are reported national data (surveys, registers) with gaps.
For anything not listed, use \`ilo_search_indicators\` (~1,200 dataflows).

${sections}
Conventions for codes (REF_AREA, SEX, AGE, FREQ) are in \`${GUIDE_URI}\`.
`;
}

export function provenanceMarkdown(): string {
  return `# Provenance and citation contract

Every tool response of this server carries a deterministic provenance block
(contract v${CONTRACT_VERSION}, package \`@sbissoli/mcp-provenance\`), on three channels:
\`structuredContent.provenance\` + \`structuredContent.attribution\`, namespaced \`_meta\`
(\`${PROVENANCE_OPTIONS.metaNamespace}/*\`) and a short text footer. \`provenance_mode\`
selects \`concise\` (default) or \`detailed\`.

## Fields

- **source** / **source_url** — the ILO SDMX request that produced the data (dataflow
  structure, codelist or data query URL). Reproducible: the same URL yields the same data
  as of the same vintage.
- **data_vintage** — the dataflow's last update at the ILO (\`LAST_UPDATE\` annotation),
  ISO 8601. Cite it as the "as of" date of the figures.
- **retrieved_at** — the real instant the data was extracted from ILOSTAT (UTC). For
  cached structures/codelists it is the instant of the original extraction and
  \`served_from_cache\` is \`true\`. Data (\`ilo_get_data\`) is never cached.
- **dimension_key** (detailed / \`ilo_get_data\`) — the effective filter set of the query,
  including the period, so the selection can be quoted or re-run.
- **derived** — always \`false\` here: this server never transforms values (no aggregation,
  conversion or interpolation). Rounding is not a derivation.
- **notices** — verbatim \`OBS_STATUS\` values with counts (e.g. "Break in series").
- **license** — ILOSTAT data and metadata are **CC BY 4.0**.
- **citation** — ready-to-paste ILO attribution string; **attribution** repeats it as a list.

## How to cite

Use the \`citation\` field as given — the ILO's required form:
"International Labour Organization, ILOSTAT, https://ilostat.ilo.org/data/, accessed <date>."
— and add the dataflow name and \`data_vintage\` when reporting specific figures. This server
is an independent client of the ILO's public API — not affiliated with or endorsed by the ILO.
`;
}

export function registerResources(server: McpServer): void {
  const md = { mimeType: "text/markdown" as const };

  server.registerResource(
    "ilostat-guide",
    GUIDE_URI,
    {
      title: "ILOSTAT query guide",
      description:
        "How to query ILOSTAT with this server: tool workflow, stable code conventions " +
        "(REF_AREA ISO3 and X-aggregates, SEX, AGE, FREQ, dataflow id suffixes), limits and " +
        "reporting rules. Read once per session to save discovery calls.",
      ...md,
    },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: md.mimeType, text: guideMarkdown() }] }),
  );

  server.registerResource(
    "ilostat-key-dataflows",
    KEY_DATAFLOWS_URI,
    {
      title: "Key ILOSTAT dataflows by topic",
      description:
        "Verified dataflow ids for the most common indicators (unemployment, employment, " +
        "participation, wages, working time, informality, NEET, SDG 8, productivity) — " +
        "usable directly in ilo_get_data without searching.",
      ...md,
    },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: md.mimeType, text: keyDataflowsMarkdown() }] }),
  );

  server.registerResource(
    "ilostat-provenance",
    PROVENANCE_URI,
    {
      title: "Provenance and citation contract",
      description:
        "Meaning of every provenance field returned with the data (source_url, data_vintage, " +
        "retrieved_at, notices, license, citation) and how to cite the ILO correctly.",
      ...md,
    },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: md.mimeType, text: provenanceMarkdown() }] }),
  );
}
