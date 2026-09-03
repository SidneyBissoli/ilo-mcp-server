/**
 * Contrato de saída: o `structuredContent` obedece ao `outputSchema` anunciado.
 *
 * Por que este arquivo existe. O SDK v2 exige `structuredContent` em todo
 * sucesso de tool com `outputSchema`; a spec do MCP exige, além disso, que o
 * conteúdo OBEDEÇA ao schema, e cliente que valida — o MCP Inspector valida —
 * rejeita a resposta INTEIRA quando não obedece. Rodar o Inspector em
 * `tools/list` não pega nada: só `tools/call` expõe.
 *
 * Aqui os schemas nascem do zod, então o caminho feliz passa mesmo com um
 * schema desonesto. O defeito mora onde a fonte OMITE um campo: ausência vira
 * `undefined`, `JSON.stringify` apaga a chave, e num campo obrigatório isso
 * chega ao cliente como "missing required property". Por isso cada tool tem um
 * caso CHEIO e um caso MAGRO, com os campos opcionais do SDMX ausentes.
 *
 * O teste roda o servidor de verdade (`buildServer`) pelo transporte em
 * memória e valida contra o schema que o `tools/list` publica, com o mesmo
 * validador do SDK. A rede nunca é tocada.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/server/validators/cf-worker";
import { buildServer } from "../src/server.js";
import { resetIndex } from "../src/tools/deep-research.js";
import type { Env } from "../src/types.js";

const validador = new CfWorkerJsonSchemaValidator();

// ---------------------------------------------------------------------------
// Fontes falsas
// ---------------------------------------------------------------------------

const ROW = { id: "DF_UNE_DEAP_SEX_AGE_RT", agency: "ILO", version: "1.0", name: "Unemployment rate by sex and age" };
// Não há linha com `name` nulo a cobrir: no seed a coluna é `TEXT NOT NULL` e
// o gerador cai para `df.names.en ?? df.id` quando a fonte não publica o nome.

/**
 * D1 falso: roteia pelos trechos de SQL que `searchCatalog` e `listCatalog`
 * usam. `first`/`all` respondem com e sem `bind` — a listagem inteira do
 * catálogo (`SELECT … FROM dataflows ORDER BY id`) não tem parâmetro.
 */
function fakeDb(opts: { rows: unknown[]; total: number; retrievedAt: string | null }): D1Database {
  const db = {
    prepare(sql: string) {
      const statement = {
        bind: (..._params: unknown[]) => statement,
        async first() {
          if (sql.includes("catalog_meta")) return opts.retrievedAt === null ? null : { value: opts.retrievedAt };
          if (sql.includes("COUNT(*)")) return { n: opts.total };
          return null;
        },
        async all() {
          return { results: opts.rows };
        },
      };
      return statement;
    },
  };
  return db as unknown as D1Database;
}

