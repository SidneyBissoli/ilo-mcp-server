/**
 * Resposta que junta leituras de momentos distintos: o `retrieved_at` do bloco é o
 * MAIS ANTIGO delas, e `field_sources` diz de quando é cada uma (contrato §3).
 *
 * Medido em produção em 08/10/2026, na 1.6.0: `ilo_get_data` informava o instante dos
 * dados (buscados agora) enquanto o `data_vintage` e o dataflow vinham da estrutura
 * guardada no KV até 24 h antes — o bloco dizia "extraído agora" sobre uma parte de
 * ontem. `ilo_list_dimension_values` fazia o mesmo com estrutura × codelist. Os
 * cenários abaixo são os da medição: estrutura no KV de ontem, dados agora.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { currentCall } from "@sbissoli/mcp-upstream/als";
import { getDataflowStructure, structureUrl } from "../src/ilostat/sdmx.js";
import { withUpstreamCall } from "../src/ilostat/upstream.js";
import { getDataHandler } from "../src/tools/data.js";
import { listDimensionValuesHandler } from "../src/tools/metadata.js";
import type { Env } from "../src/types.js";

const ONTEM = "2026-10-07T09:00:00Z";
const HA_UMA_HORA = new Date(Date.now() - 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z");

/** KV em memória com a interface que `sdmx.ts` usa (get json / put com TTL). */
function fakeKv() {
  const store = new Map<string, string>();
  return {
    store,
    kv: {
      async get<T>(key: string, _type: "json"): Promise<T | null> {
        const v = store.get(key);
        return v === undefined ? null : (JSON.parse(v) as T);
      },
      async put(key: string, value: string): Promise<void> {
        store.set(key, value);
      },
    },
  };
}

