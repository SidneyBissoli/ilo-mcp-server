/**
 * Contrato de proveniência 1.3 no fio (tempo 2, 15/10/2026).
 *
 * - O servidor emite 1.3 (`contractVersion` no contexto), e quem mostra a versão ao
 *   cliente (`/status`, resource de proveniência) ecoa o CONTEXTO — não um literal nem
 *   o padrão da lib (`CONTRACT_VERSION`, que segue 1.1).
 * - O `concise` leva `revision` em toda resposta (`current`; `final` ninguém usa) e
 *   `notices` só quando há aviso do dado: em `ilo_get_data`, as contagens de
 *   OBS_STATUS, UNIT_MEASURE e UNIT_MULT (unidade e escala são parte do número).
 *   Sem aviso, `notices` fica ausente — não vazio — e o rodapé não ganha linha.
 *   `derived` nunca sai: o servidor não calcula valores.
 * - Da 1.2 segue o `field_sources` em `ilo_get_data` (estrutura + dados).
 * - O `outputSchema` LISTADO aceita o que sai, e um bloco 1.3 com as quatro chaves.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONCISE_BLOCK_JSON_SCHEMA,
  CONTRACT_VERSION,
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

/** `comAviso`: a 1ª observação marcada com OBS_STATUS B; sem ele, nenhum atributo de aviso. */
function dataMessage(comAviso: boolean) {
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
        attributes: comAviso
          ? { observation: [{ id: "OBS_STATUS", values: [{ id: "B", name: "Break in series" }] }] }
          : {},
      },
      dataSets: [
        { series: { "0:0": { observations: comAviso ? { "0": [7.9, 0], "1": [6.6] } : { "0": [7.9], "1": [6.6] } } } },
      ],
    },
  };
}

function stubFetch(comAviso: boolean) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/dataflow/")) return new Response(JSON.stringify(structureMessage()), { status: 200 });
      if (url.includes("/data/")) return new Response(JSON.stringify(dataMessage(comAviso)), { status: 200 });
      throw new Error(`fetch inesperado: ${url}`);
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const ARGS = { dataflow: "DF_UNE_DEAP_SEX_AGE_RT", filters: { REF_AREA: "BRA", SEX: "SEX_T" } };
const AVISO_B = "OBS_STATUS B (Break in series): 1 observation(s)";

type Resposta = { structuredContent: Record<string, unknown>; content: Array<{ type: string; text?: string }> };

/** Roda `ilo_get_data` e devolve a resposta e o bloco CANÔNICO que o handler montou. */
async function getDataWithCanonical(mode: "concise" | "detailed", comAviso = true) {
  stubFetch(comAviso);
  const spy = vi.spyOn(provenance, "result");
  const r = (await getDataHandler(ENV)({ ...ARGS, provenance_mode: mode })) as Resposta;
  expect(spy).toHaveBeenCalledTimes(1);
  const canonical = spy.mock.calls[0]![1] as CanonicalProvenance;
  spy.mockRestore();
  return { r, canonical };
}

const bloco = (r: Resposta) => r.structuredContent.provenance as unknown as Record<string, unknown>;
const texto = (r: Resposta) => r.content.map((c) => c.text ?? "").join("\n");

describe("versão do contrato", () => {
  it("o contexto emite 1.3, e não o padrão da lib", () => {
    expect(PROVENANCE_OPTIONS.contractVersion).toBe("1.3");
    expect(provenance.contractVersion).toBe("1.3");
    expect(CONTRACT_VERSION).toBe("1.1"); // o padrão da lib; o eco NÃO pode vir dele
  });

  it("/status e o resource de proveniência ecoam a versão do CONTEXTO", () => {
    expect(buildStatus({}).provenance_contract).toBe("1.3");
    const md = provenanceMarkdown();
    expect(md).toContain("contract v1.3");
    expect(md).not.toContain(`contract v${CONTRACT_VERSION},`);
    // O guia descreve o que a 1.3 põe no fio.
    expect(md).toContain("**revision** (since contract v1.3)");
    expect(md).toContain("UNIT_MULT 3 (Thousands): 2 observation(s)");
  });

  it("o bloco detailed diz 1.3", async () => {
    const { r } = await getDataWithCanonical("detailed");
    expect(bloco(r).contract_version).toBe("1.3");
  });
});

