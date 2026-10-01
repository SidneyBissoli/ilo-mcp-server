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

import { afterEach, describe, expect, it, vi } from "vitest";
import { UpstreamError, type UpstreamErrorKind } from "@sbissoli/mcp-upstream";
import { translateUpstreamError } from "../src/ilostat/upstream.js";
import { IlostatUserError } from "../src/ilostat/key.js";
import { withToolErrors } from "../src/tools/errors.js";
import { withUsage } from "../src/usage-wrap.js";
import { getIndicatorMetadataHandler, listDimensionValuesHandler } from "../src/tools/metadata.js";
import { CLASSE_DO_ERRO } from "../src/call-shape.js";

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

  it("422 é a OIT recusando o ARGUMENTO — medido em produção com start_period \"abc\"", async () => {
    const { classe, result } = await classeGravada(
      falha("http_4xx", 422, "Semantic Error - Invalid Date Format `abc`"),
    );
    expect(classe).toBe("contrato");
    // Não manda repetir o que vai falhar de novo.
    expect(JSON.stringify(result)).not.toContain("retrying later may succeed");
    expect(JSON.stringify(result)).toContain("fix it");
  });

  it("erro de USO é `contrato` por declaração (a instrução ao chamador)", async () => {
    const { classe } = await classeGravada(
      new IlostatUserError("The query is too broad. Narrow it: fewer areas (maximum 30 per call)."),
    );
    expect(classe).toBe("contrato");
  });
});

/**
 * Erro de USO com a classe DECLARADA, atravessando o handler real da tool
 * (fetch trocado por stub, nenhuma rede). Antes, `toToolError` devolvia o
 * erro de uso sem classe e o hook caía na frase — que ecoa o argumento.
 */
describe("erro de uso: a classe é a declarada, não a da frase", () => {
  afterEach(() => vi.unstubAllGlobals());

  async function classeDoHandler(
    name: string,
    handler: (args: never) => Promise<unknown>,
    args: Record<string, unknown>,
  ): Promise<{ classe: string; result: unknown }> {
    const classes: string[] = [];
    const h = withUsage(
      name,
      (kind, _n, forma) => {
        if (kind === "tool_error" && forma) classes.push(forma.classe);
      },
      handler as (a: Record<string, unknown>) => Promise<unknown>,
    );
    const result = await h(args);
    expect(classes).toHaveLength(1);
    return { classe: classes[0] ?? "", result };
  }

  const estrutura = {
    data: {
      dataflows: [{ id: "DF_X", version: "1.0", agencyID: "ILO", name: "X" }],
      dataStructures: [
        {
          dataStructureComponents: {
            dimensionList: {
              dimensions: [
                { id: "REF_AREA", localRepresentation: { enumeration: "urn:x:Codelist=ILO:CL_AREA(1.0)" } },
                { id: "SEX", localRepresentation: { enumeration: "urn:x:Codelist=ILO:CL_SEX(1.0)" } },
              ],
              timeDimensions: [{ id: "TIME_PERIOD" }],
            },
          },
        },
      ],
      codelists: [],
    },
  };

  it("DEFEITO: dimensão fora do dataflow é `contrato` (era `nao_encontrado` por \"does not exist\")", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(estrutura), { status: 200 })));
    const { classe, result } = await classeDoHandler("ilo_list_dimension_values", listDimensionValuesHandler({}), {
      dataflow: "DF_X",
      dimension: "AGE",
    });
    expect(JSON.stringify(result)).toContain("does not exist in dataflow DF_X");
    expect(classe).toBe("contrato");
  });

  it("RISCO: dataflow que a OIT diz não existir é `nao_encontrado`, mesmo ecoando \"INVALID\"", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not found", { status: 404 })));
    const { classe, result } = await classeDoHandler(
      "ilo_get_indicator_metadata",
      getIndicatorMetadataHandler({}),
      { dataflow: "INVALID" },
    );
    expect(JSON.stringify(result)).toContain('Dataflow \\"INVALID\\" not found at ILOSTAT');
    expect(classe).toBe("nao_encontrado");
  });

  it("o erro de uso também leva a classe anexada, fora do fio", async () => {
    const { result } = await classeGravada(new IlostatUserError("Empty query: pass one or more search terms."));
    expect((result as { [CLASSE_DO_ERRO]?: unknown })[CLASSE_DO_ERRO]).toBe("contrato");
    expect(Object.keys(result as object).sort()).toEqual(["content", "isError"]);
  });
});

describe("a classe viaja FORA do fio", () => {
  it("o resultado serializado não ganha chave nenhuma", async () => {
    const { result } = await classeGravada(falha("timeout"));
    expect(Object.keys(result as object).sort()).toEqual(["content", "isError"]);
  });
});
