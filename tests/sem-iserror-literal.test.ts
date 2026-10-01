/**
 * Guarda: todo resultado de erro de tool sai de `toToolError`, que anexa a
 * classe (`CLASSE_DO_ERRO`). Um `{ ..., isError: true }` montado à mão em
 * outro arquivo nasce SEM classe, e o hook cai na frase — onde o argumento
 * ecoado decide (defeito do medical em 30/09/2026: "INVALID" casou
 * `\binvalid` e saiu `contrato` em vez de `nao_encontrado`).
 *
 * Varre `src/` (código de produção) e reprova `isError: true` fora dos
 * arquivos permitidos. Comentários não contam.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "src");

/** Arquivos onde `isError: true` literal é permitido, e por quê. */
const PERMITIDOS: Record<string, string> = {
  // O helper central: o tipo `ToolErrorResult` e os dois ramos de
  // `toToolError`, ambos passando por `comClasse`.
  "tools/errors.ts": "helper que anexa a classe",
};

function arquivos(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = join(dir, d.name);
    if (d.isDirectory()) return arquivos(p);
    return /\.(ts|mts|js)$/.test(d.name) ? [p] : [];
  });
}

/** Remove comentários de bloco e de linha (o bastante para esta varredura). */
function semComentarios(codigo: string): string {
  return codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

describe("nenhum `isError: true` literal fora do helper de erro", () => {
  it("src/ só monta resultado de erro por `toToolError`", () => {
    const violacoes: string[] = [];
    for (const f of arquivos(SRC)) {
      const rel = relative(SRC, f).split(sep).join("/");
      if (rel in PERMITIDOS) continue;
      const linhas = semComentarios(readFileSync(f, "utf8")).split("\n");
      linhas.forEach((l, i) => {
        if (/\bisError\s*:\s*true\b/.test(l)) violacoes.push(`src/${rel}:${i + 1}: ${l.trim()}`);
      });
    }
    expect(violacoes).toEqual([]);
  });

  it("a lista de permitidos não aponta para arquivo que sumiu", () => {
    const existentes = new Set(arquivos(SRC).map((f) => relative(SRC, f).split(sep).join("/")));
    for (const p of Object.keys(PERMITIDOS)) expect(existentes.has(p), p).toBe(true);
  });
});