describe("1.3 no fio: revision sempre, notices só com aviso, derived nunca", () => {
  it("concise com aviso: as chaves do schema, field_sources (1.2), notices e revision — nessa ordem", async () => {
    const { r } = await getDataWithCanonical("concise");
    const b = bloco(r);
    expect(Object.keys(b)).toEqual([
      ...CONCISE_BLOCK_JSON_SCHEMA.required,
      "field_sources",
      "notices",
      "revision",
    ]);
    expect(b.notices).toEqual([AVISO_B]);
    expect(b.revision).toEqual(ILOSTAT_VALUES_REVISION);
    expect(b).not.toHaveProperty("derived");
    expect(b).not.toHaveProperty("derivation_note");
  });

  it("o aviso do dado vai também ao rodapé de texto", async () => {
    const { r } = await getDataWithCanonical("concise");
    expect(texto(r)).toContain(`Notices from the source: ${AVISO_B}`);
  });

  it("caso comum, sem aviso: notices AUSENTE (não vazio) e nenhuma linha nova no rodapé", async () => {
    for (const mode of ["concise", "detailed"] as const) {
      const { r } = await getDataWithCanonical(mode, false);
      // O detailed mostra toda chave (lista vazia); o concise só o que há a dizer.
      if (mode === "concise") expect(bloco(r)).not.toHaveProperty("notices");
      else expect(bloco(r).notices).toEqual([]);
      expect(bloco(r).revision, mode).toEqual(ILOSTAT_VALUES_REVISION);
      expect(texto(r), mode).not.toContain("Notices from the source");
      expect(texto(r), mode).not.toContain("Preliminary data");
      expect(texto(r), mode).not.toContain("Values computed by the server");
    }
  });

  it("detailed: a mesma revision e os mesmos notices", async () => {
    const { r } = await getDataWithCanonical("detailed");
    expect(bloco(r).revision).toEqual(ILOSTAT_VALUES_REVISION);
    expect(bloco(r).notices).toEqual([AVISO_B]);
  });

  it("ilo_get_data junta estrutura + dados → field_sources com as duas leituras", async () => {
    const { r, canonical } = await getDataWithCanonical("concise");
    expect(bloco(r).field_sources).toHaveLength(2);
    expect(canonical.field_sources).toHaveLength(2);
    // Cenário completo (estrutura do KV de ontem): tests/retrieved-at-mais-antigo.test.ts.
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

describe("o outputSchema listado aceita o que sai na 1.3", () => {
  const validador = new CfWorkerJsonSchemaValidator();

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

  it("a resposta real de ilo_get_data (concise e detailed, com e sem aviso) passa", async () => {
    const schema = await listedSchema("ilo_get_data");
    for (const mode of ["concise", "detailed"] as const) {
      for (const comAviso of [true, false]) {
        const { r } = await getDataWithCanonical(mode, comAviso);
        const v = validador.getValidator(schema as never)(r.structuredContent);
        expect(v.valid, `${mode}/${comAviso}: ${v.errorMessage ?? ""}`).toBe(true);
      }
    }
  });

  it("um concise 1.3 com as QUATRO chaves passa (derived + derivation_note + notices + revision)", async () => {
    const schema = await listedSchema("ilo_get_data");
    const { r, canonical } = await getDataWithCanonical("concise");
    const { contract_version: _v, ...input } = canonical;
    const full = provenance.build({
      ...input,
      derived: true,
      derivation_note: "test-only: computed by the server",
      notices: [AVISO_B],
      revision: { status: "provisional", note: "test-only" },
    } as Parameters<typeof provenance.build>[0]);
    const r13 = provenance.result({}, full, { mode: "concise" });
    const prov = r13.structuredContent.provenance as unknown as Record<string, unknown>;
    for (const k of ["notices", "derived", "derivation_note", "revision"]) expect(prov).toHaveProperty(k);
    const v = validador.getValidator(schema as never)({ ...r.structuredContent, ...r13.structuredContent });
    expect(v.valid, v.errorMessage ?? "").toBe(true);
  });
});
