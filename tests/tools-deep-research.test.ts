/**
 * search/fetch — o contrato Deep Research do ChatGPT sobre o catálogo do ILOSTAT.
 *
 * Peças puras (url do explorador, entradas do índice, render do documento) e o
 * fio inteiro (servidor real + cliente em memória) com o catálogo em memória
 * carregado por um loader falso e a estrutura SDMX vinda de um `fetch` stubado —
 * o mesmo caminho do runtime stdio, sem rede.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { InMemoryCatalog } from "../src/ilostat/catalog-memory.js";
import { listCatalog } from "../src/ilostat/catalog.js";
import type { DataflowStructure } from "../src/ilostat/structure.js";
import { buildServer } from "../src/server.js";
import {
  DEEP_RESEARCH_ID_PREFIX,
  DEEP_RESEARCH_TOOLS,
  explorerUrl,
  indexEntries,
  renderDataflow,
  resetIndex,
} from "../src/tools/deep-research.js";
import { TOOL_NAMES } from "../src/tools/index.js";
import type { Env } from "../src/types.js";

// ---------------------------------------------------------------------------
// Fontes falsas
// ---------------------------------------------------------------------------

/** Mensagem `/dataflow/ILO?detail=allstubs` com mais de 100 dataflows (o mínimo que o catálogo aceita). */
function mensagemCatalogo() {
  const reais = [
    { id: "DF_UNE_2EAP_SEX_AGE_RT", name: "Unemployment rate by sex and age -- ILO modelled estimates, Nov. 2025", w: 9 },
    { id: "DF_UNE_DEAP_SEX_AGE_RT", name: "Unemployment rate by sex and age (%)", w: 8 },
    { id: "DF_EAR_GGAP_OCU_RT", name: "Gender wage gap by occupation (%)", w: 5 },
    { id: "DF_HOW_TEMP_SEX_ECO_NB", name: "Mean weekly hours actually worked per employed person by sex and economic activity", w: 4 },
  ];
  const enchimento = Array.from({ length: 100 }, (_, i) => ({
    id: `DF_ZZZ_${String(i).padStart(3, "0")}_NOC_NB`,
    name: `Filler series ${i}`,
    w: 0,
  }));
  return {
    data: {
      dataflows: [...reais, ...enchimento].map((d) => ({
        id: d.id,
        agencyID: "ILO",
        version: "1.0",
        name: d.name,
        annotations: [{ type: "SEARCH_WEIGHT", title: String(d.w) }],
      })),
    },
  };
}

