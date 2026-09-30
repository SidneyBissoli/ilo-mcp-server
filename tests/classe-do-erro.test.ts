/**
 * A classe do erro sai do TIPO da falha da origem, não da frase.
 *
 * Medido em 30/09/2026, rodando `classifyError` sobre o texto que `toToolError`
 * monta: toda falha de origem (timeout, rede, abort, 429, 5xx, 4xx, 404, corpo
 * que não é JSON) saía `contrato` — o sufixo "not an invalid query" casa
 * `\binvalid` no ramo de contrato, e `contrato` fica FORA da taxa de erro do
 * painel. O teste atravessa o caminho do hook — tradução do `UpstreamError`,
 * `toToolError`, `withUsage` — porque a frase de cada fragmento sempre esteve
 * certa; o texto MONTADO é que não estava.
 */

import { describe, expect, it } from "vitest";
import { UpstreamError, type UpstreamErrorKind } from "@sbissoli/mcp-upstream";
import { translateUpstreamError } from "../src/ilostat/upstream.js";
import { IlostatUserError } from "../src/ilostat/key.js";
import { withToolErrors } from "../src/tools/errors.js";
import { withUsage } from "../src/usage-wrap.js";

async function classeGravada(erro: unknown): Promise<{ classe: string; result: unknown }> {
  const classes: string[] = [];
  const handler = withUsage(
    "ilo_get_data",
    (kind, _name, forma) => {
      if (kind === "tool_error" && forma) classes.push(forma.classe);
    },
    withToolErrors(async () => {
      throw erro;
    }),
  );
  const result = await handler({ dataflow: "DF_X" });
  expect(classes).toHaveLength(1);
  return { classe: classes[0] ?? "", result };
}

function falha(kind: UpstreamErrorKind, status?: number, body?: string): unknown {
  return translateUpstreamError(
    new UpstreamError({
      url: "https://sdmx.ilo.org/rest/data/X",
      kind,
      status,
      body,
      retryable: kind !== "not_found",
      transport: status === undefined,
      attempts: 3,
      cause: kind === "network" ? new TypeError("fetch failed") : undefined,
    }),
    "data DF_X/..",
  );
}

describe("falha da OIT é `fonte`, nunca `contrato`", () => {
  const casos: Array<[string, unknown]> = [
    ["timeout", falha("timeout")],
    ["rede", falha("network")],
    ["abort", falha("aborted")],
    ["429 com o corpo que diz 'Too Many Requests'", falha("rate_limited", 429, "Too Many Requests")],
    ["503", falha("http_5xx", 503, "<html>Service Unavailable</html>")],
    ["400", falha("http_4xx", 400, "Bad request")],
    ["corpo que não é JSON", falha("malformed_body", 200)],
  ];
  for (const [nome, erro] of casos) {
    it(nome, async () => {
      const { classe, result } = await classeGravada(erro);
      // O texto ao usuário continua o de sempre, com o sufixo.
      expect(JSON.stringify(result)).toContain("not an invalid query");
      expect(classe).toBe("fonte");
    });
  }
});

describe("o que não é falha da origem continua como era", () => {
  it("404 da origem é ausência respondida", async () => {
    expect((await classeGravada(falha("not_found", 404))).classe).toBe("nao_encontrado");
  });

  it("erro de USO segue classificado pela própria frase (aqui, instrução ao chamador)", async () => {
    const { classe } = await classeGravada(
      new IlostatUserError("The query is too broad. Narrow it: fewer areas (maximum 30 per call)."),
    );
    expect(classe).toBe("contrato");
  });
});

describe("a classe viaja FORA do fio", () => {
  it("o resultado serializado não ganha chave nenhuma", async () => {
    const { result } = await classeGravada(falha("timeout"));
    expect(Object.keys(result as object).sort()).toEqual(["content", "isError"]);
  });
});
