/**
 * Contrato de proveniência: tempo 2 da 1.2 e tempo 1 da 1.3 (08/10/2026).
 *
 * - O servidor emite 1.2 (`contractVersion` no contexto), e quem mostra a versão ao
 *   cliente (`/status`, resource de proveniência) ecoa o CONTEXTO — não um literal nem
 *   o padrão da lib (`CONTRACT_VERSION`, que segue 1.1).
 * - O ilo não funde sub-fontes: com 1.2 nenhuma resposta leva `field_sources`.
 * - `revision` (decisão do dono: `current` em todo o portfólio fora o sih; `final`
 *   ninguém usa) já está no canônico; o fio 1.2 não a carrega.
 * - O `outputSchema` LISTADO já aceita um bloco 1.3 completo (`notices`, `derived`,
 *   `derivation_note`, `revision`): é o que deixa ligar a 1.3 depois sem quebrar
 *   conector nenhum (contrato §8).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONTRACT_VERSION,
  createProvenanceContext,
  type CanonicalProvenance,
} from "@sbissoli/mcp-provenance";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/server/validators/cf-worker";
import { conectarComoCliente } from "@sbissoli/mcp-surface/cliente";
import { PROVENANCE_OPTIONS } from "../src/config.js";
import {
  ILOSTAT_REVISION,
  ILOSTAT_VALUES_REVISION,
  ilostatProvenance,
  provenance,
} from "../src/ilostat/provenance.js";
import { provenanceMarkdown } from "../src/resources.js";
import { buildServer } from "../src/server.js";
import { buildStatus } from "../src/status.js";
import { getDataHandler } from "../src/tools/data.js";
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

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/dataflow/")) return new Response(JSON.stringify(structureMessage()), { status: 200 });
      if (url.includes("/data/")) return new Response(JSON.stringify(dataMessage()), { status: 200 });
      throw new Error(`fetch inesperado: ${url}`);
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const ARGS = { dataflow: "DF_UNE_DEAP_SEX_AGE_RT", filters: { REF_AREA: "BRA", SEX: "SEX_T" } };

/** Roda `ilo_get_data` e devolve a resposta e o bloco CANÔNICO que o handler montou. */
async function getDataWithCanonical(mode: "concise" | "detailed") {
  stubFetch();
  const spy = vi.spyOn(provenance, "result");
  const r = (await getDataHandler(ENV)({ ...ARGS, provenance_mode: mode })) as {
    structuredContent: Record<string, unknown>;
  };
  expect(spy).toHaveBeenCalledTimes(1);
  const canonical = spy.mock.calls[0]![1] as CanonicalProvenance;
  spy.mockRestore();
  return { r, canonical };
}

describe("versão do contrato", () => {
  it("o contexto emite 1.2, e não o padrão da lib", () => {
    expect(PROVENANCE_OPTIONS.contractVersion).toBe("1.2");
    expect(provenance.contractVersion).toBe("1.2");
    expect(CONTRACT_VERSION).toBe("1.1"); // o padrão da lib; o eco NÃO pode vir dele
  });

  it("/status e o resource de proveniência ecoam a versão do CONTEXTO", () => {
    expect(buildStatus({}).provenance_contract).toBe("1.2");
    const md = provenanceMarkdown();
    expect(md).toContain("contract v1.2");
    expect(md).not.toContain(`contract v${CONTRACT_VERSION},`);
  });

  it("o bloco detailed diz 1.2", async () => {
    const { r } = await getDataWithCanonical("detailed");
    expect((r.structuredContent.provenance as unknown as Record<string, unknown>).contract_version).toBe("1.2");
  });
});

describe("1.2 no fio: nada além da versão muda", () => {
  it("sem fusão de sub-fontes → sem field_sources, no concise e no detailed", async () => {
    const concise = await getDataWithCanonical("concise");
    expect(concise.r.structuredContent.provenance).not.toHaveProperty("field_sources");
    expect(concise.canonical.field_sources ?? null).toBeNull();
    // O detailed é o canônico inteiro: a chave sai como `null` (já saía na 1.1).
    const detailed = await getDataWithCanonical("detailed");
    expect((detailed.r.structuredContent.provenance as unknown as Record<string, unknown>).field_sources).toBeNull();
  });

  it("a resposta 1.2 é byte a byte a 1.1, fora o contract_version (concise, detailed e rodapé)", async () => {
    const ctx11 = createProvenanceContext({ ...PROVENANCE_OPTIONS, contractVersion: "1.1" });
    for (const mode of ["concise", "detailed"] as const) {
      const { r, canonical } = await getDataWithCanonical(mode);
      const { contract_version: _v, ...input } = canonical;
      const p11 = ctx11.build(input as Parameters<typeof ctx11.build>[0]);
      const r11 = ctx11.result({}, p11, { mode });
      const r12 = provenance.result({}, canonical, { mode });
      expect(r12.structuredContent.provenance).toEqual(
        mode === "detailed"
          ? { ...(r11.structuredContent.provenance as unknown as Record<string, unknown>), contract_version: "1.2" }
          : r11.structuredContent.provenance,
      );
      expect(JSON.stringify(r12.content)).toBe(JSON.stringify(r11.content));
      expect(r.structuredContent.provenance).toEqual(r12.structuredContent.provenance);
    }
  });

  it("revision fica fora do fio enquanto o servidor emite 1.2", async () => {
    const concise = await getDataWithCanonical("concise");
    expect(concise.r.structuredContent.provenance).not.toHaveProperty("revision");
    const detailed = await getDataWithCanonical("detailed");
    expect(detailed.r.structuredContent.provenance).not.toHaveProperty("revision");
    expect(JSON.stringify(detailed.r)).not.toContain("re-estimates modelled series");
  });
});

