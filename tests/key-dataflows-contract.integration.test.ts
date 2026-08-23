/**
 * Contrato dos dataflows curados — valida, contra o catálogo REAL do SDMX da
 * OIT, que cada id de KEY_DATAFLOWS (resource ilostat://reference/key-dataflows,
 * a lista que os prompts mandam o modelo consultar primeiro) ainda existe e
 * que o nome vivo é compatível com o nome curado.
 *
 * Por que existe (regra de autoria do portfólio, caso ibge-br-mcp 2026-08):
 * ids curados entram "de memória" e envelhecem em silêncio — a OIT pode
 * aposentar ou renomear um dataflow e a busca continuaria funcionando,
 * mas o atalho curado apontaria para o vazio ou para outra coisa.
 *
 * Roda apenas com INTEGRATION_TESTS=1 (cron semanal + dispatch em
 * .github/workflows/integration.yml). Um fetch único (allstubs) para todos.
 */
import { describe, expect, it } from "vitest";
import { KEY_DATAFLOWS } from "../src/resources.js";
import { CATALOG_SOURCE_URL } from "../src/ilostat/catalog.js";

const LIVE = process.env.INTEGRATION_TESTS === "1" || process.env.INTEGRATION_TESTS === "true";

const STOPWORDS = new Set([
  "of", "by", "and", "the", "a", "an", "in", "as", "to", "per", "rate", "sex",
  "age", "total", "percent", "annual", "monthly", "thousands",
]);

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/[\s-]+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w))
  );
}

async function liveDataflows(): Promise<Map<string, string>> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(CATALOG_SOURCE_URL, {
        // Accept-Language explícito: o gateway da OIT responde HTTP 500 ao
        // `Accept-Language: *` que o undici manda por padrão (ver
        // scripts/seed-catalog.mjs, decisão do spike).
        headers: {
          Accept: "application/vnd.sdmx.structure+json",
          "Accept-Language": "en",
        },
        signal: AbortSignal.timeout(90_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as {
        data?: { dataflows?: Array<{ id: string; name?: string; names?: { en?: string } }> };
      };
      const flows = body.data?.dataflows ?? [];
      if (flows.length === 0) throw new Error("catálogo vazio");
      return new Map(flows.map((f) => [f.id, f.name ?? f.names?.en ?? ""]));
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
    }
  }
  throw new Error(`allstubs: ${String(lastErr)}`);
}

describe.runIf(LIVE)("contrato dos dataflows curados (SDMX real da OIT)", () => {
  const curated = KEY_DATAFLOWS.flatMap((t) => t.entries.map((e) => ({ ...e, topic: t.topic })));

  it("todo dataflow curado existe e o nome vivo é compatível", async () => {
    const live = await liveDataflows();
    const problems: string[] = [];
    for (const entry of curated) {
      const liveName = live.get(entry.id);
      if (liveName === undefined) {
        problems.push(`${entry.id} (${entry.topic}: "${entry.name}") NÃO existe mais no catálogo da OIT`);
        continue;
      }
      const shared = [...tokens(entry.name)].filter((t) => tokens(liveName).has(t));
      if (shared.length === 0) {
        problems.push(
          `${entry.id}: nome curado "${entry.name}" não compartilha nenhum termo com o nome vivo "${liveName}" — id trocado ou renomeado?`
        );
      }
    }
    expect(problems, problems.join("\n")).toEqual([]);
  }, 300_000);
});
