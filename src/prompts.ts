/**
 * Prompts MCP — workflows prontos que encadeiam as 4 tools nas perguntas mais
 * comuns sobre ILOSTAT (perfil de um país, comparação entre países, tendência de
 * um indicador). Cada prompt devolve UMA mensagem de usuário com instruções passo
 * a passo, referências às resources e as regras de citação — o modelo executa.
 *
 * Argumentos de prompt são sempre strings (spec MCP); validação leve aqui, a
 * validação real dos códigos acontece nas tools.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { ILOSTAT_LIMITS } from "./config.js";
import { GUIDE_URI, KEY_DATAFLOWS_URI, PROVENANCE_URI } from "./resources.js";

export const COUNTRY_PROFILE = "ilo_country_labour_profile";
export const COMPARE_COUNTRIES = "ilo_compare_countries";
export const INDICATOR_TREND = "ilo_indicator_trend";

/** Lista canônica dos prompts — fonte única para GET /status e para os testes. */
export const PROMPT_NAMES: readonly string[] = [COUNTRY_PROFILE, COMPARE_COUNTRIES, INDICATOR_TREND];

const CITE =
  "Cite the ILO for every figure using the `citation` field of the provenance block, state " +
  "the `data_vintage` (last update at the ILO), and mention any `notices` (e.g. breaks in " +
  `series). Field meanings: ${PROVENANCE_URI}.`;

const CODES =
  `Code conventions (ISO3 areas, SEX_T/SEX_M/SEX_F, AGE_YTHADULT_*, FREQ) are in ${GUIDE_URI}; ` +
  `verified dataflow ids by topic are in ${KEY_DATAFLOWS_URI}. Use ilo_list_dimension_values ` +
  "only for codes you are not sure about.";

function user(text: string) {
  return { messages: [{ role: "user" as const, content: { type: "text" as const, text } }] };
}

const periodOrDefault = (start?: string, end?: string, defaultSpan = "the last 10 available years") =>
  start || end ? `${start ?? "earliest"}–${end ?? "latest"}` : defaultSpan;

export function countryProfileText(args: {
  country: string;
  start_period?: string | undefined;
  end_period?: string | undefined;
}): string {
  const period = periodOrDefault(args.start_period, args.end_period);
  return `Build a concise labour-market profile of ${args.country} from ILOSTAT for ${period}.

Steps:
1. Resolve the country to its ISO 3166-1 alpha-3 code (e.g. Brazil → BRA). If unsure, call
   ilo_list_dimension_values with dataflow DF_UNE_DEAP_SEX_AGE_RT, dimension REF_AREA and
   search "${args.country}".
2. Retrieve, with ilo_get_data (filters REF_AREA=<code>, SEX=SEX_T unless a sex breakdown is
   asked, AGE=AGE_YTHADULT_YGE15; ${args.start_period ? `start_period="${args.start_period}"` : "start_period as needed"}${args.end_period ? `, end_period="${args.end_period}"` : ""}):
   - unemployment rate — DF_UNE_DEAP_SEX_AGE_RT (add AGE_YTHADULT_Y15-24 for youth);
   - labour force participation rate — DF_EAP_DWAP_SEX_AGE_RT;
   - employment-to-population ratio — DF_EMP_DWAP_SEX_AGE_RT;
   - informal employment rate — DF_EMP_NIFL_SEX_RT;
   - NEET rate — DF_EIP_NEET_SEX_RT;
   - average monthly earnings — DF_EAR_EMTA_SEX_CUR_NB (report the CUR code with the value);
   - average weekly hours — DF_HOW_TEMP_SEX_ECO_NB (economic activity total).
   If a reported series is empty for this country, fall back to the ILO modelled-estimates
   dataflow of the same indicator (DF_UNE_2EAP_SEX_AGE_RT, DF_EAP_2WAP_SEX_AGE_RT,
   DF_EMP_2WAP_SEX_AGE_RT) and say so.
3. Present: a short headline paragraph, then a table (indicator, latest value, year, sex
   split when available, change over the period), then notable gaps or breaks.

${CODES}
${CITE}`;
}

