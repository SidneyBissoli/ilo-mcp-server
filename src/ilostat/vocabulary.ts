/**
 * O vocabulário da PERGUNTA contra o vocabulário da FONTE.
 *
 * `ilo_search_indicators` casa substrings do que o usuário escreveu contra o
 * NOME do dataflow, em AND. Isso significa que quem pergunta com a palavra
 * errada não recebe um resultado ruim: recebe ZERO, sem dizer por quê. Medido
 * no catálogo oficial de 1.212 dataflows em 2026-09-13 (`/dataflow/ILO?detail=allstubs`):
 *
 *   perguntado      n     a OIT escreve        n
 *   wages           0     earnings           107
 *   salary          0     earnings           107
 *   informality     0     informal           133
 *   gender          2     sex              1.131
 *   labor           0     labour             176
 *   labor force     0     labour force       122
 *   workforce       0     labour force       122
 *   jobless         0     unemployment       108
 *   unionization    0     trade union          1
 *   migrants        0     migrant              9
 *   accidents       0     injuries             6
 *   productivity    0     output per worker    4
 *   pay gap         0     wage gap             1
 *
 * "labor" é o caso mais caro: a grafia americana devolve zero em TODO o
 * catálogo, e as sondas de visibilidade do portfólio são em inglês.
 *
 * Regra desta tabela: só entra par MEDIDO — a palavra perguntada ausente (ou
 * quase) do catálogo e a palavra da fonte presente. Nada de sinônimo plausível
 * sem contagem; termo que não existe na fonte (telework, gig, vacancies) fica
 * de fora, porque inventar apelido para dado inexistente é prometer o que a
 * OIT não publica.
 *
 * A MECÂNICA (expansão em OR dentro do termo e AND entre termos, stopwords,
 * singular, a nota dita, a ponta inversa para o índice de `search`) mora em
 * `@sbissoli/mcp-search` desde a 0.5.0 — este servidor foi o primeiro a tê-la
 * (0.6.0) e cinco a repetiram em cópia; aqui fica só a tabela. Os nomes
 * exportados são os de sempre, para quem chama não mudar.
 */

import { createVocabulary, type ExpandedTerm, type VocabularyEntry } from "@sbissoli/mcp-search";

export type { ExpandedTerm, VocabularyEntry };

export const VOCABULARY: readonly VocabularyEntry[] = [
  { asked: "wages", source: ["earnings", "wage"] },
  { asked: "wage", source: ["earnings", "wage"] },
  { asked: "salary", source: ["earnings", "wage"] },
  { asked: "salaries", source: ["earnings", "wage"] },
  { asked: "remuneration", source: ["earnings", "wage"] },
  { asked: "pay", source: ["earnings", "wage", "pay"] },
  { asked: "informality", source: ["informal"] },
  { asked: "gender", source: ["sex", "gender"] },
  { asked: "jobless", source: ["unemployment"] },
  { asked: "joblessness", source: ["unemployment"] },
  { asked: "labor", source: ["labour"] },
  { asked: "workforce", source: ["labour force"] },
  { asked: "unionization", source: ["union"] },
  { asked: "unionisation", source: ["union"] },
  { asked: "migrants", source: ["migrant"] },
  { asked: "immigrant", source: ["migrant"] },
  { asked: "immigrants", source: ["migrant"] },
  { asked: "accidents", source: ["injuries", "injury"] },
  { asked: "accident", source: ["injuries", "injury"] },
  { asked: "productivity", source: ["output per worker"] },
  { asked: "poor", source: ["poverty"] },
];

const vocabulary = createVocabulary({ entries: VOCABULARY, locale: "en", sourceName: "ILOSTAT" });

/** Os termos efetivos da consulta: minúsculos, sem stopword, sem vazio. */
export const queryTerms = vocabulary.queryTerms;
/** Um termo e as substrings que o representam na busca (o próprio termo primeiro). */
export const expandTerm = vocabulary.expandTerm;
/** A consulta inteira, termo a termo, pronta para virar WHERE ou filtro. */
export const expandQuery = vocabulary.expandQuery;
/** A frase que conta ao chamador que a palavra dele não é a da OIT. */
export const vocabularyNotes = vocabulary.vocabularyNotes;
/** Um nome de dataflow casa o termo expandido? (mesma semântica do LIKE do D1) */
export const matchesTerm = vocabulary.matchesTerm;
/** A ponta inversa: as palavras com que se PERGUNTA por este nome — keywords do índice de `search`. */
export const askedWordsFor = vocabulary.askedWordsFor;
