/**
 * Fixtures de eval de seleção de tool — consultas realistas na persona-alvo
 * (economistas do desenvolvimento, pesquisadores de trabalho, jornalistas de
 * dados). `expectedTools` = tools aceitáveis como PRIMEIRO passo.
 *
 * Regra prática: pergunta sem dataflow conhecido → search_indicators; valor
 * estatístico com dataflow em mãos → get_data; "quais recortes/dimensões" →
 * get_indicator_metadata; "quais códigos/categorias válidos" → list_dimension_values.
 */

import type { EvalFixture } from "@sbissoli/mcp-evals";

export const FIXTURES: EvalFixture[] = [
  {
    id: "search-01",
    query: "Which ILOSTAT indicators cover youth unemployment?",
    expectedTools: ["search_indicators"],
    note: "Descoberta de indicador por tema — não há dataflow em mãos.",
  },
  {
    id: "search-02",
    query: "Find me a dataflow with average monthly earnings by occupation.",
    expectedTools: ["search_indicators"],
    note: "Busca no catálogo por palavras-chave.",
  },
  {
    id: "search-03",
    query: "Is there any ILO series on informal employment rates?",
    expectedTools: ["search_indicators"],
    note: "Pergunta de existência de série = busca de catálogo.",
  },
  {
    id: "search-04",
    query: "I need statistics about occupational injuries — what does ILOSTAT have?",
    expectedTools: ["search_indicators"],
    note: "Tema amplo, primeiro passo é o catálogo.",
  },
  {
    id: "search-05",
    query: "What data does ILOSTAT publish on collective bargaining coverage?",
    expectedTools: ["search_indicators"],
    note: "Descoberta temática no catálogo local.",
  },
  {
    id: "search-06",
    query: "Procuro um indicador de horas médias trabalhadas por semana no ILOSTAT.",
    expectedTools: ["search_indicators"],
    note: "Persona lusófona; ainda é descoberta de indicador.",
  },
  {
    id: "data-01",
    query: "Get the unemployment rate for Brazil from DF_UNE_DEAP_SEX_AGE_RT for 2015-2024.",
    expectedTools: ["get_data"],
    note: "Dataflow e recorte já conhecidos — buscar o dado.",
  },
  {
    id: "data-02",
    query: "Using dataflow DF_UNE_DEAP_SEX_AGE_RT, compare female unemployment in Argentina and Chile since 2010.",
    expectedTools: ["get_data"],
    note: "Consulta de valores com dataflow em mãos.",
  },
  {
    id: "data-03",
    query: "Pull the latest observation of DF_EMP_TEMP_SEX_AGE_NB for France, total sex.",
    expectedTools: ["get_data"],
    note: "last_n_observations com dataflow explícito.",
  },
  {
    id: "data-04",
    query: "Download annual values 2000-2020 from DF_EAR_4MTH_SEX_ECO_CUR_NB for Mexico and Colombia.",
    expectedTools: ["get_data"],
    note: "Valores por período com id explícito.",
  },
  {
    id: "data-05",
    query: "From DF_UNE_DEAP_SEX_AGE_RT, get youth unemployment (AGE_YTHADULT_Y15-24) for South Africa in 2023.",
    expectedTools: ["get_data"],
    note: "Filtros completos fornecidos — chamada direta de dados.",
  },
  {
    id: "data-06",
    query: "Série 2010-2024 do DF_UNE_DEAP_SEX_AGE_RT para o Brasil, sexo total, por favor.",
    expectedTools: ["get_data"],
    note: "Persona lusófona com dataflow conhecido.",
  },
  {
    id: "meta-01",
    query: "What breakdowns does DF_UNE_DEAP_SEX_AGE_RT support — sex, age, anything else?",
    expectedTools: ["get_indicator_metadata"],
    note: "Pergunta sobre as dimensões da estrutura, não sobre valores.",
  },
  {
    id: "meta-02",
    query: "When was dataflow DF_EMP_TEMP_SEX_AGE_NB last updated by the ILO?",
    expectedTools: ["get_indicator_metadata"],
    note: "data_vintage vem dos metadados do dataflow.",
  },
  {
    id: "meta-03",
    query: "Show me the structure of DF_EAR_4MTH_SEX_ECO_CUR_NB before I query it.",
    expectedTools: ["get_indicator_metadata"],
    note: "Inspeção da estrutura pedida explicitamente.",
  },
  {
    id: "meta-04",
    query: "Does DF_UNE_DEAP_SEX_AGE_RT have a monthly frequency or only annual?",
    expectedTools: ["get_indicator_metadata", "list_dimension_values"],
    note: "Frequências disponíveis: estrutura (FREQ) ou códigos de FREQ.",
  },
  {
    id: "dim-01",
    query: "What is the ILOSTAT area code for Ivory Coast?",
    expectedTools: ["list_dimension_values"],
    note: "Código de país = valores da dimensão REF_AREA.",
  },
  {
    id: "dim-02",
    query: "List the age groups available in DF_UNE_DEAP_SEX_AGE_RT.",
    expectedTools: ["list_dimension_values"],
    note: "Categorias de uma dimensão específica.",
  },
  {
    id: "dim-03",
    query: "Which sex categories can I filter by in DF_EMP_TEMP_SEX_AGE_NB?",
    expectedTools: ["list_dimension_values"],
    note: "Códigos válidos de SEX para montar o filtro.",
  },
  {
    id: "dim-04",
    query: "Quais os códigos de área do Mercosul no ILOSTAT (Brasil, Argentina, Paraguai, Uruguai)?",
    expectedTools: ["list_dimension_values"],
    note: "Descoberta de códigos REF_AREA, persona lusófona.",
  },
  {
    id: "flow-01",
    query: "I want to build a chart of unemployment by sex in G7 countries over the last decade.",
    expectedTools: ["search_indicators"],
    note: "Fluxo completo começa descobrindo o dataflow certo.",
  },
  {
    id: "flow-02",
    query: "How did labour force participation of women evolve in Southeast Asia since 2000?",
    expectedTools: ["search_indicators"],
    note: "Sem dataflow em mãos — catálogo primeiro.",
  },
  {
    id: "flow-03",
    query: "Compare minimum wages across Latin America using ILO data.",
    expectedTools: ["search_indicators"],
    note: "Tema (salário mínimo) ainda sem dataflow identificado.",
  },
  {
    id: "flow-04",
    query: "Get me ILO unemployment figures for every country in the world for 2024.",
    expectedTools: ["search_indicators", "list_dimension_values"],
    note: "Painel amplo: achar o dataflow e/ou os códigos de área para paginar em lotes de 30.",
  },
  {
    id: "uis-search-01",
    query: "Which UNESCO indicators track out-of-school children?",
    expectedTools: ["uis_search_indicators"],
    note: "Tema de educação = fonte UIS, descoberta de indicador.",
  },
  {
    id: "uis-search-02",
    query: "Does UNESCO publish statistics on R&D researchers per million inhabitants?",
    expectedTools: ["uis_search_indicators"],
    note: "Ciência/P&D é tema UIS, não OIT — a seleção entre fontes é o que se testa.",
  },
  {
    id: "uis-search-03",
    query: "Quero indicadores da UNESCO sobre patrimônio cultural e museus.",
    expectedTools: ["uis_search_indicators"],
    note: "Tema de cultura, persona lusófona.",
  },
  {
    id: "uis-search-04",
    query: "What education spending indicators are available from the UIS?",
    expectedTools: ["uis_search_indicators"],
    note: "Fonte nomeada (UIS) + descoberta temática.",
  },
  {
    id: "uis-data-01",
    query: "Get the UIS completion rate indicator CR.1 for Brazil since 2010.",
    expectedTools: ["uis_get_data"],
    note: "Código de indicador UIS em mãos — buscar o dado.",
  },
  {
    id: "uis-data-02",
    query: "Pull UNESCO literacy data for indicator LR.AG15T99 in Argentina and Chile, 2015-2023.",
    expectedTools: ["uis_get_data"],
    note: "Consulta de valores com códigos e recorte completos.",
  },
  {
    id: "uis-geo-01",
    query: "What geo unit code does the UNESCO UIS API use for the Ivory Coast?",
    expectedTools: ["uis_list_geo_units"],
    note: "Código de país do lado UIS (não confundir com REF_AREA do ILOSTAT).",
  },
  {
    id: "uis-cross-01",
    query: "How does youth unemployment relate to school completion in Brazil?",
    expectedTools: ["search_indicators", "uis_search_indicators"],
    note: "Pergunta cruzada OIT×UIS: qualquer uma das duas descobertas é primeiro passo válido.",
  },
];
