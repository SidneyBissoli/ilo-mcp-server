import { describe, expect, it } from "vitest";
import { parseSdmxData } from "../src/ilostat/parser.js";

/** Fixture no formato real servido por sdmx.ilo.org (validado no spike da Sessão 04). */
function dataMessage() {
  return {
    data: {
      structure: {
        name: "Unemployment rate by sex and age",
        dimensions: {
          series: [
            { id: "REF_AREA", values: [{ id: "BRA", name: "Brazil" }, { id: "ARG", name: "Argentina" }] },
            { id: "SEX", values: [{ id: "SEX_T", name: "Total" }] },
          ],
          observation: [{ id: "TIME_PERIOD", values: [{ id: "2023" }, { id: "2024" }] }],
        },
        attributes: {
          observation: [
            { id: "OBS_STATUS", values: [{ id: "B", name: "Break in series" }] },
          ],
        },
      },
      dataSets: [
        {
          series: {
            "0:0": { observations: { "0": [7.9, 0], "1": [6.6] } },
            "1:0": { observations: { "0": [6.1, null], "1": [null] } },
          },
        },
      ],
    },
  };
}

describe("parseSdmxData", () => {
  it("mapeia séries e observações para linhas tabulares", () => {
    const parsed = parseSdmxData(dataMessage());
    expect(parsed.name).toBe("Unemployment rate by sex and age");
    expect(parsed.dimensionIds).toEqual(["REF_AREA", "SEX", "TIME_PERIOD"]);
    expect(parsed.rows).toHaveLength(4);
    expect(parsed.rows[0]).toEqual({
      dimensions: { REF_AREA: "BRA", SEX: "SEX_T", TIME_PERIOD: "2023" },
      value: 7.9,
      attributes: { OBS_STATUS: { id: "B", name: "Break in series" } },
    });
  });

  it("observação sem índice de atributo não ganha attributes", () => {
    const parsed = parseSdmxData(dataMessage());
    const bra2024 = parsed.rows.find(
      (r) => r.dimensions.REF_AREA === "BRA" && r.dimensions.TIME_PERIOD === "2024",
    );
    expect(bra2024?.value).toBe(6.6);
    expect(bra2024?.attributes).toBeNull();
  });

  it("índice de atributo null é ignorado; valor null preservado", () => {
    const parsed = parseSdmxData(dataMessage());
    const arg2023 = parsed.rows.find(
      (r) => r.dimensions.REF_AREA === "ARG" && r.dimensions.TIME_PERIOD === "2023",
    );
    expect(arg2023?.value).toBe(6.1);
    expect(arg2023?.attributes).toBeNull();
    const arg2024 = parsed.rows.find(
      (r) => r.dimensions.REF_AREA === "ARG" && r.dimensions.TIME_PERIOD === "2024",
    );
    expect(arg2024?.value).toBeNull();
  });

  it("valor de atributo sem id e sem rótulo é descartado (não informa nada)", () => {
    const msg = dataMessage() as { data: { structure: { attributes: { observation: unknown[] } } } };
    msg.data.structure.attributes.observation = [
      { id: "SOURCE", values: [{}] },
      { id: "OBS_STATUS", values: [{ id: "B", name: "Break in series" }] },
    ];
    const parsed = parseSdmxData(msg);
    // "0": [7.9, 0] → índice 0 aponta para SOURCE {} (descartado); OBS_STATUS sem índice
    expect(parsed.rows[0]?.attributes).toBeNull();
  });

  it("mensagem sem structure lança erro", () => {
    expect(() => parseSdmxData({ data: { dataSets: [] } })).toThrow("sem bloco structure");
  });
});

/**
 * Atributos de série: forma REAL de sdmx.ilo.org medida em 04/10/2026
 * (DF_EMP_TEMP_SEX_AGE_NB, BRA+DEU, JSON 2.0). Unidade e escala vêm em
 * attributes.series com relationship → MEASURE, UM valor na estrutura e índice
 * null em todas as séries; a CSV da mesma consulta traz UNIT_MULT=3 por linha.
 */
