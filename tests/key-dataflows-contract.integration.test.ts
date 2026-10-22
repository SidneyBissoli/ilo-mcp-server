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
 * Fonte fora ≠ deriva (item mcp:fonte-indisponivel-nao-e-deriva, 2026-10):
 * a rede passa pelo `@sbissoli/mcp-upstream` (o erro carrega o `kind`) e o
 * teste roda em `aoVivo`, que o PULA quando o SDMX está fora (timeout, rede,
 * 429, 5xx — e o HTML 403 do pool, que a política do servidor já trata) depois
 * de 3 idas e o anota como `Fonte indisponível` — job verde, o painel conta as
 * noites. Só a asserção (dataflow sumiu ou foi renomeado) é deriva, vermelho
 * rotulado `Deriva de formato`.
 *
 * Roda apenas com INTEGRATION_TESTS=1 (cron semanal + dispatch em
 * .github/workflows/integration.yml). Um fetch único (allstubs) para todos.
 */
import { describe, expect } from "vitest";
import { createUpstream } from "@sbissoli/mcp-upstream";
import { suiteAoVivo } from "@sbissoli/mcp-live-source/vitest";
import { KEY_DATAFLOWS } from "../src/resources.js";
import { CATALOG_SOURCE_URL } from "../src/ilostat/catalog.js";
import { upstreamHeaders } from "../src/ilostat/sdmx.js";
import { USER_AGENT, retryUpstream } from "../src/ilostat/upstream.js";

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

// UMA tentativa de 90 s por ida; as 3 idas (2 s, 4 s de espera) são do
// `aoVivo`. `retryUpstream` é a política do servidor (repete o 403 HTML do
// pool), mas sem retries aqui ela só decide o `kind`. Antes: fetch cru com 3
// tentativas que relançava `Error("HTTP 500")` — sem `kind`, todo 500 era vermelho.
const upstream = createUpstream({
  userAgent: USER_AGENT,
  timeoutMs: 90_000,
  retries: 0,
  retryOn: retryUpstream,
  // 200 cujo corpo é HTML (página do pool), não SDMX-JSON: ambíguo, repete.
  inspectBody: (_res, body) => (/^\s*<(!doctype html|html)/i.test(body) ? "malformed_body" : null),
});
const { aoVivo } = suiteAoVivo();

interface Allstubs {
  data?: { dataflows?: Array<{ id: string; name?: string; names?: { en?: string } }> };
}

async function liveDataflows(): Promise<Map<string, string>> {
  // Accept-Language explícito: o gateway da OIT responde HTTP 500 ao
  // `Accept-Language: *` que o undici manda por padrão (ver
  // scripts/seed-catalog.mjs, decisão do spike). `upstreamHeaders` é o que o
  // servidor manda.
  const body = await upstream
    .call()
    .json<Allstubs>(CATALOG_SOURCE_URL, { headers: upstreamHeaders("application/vnd.sdmx.structure+json") });
  const flows = body.data?.dataflows ?? [];
  expect(flows.length, "catálogo allstubs vazio").toBeGreaterThan(0);
  return new Map(flows.map((f) => [f.id, f.name ?? f.names?.en ?? ""]));
}

describe.runIf(LIVE)("contrato dos dataflows curados (SDMX real da OIT)", () => {
  const curated = KEY_DATAFLOWS.flatMap((t) => t.entries.map((e) => ({ ...e, topic: t.topic })));

  aoVivo(
    "todo dataflow curado existe e o nome vivo é compatível",
    async () => {
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
    },
    { endpoint: "allstubs", timeout: 300_000 }
  );
});
