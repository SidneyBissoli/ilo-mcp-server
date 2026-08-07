import { describe, expect, it } from "vitest";
import { searchIndicatorsHandler } from "../src/tools/catalog.js";
import type { Env } from "../src/types.js";

/** D1 fake mínimo: roteia pelos trechos de SQL usados por searchCatalog. */
function fakeDb(opts: { rows: unknown[]; total: number; retrievedAt: string | null }): D1Database {
  const db = {
    prepare(sql: string) {
      return {
        bind: (..._params: unknown[]) => ({
          async first() {
            if (sql.includes("catalog_meta")) {
              return opts.retrievedAt === null ? null : { value: opts.retrievedAt };
            }
            if (sql.includes("COUNT(*)")) return { n: opts.total };
            return null;
          },
          async all() {
            return { results: opts.rows };
          },
        }),
      };
    },
  };
  return db as unknown as D1Database;
}

const ROW = { id: "DF_UNE_DEAP_SEX_AGE_RT", agency: "ILO", version: "1.0", name: "Unemployment rate by sex and age" };

describe("searchIndicatorsHandler", () => {
  it("retorna indicadores + proveniência do catálogo (served_from_cache, retrieved_at do seed)", async () => {
    const env: Env = { CATALOG_DB: fakeDb({ rows: [ROW], total: 1, retrievedAt: "2026-08-07T12:00:00Z" }) };
    const r = (await searchIndicatorsHandler(env)({
      query: "unemployment rate",
      provenance_mode: "detailed",
    })) as { structuredContent: Record<string, unknown> };

    const sc = r.structuredContent;
    expect(sc.total_matches).toBe(1);
    expect((sc.indicators as unknown[])[0]).toEqual({
      id: "DF_UNE_DEAP_SEX_AGE_RT",
      name: "Unemployment rate by sex and age",
      version: "1.0",
    });
    const p = sc.provenance as Record<string, unknown>;
    expect(p.served_from_cache).toBe(true);
    expect(p.retrieved_at).toBe("2026-08-07T12:00:00Z");
    expect(p.source_url).toBe("https://sdmx.ilo.org/rest/dataflow/ILO?detail=allstubs");
  });

  it("hint quando há mais resultados que o limite", async () => {
    const env: Env = { CATALOG_DB: fakeDb({ rows: [ROW], total: 40, retrievedAt: "2026-08-07T12:00:00Z" }) };
    const r = (await searchIndicatorsHandler(env)({ query: "rate" })) as {
      structuredContent: Record<string, unknown>;
    };
    expect(String(r.structuredContent.hint)).toContain("highest-ranked");
  });

  it("query vazia → erro pedagógico", async () => {
    const env: Env = { CATALOG_DB: fakeDb({ rows: [], total: 0, retrievedAt: "x" }) };
    const r = (await searchIndicatorsHandler(env)({ query: "   " })) as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toContain("Empty query");
  });

  it("catálogo sem seed → erro de servidor (lança, não isError)", async () => {
    const env: Env = { CATALOG_DB: fakeDb({ rows: [ROW], total: 1, retrievedAt: null }) };
    await expect(searchIndicatorsHandler(env)({ query: "rate" })).rejects.toThrow(/seed/);
  });
});
