/**
 * A ida à origem pelo fetch comum (`src/ilostat/upstream.ts`): a política de
 * repetição, a tradução do erro do pacote para o erro que o servidor lê, e —
 * pelo servidor INTEIRO (cliente em memória) — a contagem que sai em
 * `retrieval` no bloco de proveniência: medida quando houve ida à OIT, `null`
 * quando a resposta veio do catálogo ou do cache.
 *
 * Fetch dublado com `Response` real (o pacote lê `headers` e `text()`); a
 * espera do backoff é calada por `upstreamIo.sleep` e CONTADA — é o relógio
 * que prova a política.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { UpstreamError, type RetryContext } from "@sbissoli/mcp-upstream";
import { classifyError } from "../src/call-shape.js";
import { MemoryCache } from "../src/cli.js";
import { InMemoryCatalog } from "../src/ilostat/catalog-memory.js";
import {
  IlostatUpstreamError,
  retryUpstream,
  translateUpstreamError,
  UPSTREAM_POLICY,
  upstreamIo,
} from "../src/ilostat/upstream.js";
import { buildServer } from "../src/server.js";
import { resetIndex } from "../src/tools/deep-research.js";
import type { Env } from "../src/types.js";

// ---------------------------------------------------------------------------
// Fontes falsas
// ---------------------------------------------------------------------------

const FLOW = "DF_UNE_DEAP_SEX_AGE_RT";

function structureMessage() {
  return {
    data: {
      dataflows: [
        {
          id: FLOW,
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
          observation: [{ id: "TIME_PERIOD", values: [{ id: "2023" }, { id: "2024" }] }],
        },
        attributes: { observation: [] },
      },
      dataSets: [{ series: { "0:0": { observations: { "0": [7.9], "1": [6.6] } } } }],
    },
  };
}

/** `/dataflow/ILO?detail=allstubs` com mais de 100 dataflows (o mínimo que o catálogo aceita). */
function catalogueMessage() {
  const filler = Array.from({ length: 100 }, (_, i) => ({ id: `DF_ZZZ_${String(i).padStart(3, "0")}_NB`, name: `Filler ${i}` }));
  return {
    data: {
      dataflows: [{ id: FLOW, name: "Unemployment rate by sex and age (%)" }, ...filler].map((d) => ({
        id: d.id,
        agencyID: "ILO",
        version: "1.0",
        name: d.name,
        annotations: [{ type: "SEARCH_WEIGHT", title: "5" }],
      })),
    },
  };
}

type Route = (url: string, n: number) => Response;

/** Um fetch por substring da URL; `n` é a ordem da chamada àquela rota (1-based). */
function stubFetch(routes: Record<string, Route>) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const perRoute = new Map<string, number>();
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    for (const [needle, route] of Object.entries(routes)) {
      if (url.includes(needle)) {
        const n = (perRoute.get(needle) ?? 0) + 1;
        perRoute.set(needle, n);
        return route(url, n);
      }
    }
    throw new Error(`fetch inesperado: ${url}`);
  });
  vi.stubGlobal("fetch", fn);
  return { fn, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function envMemoria(loader?: () => Promise<unknown>): Env {
  return { SDMX_CACHE: new MemoryCache(), CATALOG_MEMORY: new InMemoryCatalog(loader) };
}

async function conectar(env: Env): Promise<Client> {
  const server = buildServer(env);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "upstream-test", version: "0.0.0" });
  await client.connect(clientT);
  return client;
}

type Retrieval = { requests: number; attempts: number; anomalies: Array<{ kind: string; count: number }>; unstable: boolean };

function retrievalOf(r: { structuredContent?: unknown }): Retrieval | null {
  const sc = r.structuredContent as { provenance: { retrieval: Retrieval | null } };
  return sc.provenance.retrieval;
}

const texto = (r: { content?: unknown }) =>
  (r.content as Array<{ type: string; text?: string }>).map((c) => c.text ?? "").join("\n");