/** Estrutura SDMX completa: nome do dataflow, LAST_UPDATE, codelists e dimensão temporal. */
function estruturaCheia() {
  return {
    data: {
      dataflows: [
        {
          id: "DF_UNE_DEAP_SEX_AGE_RT",
          version: "1.0",
          agencyID: "ILO",
          name: "Unemployment rate by sex and age",
          annotations: [
            { type: "LAST_UPDATE", title: "31/07/2026 20:54:15" },
            { type: "DEFAULT", title: "FREQ=A,SEX=SEX_T" },
          ],
        },
      ],
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
}

/**
 * Estrutura MAGRA: dataflow sem `name`, sem anotação LAST_UPDATE (sem vintage),
 * dimensão SEM codelist e SEM dimensão temporal. É o caminho que produz os
 * quatro nulos do schema de metadados de uma vez só.
 */
function estruturaMagra() {
  return {
    data: {
      dataflows: [{ id: "DF_UNE_DEAP_SEX_AGE_RT", version: "1.0", agencyID: "ILO", annotations: [] }],
      dataStructures: [
        {
          dataStructureComponents: {
            dimensionList: {
              dimensions: [{ id: "REF_AREA", localRepresentation: { enumeration: "urn:x:Codelist=ILO:CL_AREA(1.0)" } }, { id: "SEX" }],
              timeDimensions: [],
            },
          },
        },
      ],
      codelists: [],
    },
  };
}

function codelistCheia() {
  return {
    data: {
      codelists: [
        {
          id: "CL_SEX",
          version: "1.0",
          agencyID: "ILO",
          name: "Sex",
          codes: [
            { id: "SEX_T", name: "Total" },
            { id: "SEX_M", name: "Male" },
          ],
        },
      ],
    },
  };
}

/** Codelist sem `name` na lista e sem `name` nos códigos — ambos anuláveis. */
function codelistMagra() {
  return {
    data: {
      codelists: [{ id: "CL_SEX", version: "1.0", agencyID: "ILO", codes: [{ id: "SEX_T" }] }],
    },
  };
}

function dadosCheios() {
  return {
    data: {
      structure: {
        name: "Unemployment rate by sex and age",
        dimensions: {
          series: [
            { id: "REF_AREA", values: [{ id: "BRA" }] },
            { id: "SEX", values: [{ id: "SEX_T" }] },
          ],
          observation: [{ id: "TIME_PERIOD", values: [{ id: "2023" }, { id: "2024" }] }],
        },
        attributes: { observation: [{ id: "OBS_STATUS", values: [{ id: "B", name: "Break in series" }] }] },
      },
      dataSets: [{ series: { "0:0": { observations: { "0": [7.9, 0], "1": [6.6] } } } }],
    },
  };
}

/** Consulta válida cujo recorte não tem observação publicada. */
function dadosVazios() {
  return {
    data: {
      structure: {
        dimensions: { series: [{ id: "REF_AREA", values: [{ id: "BRA" }] }], observation: [{ id: "TIME_PERIOD", values: [] }] },
        attributes: { observation: [] },
      },
      dataSets: [{ series: {} }],
    },
  };
}

interface Fontes {
  estrutura: unknown;
  codelist: unknown;
  dados: unknown;
}

function stubFetch(f: Fontes): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/dataflow/")) return new Response(JSON.stringify(f.estrutura), { status: 200 });
      if (url.includes("/codelist/")) return new Response(JSON.stringify(f.codelist), { status: 200 });
      if (url.includes("/data/")) return new Response(JSON.stringify(f.dados), { status: 200 });
      throw new Error(`fetch inesperado: ${url}`);
    }),
  );
}

const FONTES_CHEIAS: Fontes = { estrutura: estruturaCheia(), codelist: codelistCheia(), dados: dadosCheios() };
const FONTES_MAGRAS: Fontes = { estrutura: estruturaMagra(), codelist: codelistMagra(), dados: dadosVazios() };

// ---------------------------------------------------------------------------
// Casos
// ---------------------------------------------------------------------------

interface Caso {
  nome: string;
  cobre: string;
  env: Env;
  fontes: Fontes;
  args: Record<string, unknown>;
}