function estruturaSdmx(id: string, opts: { name?: string; vintage?: boolean; defaults?: boolean } = {}) {
  const annotations = [
    ...(opts.vintage === false ? [] : [{ type: "LAST_UPDATE", title: "31/07/2026 20:54:15" }]),
    ...(opts.defaults === false ? [] : [{ type: "DEFAULT", title: "FREQ=A,SEX=SEX_T" }]),
  ];
  return {
    data: {
      dataflows: [{ id, version: "1.0", agencyID: "ILO", ...(opts.name ? { name: opts.name } : {}), annotations }],
      dataStructures: [
        {
          dataStructureComponents: {
            dimensionList: {
              dimensions: [
                { id: "REF_AREA", localRepresentation: { enumeration: "urn:x:Codelist=ILO:CL_AREA(1.0)" } },
                { id: "FREQ", localRepresentation: { enumeration: "urn:x:Codelist=ILO:CL_FREQ(1.0)" } },
                { id: "SEX", localRepresentation: { enumeration: "urn:x:Codelist=ILO:CL_SEX(1.0)" } },
                { id: "AGE" },
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

function stubStructureFetch(estruturas: Record<string, unknown>) {
  const chamadas: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      chamadas.push(url);
      const m = url.match(/\/dataflow\/ILO\/([^/]+)\/latest/);
      if (m && estruturas[decodeURIComponent(m[1]!)]) {
        return new Response(JSON.stringify(estruturas[decodeURIComponent(m[1]!)]), { status: 200 });
      }
      if (m) return new Response("not found", { status: 404 });
      throw new Error(`fetch inesperado: ${url}`);
    }),
  );
  return chamadas;
}

function envMemoria(): Env {
  return { CATALOG_MEMORY: new InMemoryCatalog(async () => mensagemCatalogo()) };
}

async function conectar(env: Env): Promise<Client> {
  const server = buildServer(env);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "deep-research", version: "0.0.0" });
  await Promise.all([server.connect(st), client.connect(ct)]);
  return client;
}

const texto = (r: { content?: unknown }) => (r.content as Array<{ text: string }>)[0]!.text;

afterEach(() => {
  vi.unstubAllGlobals();
  resetIndex();
});

// ---------------------------------------------------------------------------
// Peças puras
// ---------------------------------------------------------------------------

describe("explorerUrl", () => {
  it("é a página pública do data explorer: dataflow sem DF_ mais o sufixo de frequência", () => {
    expect(explorerUrl("DF_UNE_2EAP_SEX_AGE_RT")).toBe(
      "https://rplumber.ilo.org/dataexplorer/?lang=en&id=UNE_2EAP_SEX_AGE_RT_A",
    );
    expect(explorerUrl("DF_UNE_DEAP_SEX_AGE_RT", "Q")).toBe(
      "https://rplumber.ilo.org/dataexplorer/?lang=en&id=UNE_DEAP_SEX_AGE_RT_Q",
    );
  });

  it("nunca é a API SDMX", () => {
    expect(explorerUrl("DF_UNE_2EAP_SEX_AGE_RT")).not.toContain("sdmx.ilo.org");
  });
});

describe("indexEntries", () => {
  const entradas = indexEntries([
    { id: "DF_UNE_2EAP_SEX_AGE_RT", agency: "ILO", version: "1.0", name: "Unemployment rate by sex and age -- ILO modelled estimates" },
    { id: "DF_ZZZ_001_NOC_NB", agency: "ILO", version: "1.0", name: "Filler" },
  ]);

  it("id prefixado, título = nome, url = explorador, keywords = segmentos do id", () => {
    const e = entradas[0]!;
    expect(e.id).toBe(`${DEEP_RESEARCH_ID_PREFIX}DF_UNE_2EAP_SEX_AGE_RT`);
    expect(e.title).toBe("Unemployment rate by sex and age -- ILO modelled estimates");
    expect(e.url).toBe(explorerUrl("DF_UNE_2EAP_SEX_AGE_RT"));
    expect(e.keywords).toEqual(expect.arrayContaining(["UNE", "2EAP", "SEX", "AGE", "RT"]));
  });

  it("dataflow curado em KEY_DATAFLOWS ganha o tópico e a nota nas keywords e no texto", () => {
    const e = entradas[0]!;
    expect(e.keywords).toContain("Unemployment and labour underutilization");
    expect(e.text).toContain("ILO modelled estimates");
    const f = entradas[1]!;
    expect(f.keywords).not.toContain("Unemployment and labour underutilization");
    expect(f.text).toBe("Filler");
  });
});

describe("renderDataflow", () => {
  const estrutura: DataflowStructure = {
    id: "DF_UNE_2EAP_SEX_AGE_RT",
    agency: "ILO",
    version: "1.0",
    name: "Unemployment rate by sex and age",
    dataVintage: "2026-07-31",
    dimensions: [
      { id: "REF_AREA", codelist: { agency: "ILO", id: "CL_AREA", version: "1.0" } },
      { id: "FREQ", codelist: { agency: "ILO", id: "CL_FREQ", version: "1.0" } },
      { id: "SEX", codelist: null },
    ],
    timeDimension: "TIME_PERIOD",
    defaults: { FREQ: "Q", SEX: "SEX_T" },
  };

  it("Markdown com nome, id, vintage, dimensões, default da OIT, como consultar e o explorador na frequência default", () => {
    const md = renderDataflow(estrutura);
    expect(md.startsWith("# Unemployment rate by sex and age")).toBe(true);
    expect(md).toContain("DF_UNE_2EAP_SEX_AGE_RT");
    expect(md).toContain("2026-07-31");
    expect(md).toContain("REF_AREA — codelist CL_AREA");
    expect(md).toContain("FREQ=Q, SEX=SEX_T");
    expect(md).toContain("`ilo_get_data`");
    expect(md).toContain("Frequency defaults to `Q`");
    expect(md).toContain(explorerUrl("DF_UNE_2EAP_SEX_AGE_RT", "Q"));
    // Dataflow curado: tópico e nota.
    expect(md).toContain("Unemployment and labour underutilization");
  });

  it("estrutura magra: sem name (cai para o id), sem vintage, sem default (frequência A)", () => {
    const md = renderDataflow({ ...estrutura, name: null, dataVintage: null, defaults: null, timeDimension: null });
    expect(md.startsWith("# DF_UNE_2EAP_SEX_AGE_RT")).toBe(true);
    expect(md).not.toContain("Data vintage");
    expect(md).not.toContain("ILO default selection");
    expect(md).toContain("Frequency defaults to `A`");
  });
});

describe("listCatalog", () => {
  it("sem D1, lista o catálogo em memória inteiro com o retrieved_at real", async () => {
    const env = envMemoria();
    const { entries, retrievedAt, sourceUrl } = await listCatalog(env);
    expect(entries).toHaveLength(104);
    expect(entries[0]).toEqual({ id: "DF_UNE_2EAP_SEX_AGE_RT", agency: "ILO", version: "1.0", name: expect.any(String) });
    expect(retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(sourceUrl).toContain("detail=allstubs");
  });
});

// ---------------------------------------------------------------------------
// Fio inteiro
// ---------------------------------------------------------------------------

describe("search/fetch pelo servidor real", () => {
  it("TOOL_NAMES inclui exatamente as duas do contrato, sem prefixo ilo_", () => {
    expect(DEEP_RESEARCH_TOOLS).toEqual(["search", "fetch"]);
    for (const t of DEEP_RESEARCH_TOOLS) expect(TOOL_NAMES).toContain(t);
    expect(TOOL_NAMES.filter((t) => !t.startsWith("ilo_"))).toEqual([...DEEP_RESEARCH_TOOLS]);
  });

  it("tools/list anuncia search e fetch em inglês, somente-leitura, com outputSchema que inclui a proveniência", async () => {
    const client = await conectar(envMemoria());
    try {
      const { tools } = await client.listTools();
      for (const name of DEEP_RESEARCH_TOOLS) {
        const t = tools.find((x) => x.name === name)!;
        expect(t, name).toBeDefined();
        expect(t.title).toMatch(/Deep Research/);
        expect(t.title).not.toMatch(/Busca|Documento/);
        expect(t.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true });
        const props = (t.outputSchema as { properties: Record<string, unknown> }).properties;
        expect(Object.keys(props)).toEqual(expect.arrayContaining(["provenance", "attribution"]));
      }
    } finally {
      await client.close();
    }
  });

  it("search ranqueia o catálogo inteiro sem tocar o upstream e devolve o JSON do contrato com proveniência", async () => {
    const chamadas = stubStructureFetch({});
    const client = await conectar(envMemoria());
    try {
      const r = await client.callTool({ name: "search", arguments: { query: "unemployment rate sex age" } });
      expect(r.isError).toBeFalsy();
      const { results } = JSON.parse(texto(r)) as { results: Array<{ id: string; title: string; url: string }> };
      expect(results.length).toBeGreaterThanOrEqual(2);
      expect(results.map((x) => x.id)).toEqual(
        expect.arrayContaining(["ind:DF_UNE_2EAP_SEX_AGE_RT", "ind:DF_UNE_DEAP_SEX_AGE_RT"]),
      );
      expect(results.every((x) => x.url.startsWith("https://rplumber.ilo.org/dataexplorer/"))).toBe(true);
      // Sem rodapé: o content é só o JSON.
      expect(r.content).toHaveLength(1);
      // Bloco conciso (o padrão do servidor, como nas irmãs): fonte, url, vintage, instante, citação, licença.
      const sc = r.structuredContent as { results: unknown[]; provenance: { source: string; source_url: string; citation: string; retrieved_at: string }; attribution: string[] };
      expect(sc.results).toHaveLength(results.length);
      expect(sc.provenance.source).toBe("ILOSTAT");
      expect(sc.provenance.source_url).toContain("detail=allstubs");
      expect(sc.provenance.citation).toContain("International Labour Organization");
      expect(sc.provenance.retrieved_at).toMatch(/^\d{4}-/);
      expect(sc.attribution.length).toBeGreaterThan(0);
      // O índice vem do catálogo; a estrutura SDMX nunca foi pedida.
      expect(chamadas.filter((u) => u.includes("/latest"))).toEqual([]);
    } finally {
      await client.close();
    }
  });

  it("uma consulta que é o próprio id acha o dataflow", async () => {
    const client = await conectar(envMemoria());
    try {
      const r = await client.callTool({ name: "search", arguments: { query: "DF_EAR_GGAP_OCU_RT" } });
      const { results } = JSON.parse(texto(r)) as { results: Array<{ id: string }> };
      expect(results[0]?.id).toBe("ind:DF_EAR_GGAP_OCU_RT");
    } finally {
      await client.close();
    }
  });

  it("fetch de id do índice lê a estrutura real (a mesma de ilo_get_indicator_metadata) e cita o explorador na frequência default", async () => {
    stubStructureFetch({ DF_UNE_2EAP_SEX_AGE_RT: estruturaSdmx("DF_UNE_2EAP_SEX_AGE_RT", { name: "Unemployment rate by sex and age" }) });
    const client = await conectar(envMemoria());
    try {
      const r = await client.callTool({ name: "fetch", arguments: { id: "ind:DF_UNE_2EAP_SEX_AGE_RT" } });
      expect(r.isError, texto(r)).toBeFalsy();
      const d = JSON.parse(texto(r)) as { id: string; title: string; text: string; url: string; metadata: Record<string, unknown> };
      expect(d.id).toBe("ind:DF_UNE_2EAP_SEX_AGE_RT");
      expect(d.title).toBe("Unemployment rate by sex and age");
      expect(d.url).toBe(explorerUrl("DF_UNE_2EAP_SEX_AGE_RT", "A"));
      expect(d.text).toContain("## Dimensions");
      expect(d.text).toContain("REF_AREA — codelist CL_AREA");
      expect(d.metadata).toMatchObject({ dataflow: "DF_UNE_2EAP_SEX_AGE_RT", data_vintage: "2026-07-31", time_dimension: "TIME_PERIOD" });
      const sc = r.structuredContent as { provenance: { source_url: string; data_vintage: string | null; license: string }; attribution: string[] };
      expect(sc.provenance.source_url).toContain("/dataflow/ILO/DF_UNE_2EAP_SEX_AGE_RT/latest");
      expect(sc.provenance.data_vintage).toBe("2026-07-31");
      expect(sc.provenance.license).toBe("CC-BY-4.0");
      expect(sc.attribution.length).toBeGreaterThan(0);
    } finally {
      await client.close();
    }
  });

  it("fetch de id fora do índice devolve isError sem tocar o upstream; id sem prefixo idem", async () => {
    const chamadas = stubStructureFetch({});
    const client = await conectar(envMemoria());
    try {
      for (const id of ["ind:DF_NAO_EXISTE", "DF_UNE_2EAP_SEX_AGE_RT", "sidra:1234"]) {
        const r = await client.callTool({ name: "fetch", arguments: { id } });
        expect(r.isError, id).toBe(true);
        expect(texto(r)).toContain(id);
      }
      expect(chamadas.filter((u) => u.includes("/latest"))).toEqual([]);
    } finally {
      await client.close();
    }
  });

  it("falha do upstream em fetch vira isError legível, não exceção crua", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("upstream down", { status: 503 })),
    );
    const client = await conectar(envMemoria());
    try {
      const r = await client.callTool({ name: "fetch", arguments: { id: "ind:DF_UNE_2EAP_SEX_AGE_RT" } });
      expect(r.isError).toBe(true);
      expect(texto(r).length).toBeGreaterThan(10);
    } finally {
      await client.close();
    }
  });

  it("o índice é construído uma vez por processo: duas buscas, um único carregamento do catálogo", async () => {
    let carregamentos = 0;
    const env: Env = {
      CATALOG_MEMORY: new InMemoryCatalog(async () => {
        carregamentos++;
        return mensagemCatalogo();
      }),
    };
    const client = await conectar(env);
    try {
      await client.callTool({ name: "search", arguments: { query: "wage gap" } });
      await client.callTool({ name: "search", arguments: { query: "hours worked" } });
      expect(carregamentos).toBe(1);
    } finally {
      await client.close();
    }
  });
});
