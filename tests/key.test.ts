import { describe, expect, it } from "vitest";
import { buildDataKey, IlostatUserError } from "../src/ilostat/key.js";
import type { DataflowStructure } from "../src/ilostat/structure.js";

function structure(overrides: Partial<DataflowStructure> = {}): DataflowStructure {
  return {
    id: "DF_UNE_DEAP_SEX_AGE_RT",
    agency: "ILO",
    version: "1.0",
    name: "Unemployment rate by sex and age",
    dataVintage: "2026-07-31",
    dimensions: [
      { id: "REF_AREA", codelist: { agency: "ILO", id: "CL_AREA", version: "1.0" } },
      { id: "FREQ", codelist: { agency: "ILO", id: "CL_FREQ", version: "1.0" } },
      { id: "MEASURE", codelist: { agency: "ILO", id: "CL_MEASURE", version: "1.0" } },
      { id: "SEX", codelist: { agency: "ILO", id: "CL_SEX", version: "1.0" } },
      { id: "AGE", codelist: { agency: "ILO", id: "CL_AGE", version: "1.0" } },
    ],
    timeDimension: "TIME_PERIOD",
    defaults: { FREQ: "A", SEX: "SEX_T" },
    ...overrides,
  };
}

describe("buildDataKey", () => {
  it("monta a chave na ordem do DSD, com wildcard nas dims não filtradas", () => {
    const { key, effectiveFilters } = buildDataKey(structure(), {
      REF_AREA: ["BRA", "ARG"],
      SEX: "SEX_T",
      AGE: "AGE_YTHADULT_YGE15",
    });
    expect(key).toBe("BRA+ARG.A..SEX_T.AGE_YTHADULT_YGE15");
    expect(effectiveFilters).toEqual({
      REF_AREA: "BRA+ARG",
      FREQ: "A",
      MEASURE: "*",
      SEX: "SEX_T",
      AGE: "AGE_YTHADULT_YGE15",
    });
  });

  it("FREQ não filtrada assume o default do dataflow", () => {
    const { key } = buildDataKey(structure({ defaults: { FREQ: "M" } }), { REF_AREA: "BRA" });
    expect(key.split(".")[1]).toBe("M");
  });

  it("FREQ sem default do dataflow cai em anual", () => {
    const { key } = buildDataKey(structure({ defaults: null }), { REF_AREA: "BRA" });
    expect(key.split(".")[1]).toBe("A");
  });

  it("REF_AREA ausente → erro pedagógico (consulta irrestrita = 504)", () => {
    expect(() => buildDataKey(structure(), { SEX: "SEX_T" })).toThrow(IlostatUserError);
    expect(() => buildDataKey(structure(), { SEX: "SEX_T" })).toThrow(/REF_AREA is required/);
  });

  it("mais de 30 áreas → erro pedagógico com instrução de lote", () => {
    const areas = Array.from({ length: 31 }, (_, i) => `A${i}`);
    expect(() => buildDataKey(structure(), { REF_AREA: areas })).toThrow(/maximum 30/);
  });

  it("exatamente 30 áreas passa", () => {
    const areas = Array.from({ length: 30 }, (_, i) => `A${i}`);
    const { key } = buildDataKey(structure(), { REF_AREA: areas });
    expect(key.startsWith("A0+A1")).toBe(true);
  });

  it("dimensão desconhecida → erro listando as válidas", () => {
    expect(() => buildDataKey(structure(), { REF_AREA: "BRA", PAIS: "BRA" })).toThrow(
      /Unknown dimension.*REF_AREA, FREQ, MEASURE, SEX, AGE/,
    );
  });

  it("TIME_PERIOD nos filtros → orienta start_period/end_period", () => {
    expect(() => buildDataKey(structure(), { REF_AREA: "BRA", TIME_PERIOD: "2024" })).toThrow(
      /start_period\/end_period/,
    );
  });
});
