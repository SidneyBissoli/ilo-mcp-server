import { afterEach, describe, expect, it, vi } from "vitest";
import { uisGetDataHandler, uisListGeoUnitsHandler, uisSearchIndicatorsHandler, noticesFromUisRecords } from "../src/tools/uis.js";
import type { Env } from "../src/types.js";

/** D1 fake mínimo: roteia pelos trechos de SQL usados por src/uis/catalog.ts. */
function fakeDb(opts: { rows: unknown[]; total: number; retrievedAt: string | null; release?: string }): D1Database {
  const db = {
    prepare(sql: string) {
      const stmt = {
        bind: (..._params: unknown[]) => stmt,
        async first() {
          if (sql.includes("COUNT(*)")) return { n: opts.total };
          return null;
        },
        async all() {
          if (sql.includes("uis_meta")) {
            const results = [];
            if (opts.retrievedAt !== null) {
              results.push({ key: "retrieved_at", value: opts.retrievedAt });
              if (opts.release) results.push({ key: "release_version", value: opts.release });
            }
            return { results };
          }
          return { results: opts.rows };
        },
      };
      return stmt;
    },
  };
  return db as unknown as D1Database;
}

const INDICATOR_ROW = {
  code: "CR.1",
  name: "Completion rate, primary education, both sexes (%)",
  theme: "EDUCATION",
  last_data_update: "2026-02-09",
  record_count: 3000,
  year_min: 2000,
  year_max: 2024,
  geo_types: "NATIONAL,REGIONAL",
};

describe("uisSearchIndicatorsHandler", () => {
  it("retorna indicadores + proveniência UIS segregada (CC BY-SA, served_from_cache)", async () => {
    const env: Env = {
      CATALOG_DB: fakeDb({ rows: [INDICATOR_ROW], total: 1, retrievedAt: "2026-08-07T18:00:00Z", release: "20260507-91260335" }),
    };
    const r = (await uisSearchIndicatorsHandler(env)({
      query: "completion rate",
      provenance_mode: "detailed",
    })) as { structuredContent: Record<string, unknown> };

    const sc = r.structuredContent;
    expect(sc.total_matches).toBe(1);
    expect((sc.indicators as Array<Record<string, unknown>>)[0]).toMatchObject({
      code: "CR.1",
      theme: "EDUCATION",
      years: "2000-2024",
    });
    const p = sc.provenance as Record<string, Record<string, unknown>> & Record<string, unknown>;
    expect(p.served_from_cache).toBe(true);
    expect(p.retrieved_at).toBe("2026-08-07T18:00:00Z");
    expect((p.license as Record<string, unknown>).id).toBe("CC-BY-SA-4.0");
    // Atribuição UIS obrigatória: URL completa + data de extração (docs/02).
    expect(String(p.citation)).toBe(
      "Source: UNESCO Institute for Statistics (UIS), " +
        "https://api.uis.unesco.org/api/public/definitions/indicators, date of extraction 2026-08-07.",
    );
  });

  it("query vazia → erro pedagógico", async () => {
    const env: Env = { CATALOG_DB: fakeDb({ rows: [], total: 0, retrievedAt: "x" }) };
    const r = (await uisSearchIndicatorsHandler(env)({ query: "  " })) as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toContain("Empty query");
  });

  it("catálogo sem seed → erro de servidor (lança, não isError)", async () => {
    const env: Env = { CATALOG_DB: fakeDb({ rows: [INDICATOR_ROW], total: 1, retrievedAt: null }) };
    await expect(uisSearchIndicatorsHandler(env)({ query: "literacy" })).rejects.toThrow(/seed/);
  });
});

describe("uisListGeoUnitsHandler", () => {
  it("lista geo units com proveniência do catálogo", async () => {
    const env: Env = {
      CATALOG_DB: fakeDb({
        rows: [{ id: "BRA", name: "Brazil", type: "NATIONAL" }],
        total: 1,
        retrievedAt: "2026-08-07T18:00:00Z",
      }),
    };
    const r = (await uisListGeoUnitsHandler(env)({ search: "brazil" })) as {
      structuredContent: Record<string, unknown>;
    };
    const sc = r.structuredContent;
    expect((sc.geo_units as unknown[])[0]).toEqual({ id: "BRA", name: "Brazil", type: "NATIONAL" });
    const p = sc.provenance as Record<string, unknown>;
    expect(p.source_url).toBe("https://api.uis.unesco.org/api/public/definitions/geounits");
  });
});

const RELEASE_BODY = {
  version: "20260507-91260335",
  publicationDate: "2026-05-08T16:58:36.233Z",
  themeDataStatus: [{ theme: "EDUCATION", lastUpdate: "02/09/2026", description: "February 2026 Data Release" }],
};

