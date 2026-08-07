import { afterEach, describe, expect, it, vi } from "vitest";
import { getIndicatorMetadataHandler, listDimensionValuesHandler } from "../src/tools/metadata.js";
import type { Env } from "../src/types.js";

const ENV: Env = {};

function structureMessage() {
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

function codelistMessage() {
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
            { id: "SEX_F", name: "Female" },
          ],
        },
      ],
    },
  };
}

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const accept = new Headers(init?.headers).get("Accept");
      expect(accept).toBe("application/vnd.sdmx.structure+json");
      if (url.includes("/dataflow/")) return new Response(JSON.stringify(structureMessage()), { status: 200 });
      if (url.includes("/codelist/")) return new Response(JSON.stringify(codelistMessage()), { status: 200 });
      throw new Error(`fetch inesperado: ${url}`);
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("getIndicatorMetadataHandler", () => {
  it("estrutura do dataflow: dims, vintage, defaults, proveniência", async () => {
    stubFetch();
    const r = (await getIndicatorMetadataHandler(ENV)({
      dataflow: "DF_UNE_DEAP_SEX_AGE_RT",
      provenance_mode: "detailed",
    })) as { structuredContent: Record<string, unknown> };
    const sc = r.structuredContent;
    expect(sc.data_vintage).toBe("2026-07-31");
    expect(sc.dimensions).toEqual([
      { id: "REF_AREA", codelist: "CL_AREA" },
      { id: "SEX", codelist: "CL_SEX" },
    ]);
    expect(sc.time_dimension).toBe("TIME_PERIOD");
    expect(sc.source_defaults).toEqual({ FREQ: "A", SEX: "SEX_T" });
    const p = sc.provenance as Record<string, unknown>;
    expect((p.dataset as Record<string, unknown>).id).toBe("DF_UNE_DEAP_SEX_AGE_RT");
    expect(p.served_from_cache).toBe(false);
  });

  it("dataflow inexistente (404 upstream) → erro pedagógico", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not found", { status: 404 })));
    const r = (await getIndicatorMetadataHandler(ENV)({ dataflow: "DF_NAO_EXISTE" })) as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toContain("ilo_search_indicators");
  });
});

describe("listDimensionValuesHandler", () => {
  it("lista códigos da codelist da dimensão, com busca", async () => {
    stubFetch();
    const r = (await listDimensionValuesHandler(ENV)({
      dataflow: "DF_UNE_DEAP_SEX_AGE_RT",
      dimension: "SEX",
      search: "fem",
    })) as { structuredContent: Record<string, unknown> };
    const sc = r.structuredContent;
    expect(sc.codelist).toBe("CL_SEX");
    expect(sc.values).toEqual([{ id: "SEX_F", name: "Female" }]);
    expect(sc.total_codes).toBe(1);
  });

  it("dimensão inexistente → erro listando as válidas", async () => {
    stubFetch();
    const r = (await listDimensionValuesHandler(ENV)({
      dataflow: "DF_UNE_DEAP_SEX_AGE_RT",
      dimension: "AGE",
    })) as { isError?: boolean; content: Array<{ text: string }> };
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toContain("REF_AREA, SEX");
  });

  it("dimensão de tempo → orienta start_period/end_period", async () => {
    stubFetch();
    const r = (await listDimensionValuesHandler(ENV)({
      dataflow: "DF_UNE_DEAP_SEX_AGE_RT",
      dimension: "TIME_PERIOD",
    })) as { isError?: boolean; content: Array<{ text: string }> };
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toContain("start_period/end_period");
  });
});
