import { afterEach, describe, expect, it, vi } from "vitest";
import { getDataHandler, noticesFromRows, timePeriodLabel } from "../src/tools/data.js";
import type { ObservationRow } from "../src/ilostat/parser.js";
import type { Env } from "../src/types.js";

const ENV: Env = {}; // sem KV/D1: estrutura e dados vêm do fetch stubado

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
          observation: [{ id: "TIME_PERIOD", values: [{ id: "2023" }, { id: "2024" }] }],
        },
        attributes: {
          observation: [{ id: "OBS_STATUS", values: [{ id: "B", name: "Break in series" }] }],
        },
      },
      dataSets: [{ series: { "0:0": { observations: { "0": [7.9, 0], "1": [6.6] } } } }],
    },
  };
}

function stubFetch(dataStatus = 200, dataBody: unknown = dataMessage()) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/dataflow/")) {
        return new Response(JSON.stringify(structureMessage()), { status: 200 });
      }
      if (url.includes("/data/")) {
        return new Response(JSON.stringify(dataBody), { status: dataStatus });
      }
      throw new Error(`fetch inesperado: ${url}`);
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("getDataHandler", () => {
  it("consulta típica: linhas achatadas + envelope de proveniência detailed", async () => {
    const calls = stubFetch();
    const r = (await getDataHandler(ENV)({
      dataflow: "DF_UNE_DEAP_SEX_AGE_RT",
      filters: { REF_AREA: "BRA", SEX: "SEX_T" },
      start_period: "2023",
      end_period: "2024",
      provenance_mode: "detailed",
    })) as { structuredContent: Record<string, unknown> };

    const sc = r.structuredContent;
    expect(sc.rows_count).toBe(2);
    expect((sc.rows as unknown[])[0]).toEqual({
      REF_AREA: "BRA",
      SEX: "SEX_T",
      TIME_PERIOD: "2023",
      value: 7.9,
      attributes: { OBS_STATUS: { id: "B", name: "Break in series" } },
    });

    // URL canônica: chave na ordem do DSD + período — e SEM ?format= (só header Accept)
    const expectedUrl =
      "https://sdmx.ilo.org/rest/data/ILO,DF_UNE_DEAP_SEX_AGE_RT,1.0/BRA.A.SEX_T" +
      "?startPeriod=2023&endPeriod=2024";
    expect(sc.attribution).toEqual([expectedUrl]);
    expect(calls.some((u) => u.includes("format="))).toBe(false);

    const p = sc.provenance as Record<string, unknown>;
    expect(p.contract_version).toBe("1.0");
    expect(p.data_vintage).toBe("2026-07-31");
    expect((p.source as Record<string, unknown>).name).toBe("ILOSTAT");
    expect(p.dimension_key).toEqual({
      REF_AREA: "BRA",
      FREQ: "A",
      SEX: "SEX_T",
      TIME_PERIOD: "2023-2024",
    });
    expect(p.derived).toBe(false);
    expect(p.served_from_cache).toBe(false);
    expect(p.notices).toEqual(["OBS_STATUS B (Break in series): 1 observation(s)"]);
    expect(String(p.citation)).toMatch(/^International Labour Organization, ILOSTAT, /);
    expect((p.license as Record<string, unknown>).id).toBe("CC-BY-4.0");
  });

  it("modo concise (default): bloco com exatamente 6 chaves em ordem fixa", async () => {
    stubFetch();
    const r = (await getDataHandler(ENV)({
      dataflow: "DF_UNE_DEAP_SEX_AGE_RT",
      filters: { REF_AREA: "BRA" },
    })) as { structuredContent: Record<string, unknown> };
    expect(Object.keys(r.structuredContent.provenance as Record<string, unknown>)).toEqual([
      "source",
      "source_url",
      "data_vintage",
      "retrieved_at",
      "citation",
      "license",
    ]);
  });

  it("upstream 404 (NoResultsFound) → resposta vazia com hint, não erro", async () => {
    stubFetch(404, {});
    const r = (await getDataHandler(ENV)({
      dataflow: "DF_UNE_DEAP_SEX_AGE_RT",
      filters: { REF_AREA: "BRA" },
    })) as { structuredContent: Record<string, unknown>; isError?: boolean };
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent.rows_count).toBe(0);
    expect(String(r.structuredContent.hint)).toContain("list_dimension_values");
  });

  it("upstream 504 → erro pedagógico de recorte", async () => {
    stubFetch(504, {});
    const r = (await getDataHandler(ENV)({
      dataflow: "DF_UNE_DEAP_SEX_AGE_RT",
      filters: { REF_AREA: "BRA" },
    })) as { isError?: boolean; content: Array<{ text: string }> };
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toContain("too broad");
  });

  it("sem REF_AREA → erro pedagógico sem ir ao upstream de dados", async () => {
    const calls = stubFetch();
    const r = (await getDataHandler(ENV)({ dataflow: "DF_UNE_DEAP_SEX_AGE_RT" })) as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toContain("REF_AREA is required");
    expect(calls.filter((u) => u.includes("/data/"))).toHaveLength(0);
  });
});

describe("helpers puros", () => {
  it("timePeriodLabel cobre períodos, lastN e ausência", () => {
    expect(timePeriodLabel("2015", "2024", undefined)).toBe("2015-2024");
    expect(timePeriodLabel("2015", undefined, undefined)).toBe("2015-");
    expect(timePeriodLabel(undefined, undefined, 3)).toBe("last 3 observation(s)");
    expect(timePeriodLabel(undefined, undefined, undefined)).toBeNull();
  });

  it("noticesFromRows agrega só OBS_STATUS (atributos técnicos ficam nas linhas)", () => {
    const rows: ObservationRow[] = [
      { dimensions: {}, value: 1, attributes: { OBS_STATUS: { id: "B", name: "Break in series" } } },
      { dimensions: {}, value: 2, attributes: { OBS_STATUS: { id: "B", name: "Break in series" } } },
      { dimensions: {}, value: 3, attributes: { OBS_STATUS: { id: "E", name: "Estimated" } } },
      { dimensions: {}, value: 4, attributes: { DECIMALS: { id: "1", name: "1" } } },
      { dimensions: {}, value: 5, attributes: null },
    ];
    expect(noticesFromRows(rows)).toEqual([
      "OBS_STATUS B (Break in series): 2 observation(s)",
      "OBS_STATUS E (Estimated): 1 observation(s)",
    ]);
  });
});
