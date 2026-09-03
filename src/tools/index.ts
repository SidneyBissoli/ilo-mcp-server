/**
 * Lista canônica das tools do servidor — fonte única para GET /status (`tools`,
 * `tool_names`, que alimentam os badges dinâmicos do README) e para os testes.
 * O teste de contrato prova, via `tools/list` real, que esta lista é exatamente o
 * que o servidor anuncia: adicionar uma tool sem incluí-la aqui quebra o teste.
 */

import { SEARCH_INDICATORS } from "./catalog.js";
import { GET_DATA } from "./data.js";
import { DEEP_RESEARCH_TOOLS } from "./deep-research.js";
import { GET_INDICATOR_METADATA, LIST_DIMENSION_VALUES } from "./metadata.js";

export const TOOL_NAMES: readonly string[] = [
  SEARCH_INDICATORS,
  GET_INDICATOR_METADATA,
  LIST_DIMENSION_VALUES,
  GET_DATA,
  // search, fetch — the ChatGPT Deep Research contract (no ilo_ prefix by design).
  ...DEEP_RESEARCH_TOOLS,
];
