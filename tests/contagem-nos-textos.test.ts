/**
 * Toda contagem de ferramentas escrita em texto para HUMANO bate com a
 * superfície real do servidor — e o texto em português cita as mesmas
 * ferramentas que o texto em inglês.
 *
 * POR QUE ESTE ARQUIVO EXISTE (a lição veio de fora deste repositório). A mesma
 * classe de defeito foi medida em 2026-08-31 no portfólio inteiro: a landing do
 * `ibge-br-mcp` anunciava 22 ferramentas com 21 registradas; o `server.json` do
 * `medical-terminologies-mcp` — que é o que o MCP Registry publica e os
 * diretórios copiam — dizia 37 com 31; o `README.pt-BR.md` do `bcb-br-mcp`
 * dizia 8 com 15, listava 9 e mandava usar o hostname antigo. Nenhum quebrava
 * nada, e por isso nenhum aparecia.
 *
 * A assimetria é o motor: o texto em inglês é o que se revisa a cada release, o
 * traduzido é cópia que ninguém reabre. Aqui os dois estão em dia — este teste
 * é o que mantém, e a contagem é derivada da fonte, nunca de literal
 * ([[verificacao-deriva-da-fonte]]).
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { TOOL_NAMES } from "../src/tools/index.js";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leia = (f: string) => readFileSync(join(raiz, f), "utf8");

/** Textos vivos, voltados ao público, que podem afirmar um total. */
const TEXTOS = ["README.md", "README.pt-BR.md", "server.json", "package.json", "src/config.ts"];

/** "4 tools", "4 ferramentas". */
const AFIRMACAO = /(\d+)\s+(?:tools|ferramentas)\b/gi;
/** Nomes de ferramenta e de prompt citados em crase — o par pt/en tem de bater. */
const CITADAS = /`(ilo_[a-z_0-9]+)`/g;

/** Do cabeçalho de changelog em diante o número antigo é o registro correto. */
function semHistorico(texto: string): string {
  const corte = texto.search(/^## (Changelog|Hist[óo]rico)/m);
  return corte === -1 ? texto : texto.slice(0, corte);
}

describe("contagem de ferramentas nos textos públicos", () => {
  const esperado = TOOL_NAMES.length;

  it("a lista canônica de tools é a fonte da contagem", () => {
    expect(esperado).toBeGreaterThan(0);
  });

  for (const arquivo of TEXTOS) {
    it(`${arquivo} não afirma uma contagem diferente de ${esperado}`, () => {
      const conteudo = semHistorico(leia(arquivo));
      for (const m of conteudo.matchAll(AFIRMACAO)) {
        expect(
          Number(m[1]),
          `${arquivo} anuncia "${m[0]}", mas o servidor registra ${esperado} ferramentas`,
        ).toBe(esperado);
      }
    });
  }
});

describe("paridade entre o README em inglês e o em português", () => {
  const pt = "README.pt-BR.md";

  it("o README em português existe", () => {
    expect(existsSync(join(raiz, pt)), `${pt} ausente — metade da superfície em pt`).toBe(true);
  });

  it("cita exatamente as mesmas ferramentas que o README em inglês", () => {
    const nomes = (f: string) => new Set([...leia(f).matchAll(CITADAS)].map((m) => m[1]));
    const en = nomes("README.md");
    const ptBR = nomes(pt);
    expect([...en].filter((n) => !ptBR.has(n)).sort(), "no inglês e ausentes do português").toEqual([]);
    expect([...ptBR].filter((n) => !en.has(n)).sort(), "no português e ausentes do inglês").toEqual([]);
  });

  it("tem o mesmo esqueleto de seções", () => {
    const secoes = (f: string) => (leia(f).match(/^#{2,3} /gm) ?? []).length;
    expect(secoes(pt), "número de seções divergente entre os dois READMEs").toBe(secoes("README.md"));
  });
});