describe("revision no canônico (decisão do dono: current; final não se usa)", () => {
  it("ilo_get_data: current, com a nota que o servidor já publica sobre revisões", async () => {
    const { canonical } = await getDataWithCanonical("concise");
    expect(canonical.revision).toEqual(ILOSTAT_VALUES_REVISION);
    expect(canonical.revision?.status).toBe("current");
    expect(canonical.revision?.note).toMatch(/revises published figures/);
    expect(canonical.revision?.note).toMatch(/_2 ids/);
  });

  it("demais respostas (catálogo, estrutura, codelist): current, sem nota", () => {
    const p = ilostatProvenance({ retrievedAt: "2026-10-08T00:00:00Z", sourceUrl: "https://sdmx.ilo.org/rest/x" });
    expect(p.revision).toEqual({ status: "current", note: null });
    expect(p.revision).toEqual(ILOSTAT_REVISION);
  });

  it("nenhum bloco do servidor diz final", () => {
    expect(ILOSTAT_REVISION.status).not.toBe("final");
    expect(ILOSTAT_VALUES_REVISION.status).not.toBe("final");
  });
});

describe("tempo 1 da 1.3: o outputSchema listado aceita um bloco 1.3", () => {
  const validador = new CfWorkerJsonSchemaValidator();
  const ctx13 = createProvenanceContext({ ...PROVENANCE_OPTIONS, contractVersion: "1.3" });

  /** O mesmo canônico, reconstruído por um contexto 1.3 (o bloco leva a versão consigo). */
  function as13(canonical: CanonicalProvenance, extra: Record<string, unknown> = {}): CanonicalProvenance {
    const { contract_version: _v, ...input } = canonical;
    return ctx13.build({ ...input, ...extra } as Parameters<typeof ctx13.build>[0]);
  }

  async function listedSchema(tool: string): Promise<Record<string, unknown>> {
    const client = await conectarComoCliente(buildServer({}));
    try {
      const { tools } = await client.listTools();
      const t = tools.find((x) => x.name === tool);
      expect(t?.outputSchema, `${tool} sem outputSchema`).toBeDefined();
      return t!.outputSchema as Record<string, unknown>;
    } finally {
      await client.close();
    }
  }

  it("a resposta real de ilo_get_data, re-renderizada em 1.3 (concise e detailed), passa", async () => {
    const schema = await listedSchema("ilo_get_data");
    for (const mode of ["concise", "detailed"] as const) {
      const { r, canonical } = await getDataWithCanonical(mode);
      const r13 = ctx13.result({}, as13(canonical), { mode });
      const prov = r13.structuredContent.provenance as unknown as Record<string, unknown>;
      // O que a 1.3 vai pôr no fio do ilo: os avisos do OBS_STATUS e a revisão.
      expect(prov.notices).toEqual(["OBS_STATUS B (Break in series): 1 observation(s)"]);
      expect(prov.revision).toEqual(ILOSTAT_VALUES_REVISION);
      const sc = { ...r.structuredContent, ...r13.structuredContent };
      const v = validador.getValidator(schema as never)(sc);
      expect(v.valid, `${mode}: ${v.errorMessage ?? ""}`).toBe(true);
    }
  });

  it("um concise 1.3 com as QUATRO chaves passa (derived + derivation_note + notices + revision)", async () => {
    const schema = await listedSchema("ilo_get_data");
    const { r, canonical } = await getDataWithCanonical("concise");
    const full = as13(canonical, {
      derived: true,
      derivation_note: "test-only: computed by the server",
      notices: ["OBS_STATUS B (Break in series): 1 observation(s)"],
      revision: { status: "provisional", note: "test-only" },
    });
    const r13 = ctx13.result({}, full, { mode: "concise" });
    const prov = r13.structuredContent.provenance as unknown as Record<string, unknown>;
    for (const k of ["notices", "derived", "derivation_note", "revision"]) expect(prov).toHaveProperty(k);
    const v = validador.getValidator(schema as never)({ ...r.structuredContent, ...r13.structuredContent });
    expect(v.valid, v.errorMessage ?? "").toBe(true);
  });
});
