/**
 * A fronteira de palavra, provada nos DOIS caminhos de busca deste servidor.
 *
 * `searchCatalog` empurra o filtro para o D1 quando há banco, e cai em
 * `CATALOG_MEMORY` no runtime stdio. Os dois têm de responder igual — senão a
 * resposta muda com o transporte, o que é pior que responder errado nos dois.
 *
 * Até a 0.6.1 o SQL era `name_lc LIKE '%p%'`, substring em qualquer posição. O
 * caso caro deste catálogo é `formal` dentro de `informal`: quem pergunta por
 * emprego FORMAL recebia emprego INFORMAL, que é o oposto, sem dar erro. A mesma
 * classe medida em 22/09/2026 no IBGE (`uber` dentro de `TUBÉRCULOS`, `idade`
 * dentro de `atividade`) e na UIS (`male` dentro de `female`).
 *
 * O D1 falso de `tools-catalog.test.ts` roteia por trechos de SQL e NÃO executa
 * SQL — ele abençoaria um `GLOB` errado do mesmo jeito que abençoava o `LIKE`.
 * Por isso aqui o WHERE gerado roda contra um SQLite DE VERDADE (`node:sqlite`,
 * o mesmo motor do D1).
 */

import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { searchCatalog } from "../src/ilostat/catalog.js";
import { expandQuery, matchesTerm } from "../src/ilostat/vocabulary.js";
import type { Env } from "../src/types.js";

/** Como `name_lc` e `id_lc` são de fato construídos (scripts/seed-catalog.mjs). */
const lc = (s: string): string => s.toLowerCase();

/**
 * D1 falso que só CAPTURA o SQL e os parâmetros que `searchCatalog` monta — é
 * o elo entre o código de produção e o SQLite de verdade lá embaixo. Sem ele o
 * teste provaria a semântica de um SQL transcrito à mão, e `catalog.ts` poderia
 * estar montando outra coisa sem ninguém perceber.
 */
function capturaSql(): { db: D1Database; capturado: { sql: string; params: unknown[] }[] } {
  const capturado: { sql: string; params: unknown[] }[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind: (...params: unknown[]) => {
          capturado.push({ sql, params });
          return {
            async first() {
              return sql.includes("COUNT(*)") ? { n: 0 } : { value: "2026-09-22T00:00:00Z" };
            },
            async all() {
              return { results: [] };
            },
          };
        },
      };
    },
  };
  return { db: db as unknown as D1Database, capturado };
}

/** O SQL REAL de `searchCatalog`, capturado e pronto para rodar no SQLite. */
async function whereReal(query: string): Promise<{ sql: string; params: string[] }> {
  const { db, capturado } = capturaSql();
  await searchCatalog({ CATALOG_DB: db } as Env, query, 10, 0);
  const sel = capturado.find((c) => c.sql.includes("SELECT id, agency"));
  if (!sel) throw new Error("searchCatalog não emitiu o SELECT do catálogo");
  const m = /WHERE ([\s\S]+?) ORDER BY/.exec(sel.sql);
  const where = m?.[1];
  if (!where) throw new Error(`WHERE não encontrado em: ${sel.sql}`);
  return { sql: where, params: sel.params as string[] };
}

/**
 * A transcrição do WHERE, mantida ao lado do real de propósito: um teste
 * abaixo exige que os dois batam, então esta cópia é o valor ESPERADO e o
 * `catalog.ts` é o medido — conferidor e consertador não partilham código.
 */
function whereDeBusca(query: string): { sql: string; params: string[] } {
  const params: string[] = [];
  const sql = expandQuery(query)
    .map((t) => {
      const conds = t.patterns.flatMap((p) => {
        const limpo = p.replace(/[*?[\]]/g, "");
        if (!limpo) return [];
        params.push(`${limpo}*`, `*[^a-z0-9]${limpo}*`);
        const a = params.length - 1;
        const b = params.length;
        return [`name_lc GLOB ?${a} OR name_lc GLOB ?${b} OR id_lc GLOB ?${a} OR id_lc GLOB ?${b}`];
      });
      return `(${conds.length ? conds.join(" OR ") : "0 = 1"})`;
    })
    .join(" AND ");
  return { sql, params };
}

/** Nomes REAIS de dataflows do ILOSTAT, mais os vizinhos que o defeito trazia. */
const NOMES = [
  "Employment distribution by sex and age (thousands)",
  "Employment by sex and economic activity -- ILO modelled estimates",
  "Female share of employment in managerial positions",
  "Mean nominal monthly earnings of employees by sex",
  "Labour force participation rate by sex and age",
  "Informal employment rate by sex",
  "Formal employment by economic activity",
  "Average hours actually worked per week",
  "Occupational injuries per 100000 workers",
];

