# Validação manual das respostas — eval end-to-end (07/08/2026)

Cada resposta do `evaluation.xml` foi verificada por chamada direta às tools do
servidor em produção (`https://ilo.sidneybissoli.com/mcp`), antes da rodada com
modelo, conforme o guia de evals do mcp-builder.

| # | Pergunta (resumo) | Evidência (tool + valores) | Resposta |
|---|---|---|---|
| 1 | Mercosul 2019, maior desemprego | `ilo_get_data` DF_SDG_0852_SEX_AGE_RT, SEX_T/YGE15/2019: BRA 11,936 · ARG 9,843 · URY 8,836 · PRY 6,458 | Brazil |
| 2 | Pico do Brasil 2011–2019 | mesma série, BRA 2011–2019: máx = 2017 (12,792) | 2017 |
| 3 | ZAF jovens 15–24 em 2020 | `ilo_get_data`, AGE_YTHADULT_Y15-24, ZAF 2020 = 59,359 | 59.4 |
| 4 | G7, menor desemprego feminino 2015 | SEX_F/YGE15/2015: JPN 3,092 (mín) · DEU 4,206 · USA 5,179 · GBR 5,376 · CAN 6,373 · FRA 9,878 · ITA 12,694 | Japan |
| 5 | Queda ARG 2020→2022 (p.p.) | ARG SEX_T/YGE15: 2020 11,461 · 2022 6,805 → 4,656 | 4.7 |
| 6 | Participação feminina 2019, IND × LKA | `ilo_get_data` DF_EAP_DWAP_SEX_AGE_RT SEX_F/YGE15/2019: LKA 34,396 · IND 24,038 | Sri Lanka |
| 7 | Rendimento médio mensal MEX 2019 em USD | `ilo_get_data` DF_EAR_EMTA_SEX_CUR_NB, SEX_T/CUR_TYPE_USD/2019 = 343,714 | 344 |
| 8 | Código de área da Costa do Marfim | `ilo_list_dimension_values` REF_AREA search "ivoire" → CIV (Côte d'Ivoire) | CIV |
| 9 | Chile 2019, desemprego por sexo | CHL YGE15/2019: SEX_F 8,281 > SEX_M 7,021 | Female |
| 10 | Nº de dimensões do DF_SDG_0852_SEX_AGE_RT | `ilo_get_indicator_metadata` → REF_AREA, FREQ, MEASURE, SEX, AGE | 5 |

**Nota de estabilidade**: o ILO pode revisar séries em releases futuros; as
perguntas priorizam comparações/superlativos (robustos a revisões pequenas) e os
três valores numéricos (59.4, 344, 4.7) vêm de séries de pesquisa domiciliar
histórica, raramente revisadas. Re-validar antes de reutilizar o eval após um
release do ILOSTAT.