export function compareCountriesText(args: {
  countries: string;
  indicator: string;
  start_period?: string | undefined;
  end_period?: string | undefined;
}): string {
  const period = periodOrDefault(args.start_period, args.end_period, "the latest common year and the last 10 years");
  return `Compare ${args.countries} on "${args.indicator}" using ILOSTAT, for ${period}.

Steps:
1. Pick the dataflow: check ${KEY_DATAFLOWS_URI} first; otherwise ilo_search_indicators with
   English keywords for "${args.indicator}" (dataflow ids ending in _RT are rates, _NB counts;
   ids whose second token starts with 2 are ILO modelled estimates). For cross-country
   comparison prefer a modelled-estimates dataflow when one exists — it has equal coverage
   and allows regional aggregates (X01 World, X26 Latin America and the Caribbean, X92 EU27…).
2. Resolve every country to ISO3 codes; call ilo_get_data ONCE with all of them in
   REF_AREA (list; at most ${ILOSTAT_LIMITS.maxAreasPerCall} per call — batch if more), SEX=SEX_T,
   AGE=AGE_YTHADULT_YGE15 (or the dimension defaults from ilo_get_indicator_metadata), and
   ${args.start_period || args.end_period ? `start_period="${args.start_period ?? ""}", end_period="${args.end_period ?? ""}"` : "last_n_observations=10"}.
3. Present a comparison table (country × latest common year, plus change over the period),
   rank the countries, and state explicitly which values are modelled estimates versus
   reported data and any missing country/year.

${CODES}
${CITE}`;
}

export function indicatorTrendText(args: {
  indicator: string;
  country: string;
  start_period?: string | undefined;
  end_period?: string | undefined;
}): string {
  const period = periodOrDefault(args.start_period, args.end_period, "the longest available period");
  return `Describe the trend of "${args.indicator}" in ${args.country} from ILOSTAT over ${period}.

Steps:
1. Pick the dataflow (${KEY_DATAFLOWS_URI}, else ilo_search_indicators). Call
   ilo_get_indicator_metadata to confirm dimensions and the source's default selection.
2. Resolve ${args.country} to its ISO3 code and call ilo_get_data with REF_AREA=<code>,
   SEX=SEX_T (and SEX_M/SEX_F if a gender comparison is useful), the headline AGE band,
   ${args.start_period || args.end_period ? `start_period="${args.start_period ?? ""}", end_period="${args.end_period ?? ""}"` : "no period filter (full series)"}.
   Use FREQ=A unless a quarterly/monthly series is explicitly requested.
3. Report: first and last values with years, peak and trough, average annual change,
   and any OBS_STATUS notices (breaks in series, provisional values) that qualify the trend.
   Show the series as a compact year → value table. Do not interpolate missing years — say
   they are missing.

${CODES}
${CITE}`;
}

export function registerPrompts(server: McpServer): void {
  const period = {
    start_period: z.string().optional().describe('First year, e.g. "2015" (optional)'),
    end_period: z.string().optional().describe('Last year, e.g. "2024" (optional)'),
  };

  server.registerPrompt(
    COUNTRY_PROFILE,
    {
      title: "Country labour-market profile",
      description:
        "Step-by-step workflow that assembles a labour-market profile of one country from " +
        "ILOSTAT (unemployment, participation, employment ratio, informality, NEET, earnings, " +
        "hours) with ILO citations.",
      argsSchema: z.object({
        country: z.string().min(1).describe('Country name or ISO3 code, e.g. "Brazil" or "BRA"'),
        ...period,
      }),
    },
    (args) => user(countryProfileText(args)),
  );

  server.registerPrompt(
    COMPARE_COUNTRIES,
    {
      title: "Compare countries on an indicator",
      description:
        "Workflow that compares several countries (or regional aggregates) on one ILOSTAT " +
        "indicator in a single data call, flagging modelled estimates versus reported data.",
      argsSchema: z.object({
        countries: z.string().min(1).describe('Comma-separated country names or ISO3 codes, e.g. "BRA, ARG, CHL"'),
        indicator: z.string().min(1).describe('Indicator in plain words, e.g. "youth unemployment rate"'),
        ...period,
      }),
    },
    (args) => user(compareCountriesText(args)),
  );

  server.registerPrompt(
    INDICATOR_TREND,
    {
      title: "Indicator trend for a country",
      description:
        "Workflow that retrieves the time series of one ILOSTAT indicator for one country and " +
        "describes the trend (first/last, peak/trough, breaks in series) with citations.",
      argsSchema: z.object({
        indicator: z.string().min(1).describe('Indicator in plain words, e.g. "labour force participation rate"'),
        country: z.string().min(1).describe('Country name or ISO3 code, e.g. "India" or "IND"'),
        ...period,
      }),
    },
    (args) => user(indicatorTrendText(args)),
  );
}
