/**
 * O vocabulário da pergunta contra o da fonte.
 *
 * Os casos são os MEDIDOS no catálogo oficial em 2026-09-13 (1.212 dataflows):
 * "wages", "salary", "informality", "labor", "labor force", "workforce",
 * "gender pay gap", "productivity" e "jobless" devolviam ZERO, com o indicador
 * existindo sob a grafia da OIT. As linhas de fixture abaixo são nomes REAIS do
 * catálogo (copiados de /dataflow/ILO?detail=allstubs), para o teste não provar
 * uma tabela contra si mesma.
 */

import { describe, expect, it } from "vitest";
import { searchRows, type CatalogRow } from "../src/ilostat/catalog-memory.js";
import { askedWordsFor, expandTerm, queryTerms, vocabularyNotes, expandQuery } from "../src/ilostat/vocabulary.js";

function row(id: string, name: string, weight = 0): CatalogRow {
  return { id, agency: "ILO", version: "1.0", name, idLc: id.toLowerCase(), nameLc: name.toLowerCase(), searchWeight: weight };
}

// Nomes reais do catálogo da OIT.
const CATALOGO: CatalogRow[] = [
  row("DF_EAR_4MTH_SEX_ECO_CUR_NB", "Average monthly earnings of employees by sex and economic activity", 9),
  row("DF_EAR_GGAP_OCU_RT", "Gender wage gap by occupation", 5),
  row("DF_EAR_XTMN_CUR_NB", "Monthly minimum wage", 4),
  row("DF_UNE_2EAP_SEX_AGE_RT", "Unemployment rate by sex and age -- ILO modelled estimates, Nov. 2025", 10),
  row("DF_EMP_2IFL_SEX_RT", "Informal employment rate by sex -- ILO modelled estimates, Nov. 2025", 8),
  row("DF_EAP_2WAP_SEX_AGE_RT", "Labour force participation rate by sex and age -- ILO modelled estimates, Nov. 2025", 9),
  row("DF_GDP_205U_NOC_NB", "Output per worker, GDP constant 2015 US $ -- ILO modelled estimates, Nov. 2025", 7),
  row("DF_ILR_TUMT_NOC_RT", "Trade union density rate", 3),
  row("DF_SDG_0111_SEX_AGE_RT", "SDG indicator 1.1.1: Working poverty rate by sex and age", 6),
  row("DF_EMP_TEMP_SEX_MIG_NB", "Employment by sex and migrant status", 2),
  row("DF_SDG_F881_SEX_MIG_RT", "Cases of fatal occupational injury by economic activity", 2),
];

function busca(q: string) {
  return searchRows(CATALOGO, q, 20, 0);
}

describe("expansão de termo", () => {
  it("plural e sinônimo medidos: wages → earnings, wage", () => {
    expect(expandTerm("wages")).toContain("earnings");
    expect(expandTerm("wages")).toContain("wage");
  });

  it("grafia americana: labor → labour", () => {
    expect(expandTerm("labor")).toContain("labour");
  });

  it("o próprio termo vem primeiro — expandir nunca perde o que já casava", () => {
    expect(expandTerm("unemployment")[0]).toBe("unemployment");
    expect(expandTerm("rates")).toContain("rate");
  });

  it("a flexão não fabrica caco: wages não vira wag", () => {
    expect(expandTerm("wages")).not.toContain("wag");
    expect(expandTerm("countries")).toContain("country");
  });

  it("stopword não entra no AND, mas consulta só de stopword continua valendo", () => {
    expect(queryTerms("hours of work")).toEqual(["hours", "work"]);
    expect(queryTerms("of")).toEqual(["of"]);
  });
});

describe("busca com o vocabulário do usuário", () => {
  it("wages acha os earnings da OIT", () => {
    const r = busca("wages");
    expect(r.total).toBeGreaterThan(0);
    expect(r.entries.map((e) => e.id)).toContain("DF_EAR_4MTH_SEX_ECO_CUR_NB");
  });

  it("salary, que não existe em nenhum nome do catálogo, também acha", () => {
    expect(busca("salary").total).toBeGreaterThan(0);
  });

  it("informality acha informal", () => {
    expect(busca("informality").entries.map((e) => e.id)).toContain("DF_EMP_2IFL_SEX_RT");
  });

  it("labor force participation (grafia americana) acha labour force", () => {
    expect(busca("labor force participation").entries.map((e) => e.id)).toContain("DF_EAP_2WAP_SEX_AGE_RT");
  });

  it("workforce acha labour force", () => {
    expect(busca("workforce").entries.map((e) => e.id)).toContain("DF_EAP_2WAP_SEX_AGE_RT");
  });

  it("gender pay gap acha o Gender wage gap", () => {
    expect(busca("gender pay gap").entries.map((e) => e.id)).toContain("DF_EAR_GGAP_OCU_RT");
  });

  it("productivity acha output per worker (apelido de frase, não de palavra)", () => {
    expect(busca("productivity").entries.map((e) => e.id)).toContain("DF_GDP_205U_NOC_NB");
  });

  it("jobless acha unemployment", () => {
    expect(busca("jobless").entries.map((e) => e.id)).toContain("DF_UNE_2EAP_SEX_AGE_RT");
  });

  it("unionization acha trade union", () => {
    expect(busca("unionization").entries.map((e) => e.id)).toContain("DF_ILR_TUMT_NOC_RT");
  });

  it("working poor acha working poverty", () => {
    expect(busca("working poor").entries.map((e) => e.id)).toContain("DF_SDG_0111_SEX_AGE_RT");
  });

  it("accidents acha occupational injury", () => {
    expect(busca("accidents").entries.map((e) => e.id)).toContain("DF_SDG_F881_SEX_MIG_RT");
  });

  it("o que já funcionava continua funcionando, e na mesma ordem (SEARCH_WEIGHT)", () => {
    const r = busca("rate sex");
    expect(r.total).toBeGreaterThan(3);
    expect(r.entries[0]?.id).toBe("DF_UNE_2EAP_SEX_AGE_RT"); // peso 10
  });

  it("termo sem correspondência nenhuma segue devolvendo zero — expandir não inventa dado", () => {
    expect(busca("telework").total).toBe(0);
    expect(busca("cryptocurrency").total).toBe(0);
  });
});

describe("a tradução é dita, não é silenciosa", () => {
  it("a nota nomeia o termo e a grafia da OIT", () => {
    const notas = busca("wages").notes;
    expect(notas).toHaveLength(1);
    expect(notas[0]).toContain('"wages"');
    expect(notas[0]).toContain("earnings");
  });

  it("termo que já é o da OIT não gera nota", () => {
    expect(busca("unemployment rate").notes).toEqual([]);
  });

  it("vocabularyNotes só fala dos termos que a TABELA traduziu, não do plural", () => {
    expect(vocabularyNotes(expandQuery("rates"))).toEqual([]);
  });
});

describe("a ponta inversa, para o índice de search (Deep Research)", () => {
  it("um dataflow de earnings é encontrável por wages, salary e pay", () => {
    const k = askedWordsFor("Average monthly earnings of employees by sex and economic activity");
    expect(k).toEqual(expect.arrayContaining(["wages", "salary", "pay"]));
  });

  it("um dataflow de labour force é encontrável por labor e workforce", () => {
    const k = askedWordsFor("Labour force participation rate by sex and age");
    expect(k).toEqual(expect.arrayContaining(["labor", "workforce"]));
  });

  it("nome sem palavra da tabela não ganha keyword", () => {
    expect(askedWordsFor("Hours of work per week")).toEqual([]);
  });
});
