/**
 * Resources e prompts (0.3.0): o servidor REAL, pelo transporte em memória,
 * anuncia exatamente as listas canônicas (RESOURCE_URIS / PROMPT_NAMES), toda
 * resource lê como markdown não vazio, todo prompt devolve uma mensagem de
 * usuário que cita as tools, e todo dataflow id citado nas resources/prompts
 * existe no seed do catálogo (tests/fixtures/catalog-ids.txt, gerado pelo seed) —
 * para que a documentação nunca aponte para um id que a busca não encontraria.
 * A rede nunca é tocada.
 */

/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { buildServer } from "../src/server.js";
import { PROMPT_NAMES, compareCountriesText, countryProfileText, indicatorTrendText } from "../src/prompts.js";
import { KEY_DATAFLOWS, RESOURCE_URIS, guideMarkdown, keyDataflowsMarkdown, provenanceMarkdown } from "../src/resources.js";
import { TOOL_NAMES } from "../src/tools/index.js";
import { buildStatus } from "../src/status.js";

let client: Client;

beforeAll(async () => {
  const server = buildServer({});
  const [ct, st] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "capabilities", version: "0.0.0" });
  await Promise.all([server.connect(st), client.connect(ct)]);
});
afterAll(async () => {
  await client.close();
});

describe("resources", () => {
  it("resources/list anuncia exatamente RESOURCE_URIS, todas com título e descrição", async () => {
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri).sort()).toEqual([...RESOURCE_URIS].sort());
    for (const r of resources) {
      expect(r.title).toBeTruthy();
      expect(r.description).toBeTruthy();
      expect(r.mimeType).toBe("text/markdown");
    }
  });

  it("toda resource lê como markdown não vazio, com o uri pedido", async () => {
    for (const uri of RESOURCE_URIS) {
      const { contents } = await client.readResource({ uri });
      expect(contents).toHaveLength(1);
      const c = contents[0] as { uri: string; mimeType?: string; text?: string };
      expect(c.uri).toBe(uri);
      expect(c.mimeType).toBe("text/markdown");
      expect(c.text?.length ?? 0).toBeGreaterThan(500);
      expect(c.text?.startsWith("# ")).toBe(true);
    }
  });

  it("o guia cita as 4 tools e a resource de dataflows cita todos os KEY_DATAFLOWS", () => {
    const guide = guideMarkdown();
    for (const t of TOOL_NAMES) expect(guide).toContain(t);
    const key = keyDataflowsMarkdown();
    for (const s of KEY_DATAFLOWS) for (const e of s.entries) expect(key).toContain(e.id);
    expect(provenanceMarkdown()).toContain("CC BY 4.0");
  });
});

describe("prompts", () => {
  it("prompts/list anuncia exatamente PROMPT_NAMES, com título, descrição e argumentos", async () => {
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual([...PROMPT_NAMES].sort());
    for (const p of prompts) {
      expect(p.title).toBeTruthy();
      expect(p.description).toBeTruthy();
      expect((p.arguments ?? []).length).toBeGreaterThan(0);
      for (const a of p.arguments ?? []) expect(a.description).toBeTruthy();
    }
  });

  it("nomes de prompt respeitam o teto de 64 chars", () => {
    for (const n of PROMPT_NAMES) expect(n.length).toBeLessThanOrEqual(64);
  });

  const casos: Array<{ name: string; args: Record<string, string>; expects: string[] }> = [
    {
      name: "ilo_country_labour_profile",
      args: { country: "Brazil", start_period: "2015", end_period: "2024" },
      expects: ["Brazil", "2015", "2024", "ilo_get_data", "DF_UNE_DEAP_SEX_AGE_RT", "citation"],
    },
    {
      name: "ilo_compare_countries",
      args: { countries: "BRA, ARG, CHL", indicator: "youth unemployment rate" },
      expects: ["BRA, ARG, CHL", "youth unemployment rate", "ilo_search_indicators", "last_n_observations", "30"],
    },
    {
      name: "ilo_indicator_trend",
      args: { indicator: "labour force participation rate", country: "India", start_period: "2000" },
      expects: ["India", "2000", "ilo_get_indicator_metadata", "OBS_STATUS"],
    },
  ];
  for (const caso of casos) {
    it(`prompts/get ${caso.name} → 1 mensagem de usuário com o workflow`, async () => {
      const r = await client.getPrompt({ name: caso.name, arguments: caso.args });
      expect(r.messages).toHaveLength(1);
      const m = r.messages[0]!;
      expect(m.role).toBe("user");
      const text = (m.content as { type: string; text: string }).text;
      expect((m.content as { type: string }).type).toBe("text");
      for (const e of caso.expects) expect(text).toContain(e);
      for (const uri of RESOURCE_URIS) expect(text).toContain(uri);
    });
  }

  it("argumento obrigatório ausente → erro do protocolo (não mensagem vazia)", async () => {
    await expect(client.getPrompt({ name: "ilo_country_labour_profile", arguments: {} })).rejects.toThrow();
  });
});

describe("dataflow ids citados existem no seed do catálogo", () => {
  // Lista compacta versionada, gerada junto com o SQL do seed (scripts/seed-catalog.mjs).
  // cwd = raiz do repo (vitest.config.ts).
  const idsNoSeed = new Set(
    readFileSync("tests/fixtures/catalog-ids.txt", "utf-8")
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith("#")),
  );

  it("seed carregado", () => {
    expect(idsNoSeed.size).toBeGreaterThan(1000);
  });

  it("KEY_DATAFLOWS ⊂ seed (sem ids duplicados)", () => {
    const all = KEY_DATAFLOWS.flatMap((s) => s.entries.map((e) => e.id));
    expect(new Set(all).size).toBe(all.length);
    for (const id of all) expect(idsNoSeed.has(id), id).toBe(true);
  });

  it("todo DF_* mencionado no guia e nos prompts existe no seed", () => {
    const textos = [
      guideMarkdown(),
      countryProfileText({ country: "x" }),
      compareCountriesText({ countries: "x", indicator: "y" }),
      indicatorTrendText({ indicator: "x", country: "y" }),
    ].join("\n");
    const citados = new Set([...textos.matchAll(/DF_[A-Z0-9_]+(?=[^A-Z0-9_…]|$)/g)].map((m) => m[0]));
    expect(citados.size).toBeGreaterThan(0);
    for (const id of citados) expect(idsNoSeed.has(id), id).toBe(true);
  });
});

describe("GET /status", () => {
  it("expõe contagens e nomes de resources e prompts (badges do README)", () => {
    const s = buildStatus({});
    expect(s.resources).toBe(RESOURCE_URIS.length);
    expect(s.resource_uris).toEqual([...RESOURCE_URIS]);
    expect(s.prompts).toBe(PROMPT_NAMES.length);
    expect(s.prompt_names).toEqual([...PROMPT_NAMES]);
  });
});