const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE dataflows (id TEXT, name TEXT, name_lc TEXT, id_lc TEXT)");
const ins = db.prepare("INSERT INTO dataflows VALUES (?, ?, ?, ?)");
for (const [i, nome] of NOMES.entries()) ins.run(`DF_${i}`, nome, lc(nome), `df_${i}`);

/** O caminho do D1: o WHERE que o `catalog.ts` monta, rodado no SQLite. */
const noSql = async (query: string): Promise<string[]> => {
  const { sql, params } = await whereReal(query);
  return db
    .prepare(`SELECT name FROM dataflows WHERE ${sql}`)
    .all(...params)
    .map((r) => String(r.name));
};

/** O caminho de memória: o casador de `@sbissoli/mcp-search`. */
const naMemoria = (query: string): string[] => {
  const expanded = expandQuery(query);
  return NOMES.filter((n) => expanded.every((t) => matchesTerm(lc(n), t)));
};

describe("o padrão casa o INÍCIO de uma palavra, nunca o miolo", () => {
  it("'formal' deixa de trazer 'informal', que é o OPOSTO", async () => {
    // O defeito caro deste catálogo: quem pergunta por emprego formal recebia
    // emprego informal, calado. Com `LIKE '%formal%'` os dois vinham juntos.
    expect(await noSql("formal")).toEqual(["Formal employment by economic activity"]);
  });

  it("e 'informal' continua achando o dele", async () => {
    expect(await noSql("informal")).toEqual(["Informal employment rate by sex"]);
  });

  it("'female' não some — é palavra inteira onde aparece", async () => {
    expect(await noSql("female")).toEqual(["Female share of employment in managerial positions"]);
  });

  it("RADICAL da tabela segue valendo — é prefixo de palavra, não miolo", async () => {
    // labor → labour alcança "Labour force"; accidents → injuries.
    expect(await noSql("labor")).toContain("Labour force participation rate by sex and age");
    expect(await noSql("accidents")).toContain("Occupational injuries per 100000 workers");
    // wages → earnings
    expect(await noSql("wages")).toContain("Mean nominal monthly earnings of employees by sex");
  });

  it("separador que não é espaço abre palavra: parêntese e hífen", async () => {
    expect(await noSql("thousands")).toContain("Employment distribution by sex and age (thousands)");
    expect(await noSql("ilo")).toContain(
      "Employment by sex and economic activity -- ILO modelled estimates",
    );
  });

  it("consulta feita só de metacaractere de GLOB não casa TUDO", async () => {
    // Sem a guarda, o padrão higienizado vira "" e `GLOB '*'` traz o catálogo
    // inteiro — o oposto de zero, e mais difícil de perceber.
    const { sql } = whereDeBusca("***");
    expect(sql).toContain("0 = 1");
    expect(await noSql("***")).toEqual([]);
  });
});

describe("o SQL de produção é o que este teste acha que é", () => {
  // Sem isto, tudo acima provaria a semântica de um WHERE transcrito à mão
  // enquanto `catalog.ts` montava outra coisa. Aqui o medido é o código de
  // produção e o esperado é a transcrição.
  it.each(["formal", "labor", "wages", "employment rate"])(
    "'%s': catalog.ts monta o WHERE esperado",
    async (query) => {
      const real = await whereReal(query);
      const esperado = whereDeBusca(query);
      expect(real.sql).toBe(esperado.sql);
      expect(real.params).toEqual(esperado.params);
    },
  );

  it("e é GLOB, não LIKE — `LIKE '%p%'` É o casamento sem fronteira", async () => {
    const { sql, params } = await whereReal("formal");
    expect(sql).toContain("GLOB");
    expect(sql).not.toContain("LIKE");
    expect(params).toContain("formal*");
    expect(params).toContain("*[^a-z0-9]formal*");
  });
});

describe("os dois caminhos de busca respondem igual", () => {
  // Se divergirem, a resposta muda conforme o transporte (HTTP com D1 × stdio
  // em memória), que é a pior forma de errar: nem sempre, e sem aviso.
  it.each([
    "formal",
    "informal",
    "female",
    "labor",
    "accidents",
    "wages",
    "employment",
    "sex",
    "hours",
    "informal",
    "rate",
  ])("'%s' devolve o mesmo no D1 e em memória", async (query) => {
    expect((await noSql(query)).sort()).toEqual(naMemoria(query).sort());
  });
});
