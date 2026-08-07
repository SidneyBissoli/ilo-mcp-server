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
