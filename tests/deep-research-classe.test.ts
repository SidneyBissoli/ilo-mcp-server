/**
 * Fiação da classe do erro em `search`/`fetch` (30/09/2026).
 *
 * Até o `@sbissoli/mcp-search` 0.7.0 as duas tools eram classificadas só pela
 * FRASE: a exceção virava texto e o tipo se perdia. A 0.8.0 decide pelo tipo
 * (id desconhecido, `error.classe`, `classifyThrown`) — comportamento testado
 * no pacote. O que é DESTE servidor é entregar os dois classificadores; é isso
 * que este teste prende.
 */

import { describe, expect, it, vi } from "vitest";

const capturado: { opts?: Record<string, unknown> } = {};
vi.mock("@sbissoli/mcp-search", async (importOriginal) => {
  const original = await importOriginal<typeof import("@sbissoli/mcp-search")>();
  return {
    ...original,
    registerDeepResearchTools: (_server: unknown, opts: Record<string, unknown>) => {
      capturado.opts = opts;
    },
  };
});

const { registerDeepResearchTools } = await import("../src/tools/deep-research.js");
const { classifyError, classifyThrown } = await import("../src/call-shape.js");

describe("search/fetch recebem os classificadores do servidor", () => {
  it("classifyError e classifyThrown chegam ao pacote", () => {
    registerDeepResearchTools({} as never, {} as never, () => {});
    expect(capturado.opts?.classifyError).toBe(classifyError);
    expect(capturado.opts?.classifyThrown).toBe(classifyThrown);
  });
});