function structureMessage() {
  return {
    data: {
      dataflows: [
        {
          id: "DF_UNE_DEAP_SEX_AGE_RT",
          version: "1.0",
          agencyID: "ILO",
          name: "Unemployment rate by sex and age",
          annotations: [{ type: "LAST_UPDATE", title: "31/07/2026 20:54:15" }],
        },
      ],
      dataStructures: [
        {
          dataStructureComponents: {
            dimensionList: {
              dimensions: [
                { id: "REF_AREA", localRepresentation: { enumeration: "urn:x:Codelist=ILO:CL_AREA(1.0)" } },
                { id: "FREQ", localRepresentation: { enumeration: "urn:x:Codelist=ILO:CL_FREQ(1.0)" } },
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

function dataMessage() {
  return {
    data: {
      structure: {
        name: "Unemployment rate by sex and age",
        dimensions: {
          series: [
            { id: "REF_AREA", values: [{ id: "BRA" }] },
            { id: "SEX", values: [{ id: "SEX_T" }] },
          ],
          observation: [{ id: "TIME_PERIOD", values: [{ id: "2023" }] }],
        },
      },
      dataSets: [{ series: { "0:0": { observations: { "0": [7.9] } } } }],
    },
  };
}

function stubFetch() {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/dataflow/")) return new Response(JSON.stringify(structureMessage()), { status: 200 });
      if (url.includes("/data/")) return new Response(JSON.stringify(dataMessage()), { status: 200 });
      throw new Error(`fetch inesperado: ${url}`);
    }),
  );
  return calls;
}

/** KV com a estrutura do dataflow como se extraída ONTEM. */
async function kvComEstruturaDeOntem() {
  const { kv, store } = fakeKv();
  const env = { SDMX_CACHE: kv } as unknown as Env;
  await getDataflowStructure(env, "DF_UNE_DEAP_SEX_AGE_RT");
  const key = [...store.keys()].find((k) => k.startsWith("structure:"))!;
  const cached = JSON.parse(store.get(key)!) as { retrievedAt: string; value: unknown };
  store.set(key, JSON.stringify({ ...cached, retrievedAt: ONTEM }));
  return { env, store };
}

const ARGS = { dataflow: "DF_UNE_DEAP_SEX_AGE_RT", filters: { REF_AREA: "BRA", SEX: "SEX_T" } };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Bloco = Record<string, unknown> & {
  retrieved_at: string;
  field_sources?: Array<Record<string, unknown>> | null;
};

describe("ilo_get_data: estrutura do KV de ontem + dados agora", () => {
  it("o topo é o instante da estrutura (o mais antigo), não o dos dados", async () => {
    stubFetch();
    const { env } = await kvComEstruturaDeOntem();
    const r = (await getDataHandler(env)({ ...ARGS, provenance_mode: "detailed" })) as unknown as {
      structuredContent: { provenance: Bloco };
    };
    const p = r.structuredContent.provenance;
    expect(p.retrieved_at).toBe(ONTEM);
    // Os dados nunca vêm do cache: o todo não é "do cache".
    expect(p.served_from_cache).toBe(false);
    // A citação continua datada pelo acesso real ao endereço dos dados.
    expect(String(p.citation)).not.toContain(ONTEM.slice(0, 10));
  });

  it("field_sources: uma entrada por leitura, cada uma com o instante e o cache dela", async () => {
    stubFetch();
    const { env } = await kvComEstruturaDeOntem();
    const r = (await getDataHandler(env)(ARGS)) as unknown as { structuredContent: { provenance: Bloco } };
    const fs = r.structuredContent.provenance.field_sources!;
    expect(fs).toHaveLength(2);
    const [estrutura, dados] = fs;
    expect(estrutura).toMatchObject({
      fields: ["dataflow"],
      source_url: structureUrl("DF_UNE_DEAP_SEX_AGE_RT"),
      retrieved_at: ONTEM,
      served_from_cache: true,
      data_vintage: "2026-07-31",
    });
    expect(dados).toMatchObject({ fields: ["columns", "rows_count", "rows"], served_from_cache: false });
    // A parte dos dados não tem vintage próprio: repetir o da estrutura seria afirmar.
    expect(dados!.data_vintage).toBeNull();
    expect(Date.parse(String(dados!.retrieved_at))).toBeGreaterThan(Date.parse(ONTEM));
  });

  it("o concise leva field_sources (contrato 1.2) e o topo segue sendo o mais antigo", async () => {
    stubFetch();
    const { env } = await kvComEstruturaDeOntem();
    const r = (await getDataHandler(env)(ARGS)) as unknown as { structuredContent: { provenance: Bloco } };
    const p = r.structuredContent.provenance;
    expect(Object.keys(p).at(-1)).toBe("field_sources");
    for (const f of p.field_sources!) {
      expect(Date.parse(p.retrieved_at)).toBeLessThanOrEqual(Date.parse(String(f.retrieved_at)));
    }
  });

  it("sem KV (as duas lidas agora): topo = a leitura mais antiga das duas, sem erro de contrato", async () => {
    stubFetch();
    const r = (await getDataHandler({})(ARGS)) as unknown as { structuredContent: { provenance: Bloco } };
    const p = r.structuredContent.provenance;
    const instantes = p.field_sources!.map((f) => Date.parse(String(f.retrieved_at)));
    expect(Date.parse(p.retrieved_at)).toBe(Math.min(...instantes));
    expect(p.field_sources!.map((f) => f.served_from_cache)).toEqual([false, false]);
  });

  it("dentro do coletor: o acerto de KV entra com o instante original e NÃO conta como ida", async () => {
    const calls = stubFetch();
    const { env } = await kvComEstruturaDeOntem();
    calls.length = 0;
    let instanteDoColetor: string | null = null;
    const r = (await withUpstreamCall(async () => {
      const out = await getDataHandler(env)(ARGS);
      instanteDoColetor = currentCall()!.retrievedAt().toISOString();
      return out;
    })) as unknown as { structuredContent: { provenance: Bloco & { retrieval: { requests: number } | null } } };
    expect(calls).toHaveLength(1); // só os dados foram à rede
    expect(r.structuredContent.provenance.retrieval?.requests).toBe(1);
    expect(instanteDoColetor).toBe(new Date(ONTEM).toISOString());
  });
});

describe("ilo_list_dimension_values: estrutura de ontem + codelist de uma hora atrás", () => {
  it("topo = a estrutura; as duas partes do cache → served_from_cache true", async () => {
    stubFetch();
    const { env, store } = await kvComEstruturaDeOntem();
    store.set(
      "codelist:ILO:CL_SEX:1.0",
      JSON.stringify({
        retrievedAt: HA_UMA_HORA,
        value: { id: "CL_SEX", agency: "ILO", version: "1.0", name: "Sex", codes: [{ id: "SEX_T", name: "Total" }] },
      }),
    );
    const r = (await listDimensionValuesHandler(env)({
      dataflow: "DF_UNE_DEAP_SEX_AGE_RT",
      dimension: "SEX",
      provenance_mode: "detailed",
    })) as unknown as { structuredContent: { provenance: Bloco } };
    const p = r.structuredContent.provenance;
    expect(p.retrieved_at).toBe(ONTEM);
    expect(p.served_from_cache).toBe(true);
    expect(p.field_sources!.map((f) => [f.fields, f.retrieved_at])).toEqual([
      [["dataflow", "dimension"], ONTEM],
      [["codelist", "total_codes", "showing", "offset", "values", "has_more"], HA_UMA_HORA],
    ]);
  });
});