const CASOS: Caso[] = [
  {
    nome: "ilo_search_indicators",
    cobre: "catálogo com achados",
    env: { CATALOG_DB: fakeDb({ rows: [ROW], total: 1, retrievedAt: "2026-08-07T12:00:00Z" }) },
    fontes: FONTES_CHEIAS,
    args: { query: "unemployment rate" },
  },
  {
    nome: "ilo_search_indicators",
    cobre: "busca sem achado (indicators vazio, next_offset ausente)",
    env: { CATALOG_DB: fakeDb({ rows: [], total: 0, retrievedAt: "2026-08-07T12:00:00Z" }) },
    fontes: FONTES_CHEIAS,
    args: { query: "zzzznaoexiste" },
  },
  {
    nome: "ilo_search_indicators",
    cobre: "página intermediária (next_offset presente)",
    env: { CATALOG_DB: fakeDb({ rows: [ROW], total: 50, retrievedAt: "2026-08-07T12:00:00Z" }) },
    fontes: FONTES_CHEIAS,
    args: { query: "rate", limit: 1, offset: 0 },
  },
  {
    nome: "ilo_get_indicator_metadata",
    cobre: "estrutura completa",
    env: {},
    fontes: FONTES_CHEIAS,
    args: { dataflow: "DF_UNE_DEAP_SEX_AGE_RT" },
  },
  {
    nome: "ilo_get_indicator_metadata",
    cobre: "sem name, sem vintage, dimensão sem codelist, sem dimensão temporal",
    env: {},
    fontes: FONTES_MAGRAS,
    args: { dataflow: "DF_UNE_DEAP_SEX_AGE_RT" },
  },
  {
    nome: "ilo_get_indicator_metadata",
    cobre: "modo detailed da proveniência",
    env: {},
    fontes: FONTES_CHEIAS,
    args: { dataflow: "DF_UNE_DEAP_SEX_AGE_RT", provenance_mode: "detailed" },
  },
  {
    nome: "ilo_list_dimension_values",
    cobre: "codelist completa",
    env: {},
    fontes: FONTES_CHEIAS,
    args: { dataflow: "DF_UNE_DEAP_SEX_AGE_RT", dimension: "SEX" },
  },
  {
    nome: "ilo_list_dimension_values",
    cobre: "códigos sem label (values[].name nulo)",
    env: {},
    fontes: { ...FONTES_CHEIAS, codelist: codelistMagra() },
    args: { dataflow: "DF_UNE_DEAP_SEX_AGE_RT", dimension: "SEX" },
  },
  {
    nome: "ilo_get_data",
    cobre: "observações com atributos",
    env: {},
    fontes: FONTES_CHEIAS,
    args: { dataflow: "DF_UNE_DEAP_SEX_AGE_RT", filters: { REF_AREA: "BRA" } },
  },
  {
    nome: "ilo_get_data",
    cobre: "recorte sem observação publicada (rows vazio, dataflow.name nulo)",
    env: {},
    fontes: { estrutura: estruturaMagra(), codelist: codelistMagra(), dados: dadosVazios() },
    args: { dataflow: "DF_UNE_DEAP_SEX_AGE_RT", filters: { REF_AREA: "BRA" } },
  },
  // search/fetch (contrato Deep Research): o índice nasce do catálogo inteiro
  // (`listCatalog`, D1 falso) e é guardado no módulo — `resetIndex` no afterEach
  // garante que cada caso constrói o seu.
  {
    nome: "search",
    cobre: "índice com achado",
    env: { CATALOG_DB: fakeDb({ rows: [ROW], total: 1, retrievedAt: "2026-08-07T12:00:00Z" }) },
    fontes: FONTES_CHEIAS,
    args: { query: "unemployment rate" },
  },
  {
    nome: "search",
    cobre: "busca sem achado (results vazio)",
    env: { CATALOG_DB: fakeDb({ rows: [ROW], total: 1, retrievedAt: "2026-08-07T12:00:00Z" }) },
    fontes: FONTES_CHEIAS,
    args: { query: "zzzznaoexiste" },
  },
  {
    nome: "fetch",
    cobre: "documento de dataflow com estrutura completa",
    env: { CATALOG_DB: fakeDb({ rows: [ROW], total: 1, retrievedAt: "2026-08-07T12:00:00Z" }) },
    fontes: FONTES_CHEIAS,
    args: { id: "ind:DF_UNE_DEAP_SEX_AGE_RT" },
  },
  {
    nome: "fetch",
    cobre: "documento de dataflow sem name, sem vintage, sem default",
    env: { CATALOG_DB: fakeDb({ rows: [ROW], total: 1, retrievedAt: "2026-08-07T12:00:00Z" }) },
    fontes: FONTES_MAGRAS,
    args: { id: "ind:DF_UNE_DEAP_SEX_AGE_RT" },
  },
];

