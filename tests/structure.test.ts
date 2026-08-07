import { describe, expect, it } from "vitest";
import {
  lastUpdateToIso,
  parseCodelistMessage,
  parseCodelistUrn,
  parseDefaultAnnotation,
  parseStructureMessage,
} from "../src/ilostat/structure.js";

/** Fixture no formato real de /dataflow/ILO/{id}/latest?references=all (spike). */
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
            { type: "DEFAULT", title: "FREQ=A,SEX=SEX_T,LASTNOBSERVATIONS=1" },
            { type: "ORDER", title: "366500" },
          ],
        },
      ],
      dataStructures: [
        {
          dataStructureComponents: {
            dimensionList: {
              dimensions: [
                { id: "REF_AREA", localRepresentation: { enumeration: "urn:sdmx:org.sdmx.infomodel.codelist.Codelist=ILO:CL_AREA(1.0)" } },
                { id: "FREQ", localRepresentation: { enumeration: "urn:sdmx:org.sdmx.infomodel.codelist.Codelist=ILO:CL_FREQ(1.0)" } },
                { id: "SEX", localRepresentation: { enumeration: "urn:sdmx:org.sdmx.infomodel.codelist.Codelist=ILO:CL_SEX(1.0)" } },
              ],
              timeDimensions: [{ id: "TIME_PERIOD" }],
            },
          },
        },
      ],
      codelists: [
        {
          id: "CL_SEX",
          version: "1.0",
          agencyID: "ILO",
          name: "Sex",
          codes: [
            { id: "SEX_T", name: "Total" },
            { id: "SEX_F", name: "Female" },
          ],
        },
      ],
    },
  };
}

describe("parseStructureMessage", () => {
  it("extrai a forma compacta: dims na ordem do DSD, vintage ISO, defaults", () => {
    const { structure, codelists } = parseStructureMessage(structureMessage());
    expect(structure.id).toBe("DF_UNE_DEAP_SEX_AGE_RT");
    expect(structure.dataVintage).toBe("2026-07-31");
    expect(structure.dimensions.map((d) => d.id)).toEqual(["REF_AREA", "FREQ", "SEX"]);
    expect(structure.dimensions[0]?.codelist).toEqual({ agency: "ILO", id: "CL_AREA", version: "1.0" });
    expect(structure.timeDimension).toBe("TIME_PERIOD");
    expect(structure.defaults).toEqual({ FREQ: "A", SEX: "SEX_T", LASTNOBSERVATIONS: "1" });
    expect(codelists).toHaveLength(1);
    expect(codelists[0]?.codes).toHaveLength(2);
  });

  it("mensagem sem dataflow lança erro", () => {
    expect(() => parseStructureMessage({ data: {} })).toThrow("sem dataflow");
  });
});

describe("helpers", () => {
  it("lastUpdateToIso: dd/MM/yyyy → yyyy-MM-dd; formato estranho → null", () => {
    expect(lastUpdateToIso("31/07/2026 20:54:15")).toBe("2026-07-31");
    expect(lastUpdateToIso("2026-07-31")).toBeNull();
    expect(lastUpdateToIso(null)).toBeNull();
  });

  it("parseCodelistUrn extrai agência/id/versão", () => {
    expect(parseCodelistUrn("urn:sdmx:org.sdmx.infomodel.codelist.Codelist=ILO:CL_AREA(1.0)")).toEqual({
      agency: "ILO",
      id: "CL_AREA",
      version: "1.0",
    });
    expect(parseCodelistUrn(undefined)).toBeNull();
  });

  it("parseDefaultAnnotation tolera valores com '+' e ignora lixo", () => {
    expect(parseDefaultAnnotation("FREQ=A,AGE=AGE_A+AGE_B,semvalor")).toEqual({
      FREQ: "A",
      AGE: "AGE_A+AGE_B",
    });
    expect(parseDefaultAnnotation("")).toBeNull();
  });

  it("parseCodelistMessage lê codelists de mensagem dedicada", () => {
    const out = parseCodelistMessage({ data: { codelists: [{ id: "CL_FREQ", codes: [{ id: "A", name: "Annual" }] }] } });
    expect(out[0]?.id).toBe("CL_FREQ");
    expect(out[0]?.codes).toEqual([{ id: "A", name: "Annual" }]);
  });
});