function mockUisFetch(dataBody: unknown, dataStatus = 200) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/versions/default")) {
      return new Response(JSON.stringify(RELEASE_BODY), { status: 200 });
    }
    return new Response(JSON.stringify(dataBody), { status: dataStatus });
  });
}

describe("uisGetDataHandler", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("retorna registros com release fixada na URL e proveniência CC BY-SA", async () => {
    const fetchMock = mockUisFetch({
      records: [
        {
          indicatorId: "CR.1",
          geoUnit: "BRA",
          year: 2024,
          value: 97.6,
          magnitude: null,
          qualifier: null,
          footnotes: [{ type: "Source", subtype: "Data sources", value: "PNAD-C 2024" }],
        },
      ],
    });
    vi.stubGlobal("fetch", fetchMock);

    const r = (await uisGetDataHandler({} as Env)({
      indicators: ["CR.1"],
      geo_units: ["BRA"],
      start_year: 2020,
      end_year: 2024,
      include_footnotes: true,
      provenance_mode: "detailed",
    })) as { structuredContent: Record<string, unknown> };

    const sc = r.structuredContent;
    expect(sc.rows_count).toBe(1);
    expect((sc.rows as Array<Record<string, unknown>>)[0]).toMatchObject({
      indicator: "CR.1",
      geo_unit: "BRA",
      year: 2024,
      value: 97.6,
    });

    const p = sc.provenance as Record<string, unknown>;
    // A URL canônica fixa a release (pinagem + cache CloudFront keyed pela URL).
    expect(String(p.source_url)).toContain("version=20260507-91260335");
    expect(String(p.source_url)).toContain("indicator=CR.1");
    expect(p.data_vintage).toBe("20260507-91260335 (published 2026-05-08)");
    expect((p.license as Record<string, unknown>).id).toBe("CC-BY-SA-4.0");
    expect(String(p.citation)).toMatch(/^Source: UNESCO Institute for Statistics \(UIS\), https:\/\/api\.uis\.unesco\.org\/.+, date of extraction \d{4}-\d{2}-\d{2}\.$/);
    expect(p.served_from_cache).toBe(false);
    expect(p.notices).toEqual(["Source (Data sources): 1 record(s)"]);
  });

  it("mais registros que o teto → erro pedagógico com a contagem (nunca trunca)", async () => {
    const many = Array.from({ length: 5001 }, (_, i) => ({
      indicatorId: "CR.1",
      geoUnit: "BRA",
      year: 1900 + (i % 100),
      value: i,
      magnitude: null,
      qualifier: null,
    }));
    vi.stubGlobal("fetch", mockUisFetch({ records: many }));

    const r = (await uisGetDataHandler({} as Env)({ indicators: ["CR.1"] })) as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toContain("5001 records");
    expect(r.content[0]?.text).toContain("Narrow");
  });

  it("HTTP 400 do upstream (teto de 100k) → mensagem pedagógica repassada", async () => {
    vi.stubGlobal(
      "fetch",
      mockUisFetch({ message: "Too much data requested (124982 records), please reduce the amount of records queried to less than 100000 by using the available filter options." }, 400),
    );
    const r = (await uisGetDataHandler({} as Env)({ indicators: ["20062", "SAP.02"] })) as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toContain("124982 records");
    expect(r.content[0]?.text).toContain("Narrow the query");
  });

  it("seleção sem registros → hint pedagógico, não erro", async () => {
    vi.stubGlobal("fetch", mockUisFetch({ records: [] }));
    const r = (await uisGetDataHandler({} as Env)({ indicators: ["CR.1"], geo_units: ["XKX"] })) as {
      structuredContent: Record<string, unknown>;
    };
    expect(r.structuredContent.rows_count).toBe(0);
    expect(String(r.structuredContent.hint)).toContain("No records");
  });
});

describe("noticesFromUisRecords", () => {
  it("agrega footnotes, magnitude e qualifier com contagem", () => {
    const notices = noticesFromUisRecords([
      { indicatorId: "X", geoUnit: "BRA", year: 2020, value: 1, magnitude: "NIL", qualifier: null, footnotes: [{ type: "Source", subtype: null, value: "a" }] },
      { indicatorId: "X", geoUnit: "BRA", year: 2021, value: 2, magnitude: null, qualifier: "UIS_EST", footnotes: [{ type: "Source", subtype: null, value: "b" }] },
    ]);
    expect(notices).toEqual(["Magnitude NIL: 1 record(s)", "Qualifier UIS_EST: 1 record(s)", "Source: 2 record(s)"]);
  });
});