let sleep: MockInstance<typeof upstreamIo.sleep>;

beforeEach(() => {
  resetIndex();
  sleep = vi.spyOn(upstreamIo, "sleep").mockResolvedValue(undefined);
});

afterEach(() => {
  sleep.mockRestore();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// A política
// ---------------------------------------------------------------------------

function ctx(over: Partial<RetryContext>): RetryContext {
  return { url: "https://sdmx.ilo.org/rest/x", attempt: 1, kind: "http_5xx", status: 503, response: undefined, body: undefined, ...over };
}

describe("retryUpstream — o que repete e o que não", () => {
  it("5xx, 429 e rede repetem", () => {
    expect(retryUpstream(ctx({ kind: "http_5xx", status: 503 }))).toBe(true);
    expect(retryUpstream(ctx({ kind: "http_5xx", status: 500 }))).toBe(true);
    expect(retryUpstream(ctx({ kind: "rate_limited", status: 429 }))).toBe(true);
    expect(retryUpstream(ctx({ kind: "network", status: undefined }))).toBe(true);
  });

  it("504 (consulta grande demais), timeout, outro 4xx e corpo não-JSON NÃO repetem", () => {
    // 404 nem chega aqui: o pacote não consulta `retryOn` para `not_found`.
    expect(retryUpstream(ctx({ kind: "http_5xx", status: 504 }))).toBe(false);
    expect(retryUpstream(ctx({ kind: "timeout", status: undefined }))).toBe(false);
    expect(retryUpstream(ctx({ kind: "http_4xx", status: 422 }))).toBe(false);
    expect(retryUpstream(ctx({ kind: "malformed_body", status: 200 }))).toBe(false);
  });

  it("o teto por tentativa fica acima do corte do gateway da OIT (61 s medidos para o 504)", () => {
    expect(UPSTREAM_POLICY.timeoutMs).toBeGreaterThan(61_000);
    expect(UPSTREAM_POLICY.budgetMs).toBeGreaterThan(UPSTREAM_POLICY.timeoutMs);
    expect(UPSTREAM_POLICY.backoff.jitterMs).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// A tradução do erro
// ---------------------------------------------------------------------------

function erroDoPacote(over: Partial<ConstructorParameters<typeof UpstreamError>[0]>): UpstreamError {
  return new UpstreamError({
    url: "https://sdmx.ilo.org/rest/x",
    kind: "http_5xx",
    status: 503,
    retryable: true,
    transport: false,
    attempts: 1,
    ...over,
  });
}

describe("translateUpstreamError — do erro do pacote ao erro que o servidor lê", () => {
  it("timeout → IlostatUpstreamError status 0, 'unreachable', classe fonte na telemetria", () => {
    const e = translateUpstreamError(erroDoPacote({ kind: "timeout", status: undefined, transport: true }), "data X");
    expect(e).toBeInstanceOf(IlostatUpstreamError);
    const err = e as IlostatUpstreamError;
    expect(err.status).toBe(0);
    expect(err.message).toBe("ILOSTAT upstream unreachable (data X): timeout after 1 attempt (65 s each)");
    expect(classifyError(err.message)).toBe("fonte");
  });

  it("rede → status 0 com o que o fetch lançou, contando as tentativas", () => {
    const e = translateUpstreamError(
      erroDoPacote({ kind: "network", status: undefined, transport: true, attempts: 3, cause: new TypeError("fetch failed") }),
      "structure of X",
    ) as IlostatUpstreamError;
    expect(e.status).toBe(0);
    expect(e.message).toBe("ILOSTAT upstream unreachable (structure of X): network error after 3 attempts: fetch failed");
    expect(classifyError(e.message)).toBe("fonte");
  });

  it("status que chegou → status + trecho do corpo (cortado em 300) e o sufixo das tentativas", () => {
    const e = translateUpstreamError(erroDoPacote({ status: 503, attempts: 3, body: "x".repeat(400) }), "data X") as IlostatUpstreamError;
    expect(e.status).toBe(503);
    expect(e.message).toBe(`ILOSTAT upstream HTTP 503 (data X): ${"x".repeat(300)} (after 3 attempts)`);
    expect(classifyError(e.message)).toBe("fonte");
  });

  it("404 → status 404 sem sufixo (quem decide o que a ausência significa é sdmx.ts)", () => {
    const e = translateUpstreamError(erroDoPacote({ kind: "not_found", status: 404, retryable: false, body: "not found" }), "codelist CL_X");
    expect((e as IlostatUpstreamError).status).toBe(404);
    expect((e as IlostatUpstreamError).message).toBe("ILOSTAT upstream HTTP 404 (codelist CL_X): not found");
  });

  it("corpo que não é JSON em 200 → status 200 e classe fonte", () => {
    const e = translateUpstreamError(erroDoPacote({ kind: "malformed_body", status: 200 }), "data X") as IlostatUpstreamError;
    expect(e.status).toBe(200);
    expect(classifyError(e.message)).toBe("fonte");
  });

  it("erro que não é do pacote passa intacto", () => {
    const meu = new RangeError("bug nosso");
    expect(translateUpstreamError(meu, "x")).toBe(meu);
  });
});

// ---------------------------------------------------------------------------
// O fio inteiro: contagem em `retrieval`, pelo servidor
// ---------------------------------------------------------------------------

describe("retrieval medido pelo servidor inteiro", () => {
  it("ilo_get_data: 503 superado → estrutura + dados = 2 idas, 3 tentativas, anomalia http_5xx, unstable", async () => {
    const { fn } = stubFetch({
      "/dataflow/": () => json(structureMessage()),
      "/data/": (_u, n) => (n === 1 ? new Response("upstream down", { status: 503 }) : json(dataMessage())),
    });
    const client = await conectar(envMemoria());
    try {
      const r = await client.callTool({
        name: "ilo_get_data",
        arguments: { dataflow: FLOW, filters: { REF_AREA: "BRA" }, provenance_mode: "detailed" },
      });
      expect(r.isError).toBeFalsy();
      const sc = r.structuredContent as Record<string, unknown>;
      expect(sc.rows_count).toBe(2);
      expect((sc.provenance as Record<string, unknown>).contract_version).toBe("1.1");
      expect(retrievalOf(r)).toEqual({
        requests: 2,
        attempts: 3,
        anomalies: [{ kind: "http_5xx", count: 1 }],
        unstable: true,
      });
      expect(fn).toHaveBeenCalledTimes(3);
      expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1000]);
    } finally {
      await client.close();
    }
  });

  it("ilo_get_data: 504 NÃO repete e vira o erro pedagógico de recorte", async () => {
    const { calls } = stubFetch({
      "/dataflow/": () => json(structureMessage()),
      "/data/": () => new Response("gateway timeout", { status: 504 }),
    });
    const client = await conectar(envMemoria());
    try {
      const r = await client.callTool({ name: "ilo_get_data", arguments: { dataflow: FLOW, filters: { REF_AREA: "BRA" } } });
      expect(r.isError).toBe(true);
      expect(texto(r)).toContain("too broad");
      expect(calls.filter((c) => c.url.includes("/data/"))).toHaveLength(1);
      expect(sleep).not.toHaveBeenCalled();
    } finally {
      await client.close();
    }
  });

  it("ilo_get_data: 404 de dados → linhas vazias, 1 ida limpa (ausência é resposta, não anomalia)", async () => {
    stubFetch({
      "/dataflow/": () => json(structureMessage()),
      "/data/": () => new Response("NoResultsFound", { status: 404 }),
    });
    const client = await conectar(envMemoria());
    try {
      // Primeiro a estrutura, para o cache: a ida de dados fica sozinha na contagem.
      const meta = await client.callTool({ name: "ilo_get_indicator_metadata", arguments: { dataflow: FLOW } });
      expect(retrievalOf(meta)).toEqual({ requests: 1, attempts: 1, anomalies: [], unstable: false });

      const r = await client.callTool({ name: "ilo_get_data", arguments: { dataflow: FLOW, filters: { REF_AREA: "BRA" } } });
      expect(r.isError).toBeFalsy();
      expect((r.structuredContent as Record<string, unknown>).rows_count).toBe(0);
      expect(retrievalOf(r)).toEqual({ requests: 1, attempts: 1, anomalies: [], unstable: false });

      // Acerto de cache: nada foi à origem → null, não `{ attempts: 1 }` inventado.
      const meta2 = await client.callTool({ name: "ilo_get_indicator_metadata", arguments: { dataflow: FLOW } });
      expect((meta2.structuredContent as { provenance: { served_from_cache?: boolean } }).provenance).toBeDefined();
      expect(retrievalOf(meta2)).toBeNull();
    } finally {
      await client.close();
    }
  });

  it("rede caída: 3 tentativas, erro legível com 'retrying later', não exceção crua", async () => {
    const fn = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    vi.stubGlobal("fetch", fn);
    const client = await conectar(envMemoria());
    try {
      const r = await client.callTool({ name: "ilo_get_indicator_metadata", arguments: { dataflow: FLOW } });
      expect(r.isError).toBe(true);
      expect(texto(r)).toContain("ILOSTAT upstream unreachable");
      expect(texto(r)).toContain("fetch failed");
      expect(texto(r)).toContain("retrying later may succeed");
      expect(fn).toHaveBeenCalledTimes(3);
      expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000]);
    } finally {
      await client.close();
    }
  });

  it("os headers de sempre chegam ao fetch: Accept negociado, Accept-Language en, User-Agent identificável", async () => {
    const { calls } = stubFetch({ "/dataflow/": () => json(structureMessage()) });
    const client = await conectar(envMemoria());
    try {
      await client.callTool({ name: "ilo_get_indicator_metadata", arguments: { dataflow: FLOW } });
      const h = new Headers(calls[0]?.init?.headers);
      expect(h.get("accept")).toBe("application/vnd.sdmx.structure+json");
      expect(h.get("accept-language")).toBe("en");
      expect(h.get("user-agent")).toContain("ilo-mcp-server (https://ilo.sidneybissoli.com;");
    } finally {
      await client.close();
    }
  });

  it("catálogo com loader injetado (o D1 do Worker): retrieval null — nada foi à origem", async () => {
    const client = await conectar(envMemoria(async () => catalogueMessage()));
    try {
      const r = await client.callTool({
        name: "ilo_search_indicators",
        arguments: { query: "unemployment", provenance_mode: "detailed" },
      });
      expect(r.isError).toBeFalsy();
      expect(retrievalOf(r)).toBeNull();
    } finally {
      await client.close();
    }
  });

  it("search/fetch (Deep Research) medem também: catálogo baixado na 1ª busca, estrutura no fetch, depois null", async () => {
    stubFetch({
      "detail=allstubs": () => json(catalogueMessage()),
      "/dataflow/ILO/": () => json(structureMessage()),
    });
    const client = await conectar(envMemoria());
    try {
      const s1 = await client.callTool({ name: "search", arguments: { query: "unemployment" } });
      expect(s1.isError).toBeFalsy();
      expect(retrievalOf(s1)).toEqual({ requests: 1, attempts: 1, anomalies: [], unstable: false });

      const s2 = await client.callTool({ name: "search", arguments: { query: "unemployment" } });
      expect(retrievalOf(s2)).toBeNull();

      const f1 = await client.callTool({ name: "fetch", arguments: { id: `ind:${FLOW}` } });
      expect(f1.isError).toBeFalsy();
      expect(retrievalOf(f1)).toEqual({ requests: 1, attempts: 1, anomalies: [], unstable: false });

      const f2 = await client.callTool({ name: "fetch", arguments: { id: `ind:${FLOW}` } });
      expect(retrievalOf(f2)).toBeNull();
    } finally {
      await client.close();
    }
  });
});
