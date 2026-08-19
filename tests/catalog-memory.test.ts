import { describe, expect, it } from "vitest";
import { catalogRowsFromMessage, InMemoryCatalog, searchRows } from "../src/ilostat/catalog-memory.js";
import { searchCatalog } from "../src/ilostat/catalog.js";
import { MemoryCache } from "../src/cli.js";

const MSG = {
  data: {
    dataflows: [
      { id: "DF_UNE_DEAP_SEX_AGE_RT", agencyID: "ILO", version: "1.0", name: "Unemployment rate by sex and age", annotations: [{ type: "SEARCH_WEIGHT", title: "5" }] },
      { id: "DF_UNE_TUNE_SEX_AGE_NB", agencyID: "ILO", version: "1.0", name: "Unemployment by sex and age (thousands)", annotations: [{ type: "SEARCH_WEIGHT", title: "9" }] },
      { id: "DF_EMP_TEMP_SEX_AGE_NB", agencyID: "ILO", version: "1.0", names: { en: "Employment by sex and age" } },
      { id: "DF_X_NO_NAME" },
    ],
  },
};

describe("catálogo em memória (runtime stdio)", () => {
  const rows = catalogRowsFromMessage(MSG);

  it("mapeia nome (name → names.en → id) e SEARCH_WEIGHT como o seed do D1", () => {
    expect(rows.map((r) => r.name)).toEqual([
      "Unemployment rate by sex and age",
      "Unemployment by sex and age (thousands)",
      "Employment by sex and age",
      "DF_X_NO_NAME",
    ]);
    expect(rows.map((r) => r.searchWeight)).toEqual([5, 9, 0, 0]);
    expect(rows[3]?.agency).toBe("ILO");
  });

  it("busca: AND entre termos, case-insensitive, sobre nome e id; ordena por peso desc, id asc", () => {
    const r = searchRows(rows, "UNEMPLOYMENT sex", 10, 0);
    expect(r.total).toBe(2);
    expect(r.entries.map((e) => e.id)).toEqual(["DF_UNE_TUNE_SEX_AGE_NB", "DF_UNE_DEAP_SEX_AGE_RT"]);
    expect(searchRows(rows, "df_x", 10, 0).entries.map((e) => e.id)).toEqual(["DF_X_NO_NAME"]);
  });

  it("pagina por limit/offset e clampa como o D1", () => {
    const all = searchRows(rows, "sex", 100, 0);
    expect(all.total).toBe(3);
    const page = searchRows(rows, "sex", 1, 1);
    expect(page.entries).toHaveLength(1);
    expect(page.entries[0]?.id).toBe(all.entries[1]?.id);
    expect(searchRows(rows, "sex", 0, -5).entries).toHaveLength(1);
  });

  it("query vazia é erro de uso", () => {
    expect(() => searchRows(rows, "   ", 10, 0)).toThrow(/Empty query/);
  });

  it("InMemoryCatalog baixa uma vez (lazy), reporta retrieved_at real e é usado por searchCatalog sem D1", async () => {
    let loads = 0;
    const big = { data: { dataflows: Array.from({ length: 120 }, (_, i) => ({ id: `DF_${i}`, name: `Dataflow ${i} labour` })) } };
    const cat = new InMemoryCatalog(async () => {
      loads++;
      return big;
    });
    const before = Date.now();
    const r1 = await searchCatalog({ CATALOG_MEMORY: cat }, "labour", 5, 0);
    const r2 = await searchCatalog({ CATALOG_MEMORY: cat }, "dataflow 1", 5, 0);
    expect(loads).toBe(1);
    expect(r1.total).toBe(120);
    expect(r1.entries).toHaveLength(5);
    expect(r2.total).toBeGreaterThan(0);
    expect(Date.parse(r1.retrievedAt)).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000);
    expect(r1.sourceUrl).toContain("/dataflow/ILO?detail=allstubs");
  });

  it("falha de download não fica presa: a próxima busca tenta de novo", async () => {
    let n = 0;
    const cat = new InMemoryCatalog(async () => {
      n++;
      if (n === 1) throw new Error("boom");
      return { data: { dataflows: Array.from({ length: 100 }, (_, i) => ({ id: `DF_${i}`, name: "x" })) } };
    });
    await expect(cat.search("x", 1)).rejects.toThrow("boom");
    await expect(cat.search("x", 1)).resolves.toMatchObject({ total: 100 });
    expect(n).toBe(2);
  });
});

describe("MemoryCache (KV em memória do runtime stdio)", () => {
  it("get/put com JSON e TTL", async () => {
    const c = new MemoryCache();
    expect(await c.get("k", "json")).toBeNull();
    await c.put("k", JSON.stringify({ a: 1 }), { expirationTtl: 60 });
    expect(await c.get<{ a: number }>("k", "json")).toEqual({ a: 1 });
    await c.put("t", JSON.stringify(1), { expirationTtl: 0.001 });
    await new Promise((r) => setTimeout(r, 5));
    expect(await c.get("t", "json")).toBeNull();
  });
});