// ---------------------------------------------------------------------------

let schemas: Map<string, unknown>;

async function conectar(env: Env): Promise<Client> {
  const server = buildServer(env);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "output-contract", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

let clienteCatalogo: Client;

beforeAll(async () => {
  clienteCatalogo = await conectar({});
  const { tools } = await clienteCatalogo.listTools();
  schemas = new Map(tools.map((t) => [t.name, t.outputSchema]));
});

afterAll(async () => {
  await clienteCatalogo.close();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetIndex();
});

describe("structuredContent obedece ao outputSchema anunciado", () => {
  it.each(CASOS.map((c) => [c.nome, c.cobre, c] as const))("%s — %s", async (nome, _cobre, caso) => {
    const schema = schemas.get(nome);
    expect(schema, `tool ${nome} sem outputSchema em tools/list`).toBeDefined();

    stubFetch(caso.fontes);
    const client = await conectar(caso.env);
    try {
      const resultado = await client.callTool({ name: nome, arguments: caso.args });
      const texto = (resultado.content as Array<{ text?: string }> | undefined)?.[0]?.text;
      expect(resultado.isError, `${nome} devolveu erro: ${texto}`).toBeFalsy();
      expect(resultado.structuredContent, `${nome} sem structuredContent`).toBeDefined();

      // Valida o que o CLIENTE vê: `structuredContent` atravessa como JSON, e
      // `JSON.stringify` apaga chave cujo valor é `undefined` — num campo
      // obrigatório isso é "missing required property" do outro lado. O
      // transporte em memória não serializa, então serializa-se aqui.
      const noFio = JSON.parse(JSON.stringify(resultado.structuredContent)) as unknown;
      const veredicto = validador.getValidator(schema as never)(noFio);
      expect(veredicto.valid, `${nome}: ${veredicto.errorMessage}`).toBe(true);
    } finally {
      await client.close();
    }
  });

  /**
   * Um teste que não pode falhar não vale nada: uma saída REAL contra um
   * schema deliberadamente desonesto — a mentira exata que este arquivo
   * existe para pegar.
   */
  it("reprova um schema desonesto (prova de que o portão pode falhar)", async () => {
    stubFetch(FONTES_MAGRAS);
    const client = await conectar({});
    try {
      const resultado = await client.callTool({
        name: "ilo_get_indicator_metadata",
        arguments: { dataflow: "DF_UNE_DEAP_SEX_AGE_RT" },
      });
      const honesto = schemas.get("ilo_get_indicator_metadata") as Record<string, unknown>;
      expect(validador.getValidator(honesto as never)(resultado.structuredContent).valid).toBe(true);

      const desonesto = JSON.parse(JSON.stringify(honesto)) as { properties: Record<string, unknown> };
      // `name` é nulo nesta estrutura; anunciá-lo como string é a mentira.
      desonesto.properties.name = { type: "string" };

      const veredicto = validador.getValidator(desonesto as never)(resultado.structuredContent);
      expect(veredicto.valid).toBe(false);
      expect(veredicto.errorMessage).toContain("name");
    } finally {
      await client.close();
    }
  });

  it("toda tool anunciada declara outputSchema e tem ao menos um caso", async () => {
    const { tools } = await clienteCatalogo.listTools();
    const cobertas = new Set(CASOS.map((c) => c.nome));
    const semCaso = tools.map((t) => t.name).filter((n) => !cobertas.has(n));
    expect(semCaso, `tools sem caso de contrato: ${semCaso.join(", ")}`).toEqual([]);
    for (const t of tools) expect(t.outputSchema, `${t.name} sem outputSchema`).toBeDefined();
    expect(tools).toHaveLength(6);
  });
});
