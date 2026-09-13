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
 * Vale para os dois caminhos de busca, pelas duas pontas da mesma tabela:
 * `ilo_search_indicators` expande o TERMO da consulta (OR dentro do termo, AND
 * entre termos — expandir só aumenta o recall, nunca perde casamento que já
 * havia) e o índice de `search` (Deep Research) recebe a palavra perguntada
 * como KEYWORD do dataflow cujo nome traz a palavra da fonte.
 */

export interface VocabularyEntry {
  /** Como o usuário escreve. */
  readonly asked: string;
  /** Como a OIT escreve — substrings, podendo ser frase ("output per worker"). */
  readonly source: readonly string[];
}

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

const BY_ASKED: ReadonlyMap<string, readonly string[]> = new Map(VOCABULARY.map((e) => [e.asked, e.source]));

/**
 * Palavras que não carregam significado no nome de um dataflow e, em AND,
 * excluem resultado certo ("hours of work" não pode morrer no "of"). Só saem
 * quando sobra algum termo — consulta feita só de stopword continua valendo.
 */
const STOPWORDS: ReadonlySet<string> = new Set(["a", "an", "the", "of", "in", "on", "for", "and", "to", "per", "by", "with"]);

/**
 * Forma singular de um termo — a substring mais curta casa o plural também.
 * Só a regra do "s" final (e a do "ies"): tirar "es" fabricaria cacos como
 * "wages" → "wag", que casam por acidente e sujam a nota ao usuário.
 */
function singulars(term: string): string[] {
  if (term.length > 4 && term.endsWith("ies")) return [`${term.slice(0, -3)}y`];
  if (term.length > 3 && term.endsWith("s") && !term.endsWith("ss")) return [term.slice(0, -1)];
  return [];
}

/** Os termos efetivos da consulta: minúsculos, sem stopword, sem vazio. */
export function queryTerms(query: string): string[] {
  const all = query.toLowerCase().split(/\s+/).filter(Boolean);
  const kept = all.filter((t) => !STOPWORDS.has(t));
  return kept.length ? kept : all;
}

/**
 * Um termo e as substrings que o representam na busca (o próprio termo primeiro).
 * A expansão só acrescenta alternativas em OR: o que casava antes segue casando.
 */
export function expandTerm(term: string): string[] {
  const t = term.toLowerCase();
  const out = [t, ...(BY_ASKED.get(t) ?? []), ...singulars(t).flatMap((s) => [s, ...(BY_ASKED.get(s) ?? [])])];
  return [...new Set(out)];
}

export interface ExpandedTerm {
  readonly term: string;
  readonly patterns: readonly string[];
  /** A tabela (não a mera flexão de plural) mudou o que se procura. */
  readonly translated: boolean;
}

/** A consulta inteira, termo a termo, pronta para virar WHERE ou filtro. */
export function expandQuery(query: string): ExpandedTerm[] {
  return queryTerms(query).map((term) => {
    const patterns = expandTerm(term);
    const t = term.toLowerCase();
    const translated = BY_ASKED.has(t) || singulars(t).some((s) => BY_ASKED.has(s));
    return { term, patterns, translated };
  });
}

/**
 * A frase que conta ao chamador que a palavra dele não é a da OIT — sem isto a
 * tradução é invisível e o resultado parece vir do que ele escreveu.
 */
export function vocabularyNotes(expanded: readonly ExpandedTerm[]): string[] {
  return expanded
    .filter((e) => e.translated)
    .map((e) => {
      const outros = e.patterns.filter((p) => p !== e.term.toLowerCase());
      return `"${e.term}" was also searched as ${outros.join(", ")} — the wording ILOSTAT uses.`;
    });
}

/** Um nome de dataflow casa o termo expandido? (mesma semântica do LIKE do D1) */
export function matchesTerm(haystack: string, expanded: ExpandedTerm): boolean {
  return expanded.patterns.some((p) => haystack.includes(p));
}

/**
 * A ponta inversa da tabela: as palavras com que se PERGUNTA por este nome de
 * dataflow — keywords do índice de `search`, que ranqueia por relevância em vez
 * de casar substring.
 */
export function askedWordsFor(name: string): string[] {
  const lc = name.toLowerCase();
  const out = VOCABULARY.filter((e) => e.source.some((s) => lc.includes(s))).map((e) => e.asked);
  return [...new Set(out)];
}