function seriesAttrMessage(opts: { measures?: string[]; multValues?: { id: string; name: string }[]; seriesIdx?: (number | null)[] } = {}) {
  const measures = opts.measures ?? ["EMP_TEMP_NB"];
  const unitAttr = (id: string, values: { id: string; name: string }[]) => ({
    id,
    relationship: { dimensions: ["MEASURE"] },
    values,
  });
  return {
    data: {
      structures: [
        {
          name: "Employment by sex and age",
          dimensions: {
            series: [
              { id: "REF_AREA", values: [{ id: "BRA" }, { id: "DEU" }] },
              { id: "MEASURE", values: measures.map((id) => ({ id })) },
            ],
            observation: [{ id: "TIME_PERIOD", values: [{ id: "2025" }] }],
          },
          attributes: {
            dataSet: [],
            series: [
              unitAttr("UNIT_MEASURE", [{ id: "PS", name: "Persons" }]),
              unitAttr("UNIT_MULT", opts.multValues ?? [{ id: "3", name: "Thousands" }]),
            ],
            observation: [{ id: "DECIMALS", values: [{ id: "1", name: "1" }] }],
          },
        },
      ],
      dataSets: [
        {
          series: {
            "0:0": { attributes: opts.seriesIdx ?? [null, null], observations: { "0": [102453.886, 0] } },
            "1:0": { attributes: opts.seriesIdx ?? [null, null], observations: { "0": [2918.4, 0] } },
          },
        },
      ],
    },
  };
}

describe("parseSdmxData — atributos de série (unidade e escala)", () => {
  it("forma real da OIT: índice null + valor único determinado pela mensagem → vale em toda linha", () => {
    const parsed = parseSdmxData(seriesAttrMessage());
    expect(parsed.rows).toHaveLength(2);
    for (const row of parsed.rows) {
      expect(row.attributes).toEqual({
        UNIT_MEASURE: { id: "PS", name: "Persons" },
        UNIT_MULT: { id: "3", name: "Thousands" },
        DECIMALS: { id: "1", name: "1" },
      });
    }
  });

  it("dimensão da relação com mais de um código: índice null NÃO se infere (sem chute)", () => {
    const parsed = parseSdmxData(seriesAttrMessage({ measures: ["EMP_TEMP_NB", "EMP_TEMP_RT"] }));
    for (const row of parsed.rows) expect(row.attributes).toEqual({ DECIMALS: { id: "1", name: "1" } });
  });

  it("mais de um valor na estrutura com índice null: não se infere", () => {
    const parsed = parseSdmxData(
      seriesAttrMessage({ multValues: [{ id: "0", name: "Units" }, { id: "3", name: "Thousands" }] }),
    );
    for (const row of parsed.rows) expect(row.attributes?.UNIT_MULT).toBeUndefined();
  });

  it("índice presente na série vale, mesmo com vários valores", () => {
    const parsed = parseSdmxData(
      seriesAttrMessage({ multValues: [{ id: "0", name: "Units" }, { id: "3", name: "Thousands" }], seriesIdx: [0, 1] }),
    );
    for (const row of parsed.rows) expect(row.attributes?.UNIT_MULT).toEqual({ id: "3", name: "Thousands" });
  });

  it("sem relationship (não se sabe a que o atributo se prende): índice null não se infere", () => {
    const msg = seriesAttrMessage();
    for (const a of msg.data.structures[0]!.attributes.series) delete (a as { relationship?: unknown }).relationship;
    const parsed = parseSdmxData(msg);
    for (const row of parsed.rows) expect(row.attributes).toEqual({ DECIMALS: { id: "1", name: "1" } });
  });

  it("atributo de dataset chega à linha; o de observação vence no mesmo id", () => {
    const msg = seriesAttrMessage() as unknown as {
      data: { structures: { attributes: { dataSet: unknown[]; observation: unknown[] } }[]; dataSets: { attributes?: unknown }[] };
    };
    msg.data.structures[0]!.attributes.dataSet = [{ id: "UNIT_MULT", values: [{ id: "6", name: "Millions" }] }];
    msg.data.dataSets[0]!.attributes = [0];
    msg.data.structures[0]!.attributes.observation = [{ id: "UNIT_MEASURE", values: [{ id: "HH", name: "Households" }] }];
    const parsed = parseSdmxData(msg);
    // UNIT_MULT da série (determinado) sobrepõe o de dataset; UNIT_MEASURE da observação sobrepõe o da série.
    expect(parsed.rows[0]?.attributes).toEqual({
      UNIT_MULT: { id: "3", name: "Thousands" },
      UNIT_MEASURE: { id: "HH", name: "Households" },
    });
  });

  it("série sem nenhum atributo resolvido e observação sem atributo: attributes null", () => {
    const msg = seriesAttrMessage({ measures: ["A", "B"] });
    msg.data.structures[0]!.attributes.observation = [];
    expect(parseSdmxData(msg).rows[0]?.attributes).toBeNull();
  });
});
