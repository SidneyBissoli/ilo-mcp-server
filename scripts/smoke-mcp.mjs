/**
 * Smoke manual do endpoint MCP em produção (Streamable HTTP, JSON-RPC):
 * initialize → tools/list (contagem DERIVADA do baseline stdio mais recente —
 * nunca um literal) → as 4 tools ilo_* com consultas reais → search → fetch
 * (contrato Deep Research) → id desconhecido.
 *
 * Uso: node scripts/smoke-mcp.mjs [base-url]
 */

import { readdirSync, readFileSync } from "node:fs";

const BASE = process.argv[2] ?? "https://ilo.sidneybissoli.com";

/**
 * O smoke fala pela ROTA DE USO PRÓPRIO, e isso não é detalhe de estilo.
 *
 * Ele exercita caminhos de erro DE PROPÓSITO, para afirmar que a ferramenta
 * recusa o que tem de recusar. Pela rota pública essas recusas entram na
 * telemetria indistinguíveis de gente batendo numa porta emperrada — e
 * entravam: medido em 11/09/2026, os DOIS primeiros itens da fila de urgências
 * do painel eram este arquivo. No `ilo_get_data`, 30 dos 36 erros da janela
 * vinham das redes da Azure, que são os runners do GitHub Actions, e os outros
 * 6 da máquina do dono: nenhum de terceiro.
 *
 * O desconto de varredura do monitor não pega isto. Ele procura rajada de
 * catálogo e assinatura de sessão repetida, e um smoke é uma sessão pequena e
 * arrumada; pior, a repetição depende da CADÊNCIA DE DEPLOY, então ele era
 * detectado nas semanas movimentadas e passava batido nas calmas. Detecção que
 * depende de quantas vezes publicamos não é critério. Quem sabe que este
 * tráfego é nosso é este arquivo, então é ele que se identifica.
 *
 * A cobertura da rota pública não se perde: `confereRotaPublica()` abre um
 * handshake contra a rota pública antes do roteiro. `initialize` é método de
 * protocolo e o painel os exclui, então sai de graça na telemetria.
 */
const ROTA_MCP = process.env.SMOKE_MCP_ROUTE ?? "/mcp/uso-proprio";

/** Handshake contra a rota PÚBLICA, para uma quebra só nela não passar batida. */
async function confereRotaPublica(base) {
  if (ROTA_MCP === "/mcp") return;
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 0,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "smoke-rota-publica", version: "0.0.0" },
      },
    }),
  });
  const texto = await res.text();
  if (!res.ok) {
    console.error(`SMOKE FALHOU: rota pública /mcp: HTTP ${res.status} ${texto.slice(0, 200)}`);
    process.exit(1);
  }
  const linha = texto.includes("data:")
    ? texto.split("\n").find((l) => l.startsWith("data:"))?.slice(5).trim()
    : texto;
  const nome = JSON.parse(linha)?.result?.serverInfo?.name;
  if (!nome) {
    console.error(`SMOKE FALHOU: rota pública /mcp sem serverInfo (${texto.slice(0, 200)})`);
    process.exit(1);
  }
  console.log(`rota pública /mcp: ok (${nome})`);
}

/** `toolCount` do baseline stdio mais recente (maior versão no nome do arquivo). */
function expectedToolCount() {
  const versao = (f) => f.match(/^surface-stdio-(\d+)\.(\d+)\.(\d+)\.json$/)?.slice(1).map(Number);
  const baselines = readdirSync("baselines")
    .filter((f) => versao(f))
    .sort((a, b) => {
      const [va, vb] = [versao(a), versao(b)];
      return va[0] - vb[0] || va[1] - vb[1] || va[2] - vb[2];
    });
  if (baselines.length === 0) throw new Error("nenhum baselines/surface-stdio-<v>.json para derivar a contagem de tools");
  const ultimo = baselines[baselines.length - 1];
  const { toolCount } = JSON.parse(readFileSync(`baselines/${ultimo}`, "utf8"));
  if (!Number.isInteger(toolCount)) throw new Error(`${ultimo} sem toolCount inteiro`);
  return { toolCount, baseline: ultimo };
}
let nextId = 1;
let sessionId = null;

async function rpc(method, params) {
  const res = await fetch(`${BASE}${ROTA_MCP}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
  });
  sessionId ??= res.headers.get("mcp-session-id");
  const text = await res.text();
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status} ${text.slice(0, 300)}`);
  // Streamable HTTP pode responder SSE; extrair o(s) data:
  const payloads = text.startsWith("event:") || text.includes("\ndata:") || text.startsWith("data:")
    ? text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim())
    : [text];
  const msg = JSON.parse(payloads[payloads.length - 1]);
  if (msg.error) throw new Error(`${method}: ${JSON.stringify(msg.error).slice(0, 400)}`);
  return msg.result;
}

function summary(result) {
  const sc = result.structuredContent ?? {};
  const prov = sc.provenance ?? null;
  return { isError: result.isError ?? false, keys: Object.keys(sc), provenance: prov };
}

/**
 * Indisponibilidade da ILO NÃO é falha deste servidor — o smoke existe para
 * verificar o nosso lado, e o servidor degrada de propósito com `isError`
 * quando o gateway da ILO cai (504 em consulta ampla, por exemplo).
 *
 * POR QUE ISTO EXISTE. Antes, cada leitura desreferenciava `structuredContent`
 * direto; num erro de tool o script morria com
 *
 *     TypeError: Cannot read properties of undefined (reading 'dimensions')
 *
 * — mensagem que nomeia o campo errado e não diz o que aconteceu. Foi o que
 * derrubou o job de deploy em 29/08/2026 com o endpoint saudável: a ILO falhou
 * numa chamada e o smoke acusou a linha do console.log. Uma hora de diagnóstico
 * para um problema que não era nosso.
 *
 * Critério, o mesmo do `checkUpstream` do bcb-br-mcp: erro que cite 5xx/timeout
 * vira AVISO (o caminho de degradação funcionou); qualquer outro é FALHA, com o
 * texto da tool na mensagem. Chamadas que esperam erro de propósito (sem
 * REF_AREA, >30 áreas) não passam por aqui — lá o `isError` é o resultado certo.
 */
let avisos = 0;
function conteudo(result, label) {
  if (result?.isError === true) {
    const texto = result?.content?.[0]?.text ?? "(sem texto)";
    if (/50\d|timeout|tempo limite|gateway/i.test(texto)) {
      avisos++;
      console.log(`  [AVISO] ${label} — ILO indisponível agora: ${texto.slice(0, 120)}`);
      return null;
    }
    throw new Error(`${label} devolveu isError: ${texto.slice(0, 300)}`);
  }
  if (!result?.structuredContent) {
    throw new Error(`${label}: resposta sem structuredContent — ${JSON.stringify(result).slice(0, 300)}`);
  }
  return result.structuredContent;
}


/**
 * CONTRATO DE SESSÃO (desde 2026-09-17). O Worker emite `Mcp-Session-Id` no
 * initialize para a telemetria ligar as mensagens de um aperto de mão; o
 * handler é stateless e IGNORA o cabeçalho que o cliente devolve. Este teste
 * existe porque isso depende do modo stateless do SDK e do `agents`: um
 * upgrade que passasse a validar sessão quebraria todo cliente que devolve o
 * id — e quebraria aqui, no deploy, antes de virar incidente. O DELETE é 405
 * nos sete servidores (servidor sem sessão não encerra sessão).
 */
async function contratoDeSessao(endpoint) {
  const cab = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
  const init = await fetch(endpoint, {
    method: "POST", headers: cab,
    body: JSON.stringify({ jsonrpc: "2.0", id: 91, method: "initialize", params: {
      protocolVersion: "2025-06-18", capabilities: {},
      clientInfo: { name: "smoke-contrato-sessao", version: "0.0.0" } } })
  });
  await init.text();
  const sid = init.headers.get("mcp-session-id") ?? "";
  if (!/^[A-Za-z0-9._~-]{1,64}$/.test(sid)) {
    throw new Error(`contrato de sessão: initialize sem Mcp-Session-Id legível (${JSON.stringify(sid)})`);
  }
  const lista = await fetch(endpoint, {
    method: "POST", headers: { ...cab, "mcp-session-id": "contrato-inexistente-" + Date.now() },
    body: JSON.stringify({ jsonrpc: "2.0", id: 92, method: "tools/list", params: {} })
  });
  await lista.text();
  if (lista.status !== 200) {
    throw new Error(`contrato de sessão: tools/list com id desconhecido respondeu HTTP ${lista.status} (o handler stateless tem de ignorar o cabeçalho)`);
  }
  const del = await fetch(endpoint, { method: "DELETE", headers: { "mcp-session-id": sid } });
  await del.text();
  if (del.status !== 405) {
    throw new Error(`contrato de sessão: DELETE respondeu HTTP ${del.status}, esperado 405 (servidor sem sessão)`);
  }
  console.log("contrato de sessão: ok (id emitido no initialize, id desconhecido ignorado, DELETE 405)");
}

await confereRotaPublica(BASE);
await contratoDeSessao(`${BASE}${ROTA_MCP}`);

const init = await rpc("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "smoke", version: "0.0.0" },
});
console.log("initialize:", init.serverInfo, "| instructions:", (init.instructions ?? "").slice(0, 60) + "...");

await rpc("notifications/initialized", {}).catch(() => {});

const tools = await rpc("tools/list", {});
console.log("tools/list:", tools.tools.map((t) => t.name));
{
  const { toolCount, baseline } = expectedToolCount();
  if (tools.tools.length !== toolCount) {
    throw new Error(`tools/list devolveu ${tools.tools.length} tools; o baseline ${baseline} diz ${toolCount}`);
  }
  console.log(`tools/list OK — ${tools.tools.length} tools (baseline ${baseline})`);
}

const search = await rpc("tools/call", {
  name: "ilo_search_indicators",
  arguments: { query: "unemployment rate sex age", limit: 5 },
});
console.log("\nsearch_indicators:", JSON.stringify(summary(search), null, 2).slice(0, 700));

// A busca alimenta todo o resto: sem ela não há flowId, e nada abaixo pode ser
// afirmado. Se a ILO estiver fora aqui, o smoke sai INCONCLUSIVO em vez de
// vermelho — não há nada a dizer sobre o nosso lado.
const buscaSc = conteudo(search, "ilo_search_indicators");
if (!buscaSc) {
  console.log("\nSMOKE INCONCLUSIVO: gateway da ILO fora — nada a afirmar sobre o nosso lado");
  process.exit(0);
}
const flowId = buscaSc.indicators[0].id;

const meta = await rpc("tools/call", {
  name: "ilo_get_indicator_metadata",
  arguments: { dataflow: flowId, provenance_mode: "detailed" },
});
const metaSc = conteudo(meta, "ilo_get_indicator_metadata");
if (metaSc) {
  console.log("\nget_indicator_metadata:", flowId, "dims:", JSON.stringify(metaSc.dimensions));
  console.log("data_vintage:", metaSc.data_vintage, "| served_from_cache:", metaSc.provenance.served_from_cache);
}

const dims = await rpc("tools/call", {
  name: "ilo_list_dimension_values",
  arguments: { dataflow: flowId, dimension: "SEX" },
});
const dimsSc = conteudo(dims, "ilo_list_dimension_values");
if (dimsSc) console.log("\nlist_dimension_values SEX:", JSON.stringify(dimsSc.values));

const data = await rpc("tools/call", {
  name: "ilo_get_data",
  arguments: {
    dataflow: flowId,
    filters: { REF_AREA: ["BRA", "ARG"], SEX: "SEX_T", AGE: "AGE_YTHADULT_YGE15" },
    start_period: "2020",
    end_period: "2024",
    provenance_mode: "detailed",
  },
});
const sc = conteudo(data, "ilo_get_data");
if (sc) {
  console.log("\nget_data rows:", sc.rows_count, "| sample:", JSON.stringify(sc.rows.slice(0, 2)));
  console.log("provenance detailed:", JSON.stringify(sc.provenance, null, 1));
  console.log("\nfooter:", data.content[data.content.length - 1].text);
}

// Erros pedagógicos: sem REF_AREA e >30 áreas. Aqui o isError É o resultado
// esperado — não passam por conteudo(), que trataria o acerto como falha.
const err1 = await rpc("tools/call", { name: "ilo_get_data", arguments: { dataflow: flowId } });
console.log("\nsem REF_AREA → isError:", err1.isError, "|", err1.content[0].text.slice(0, 90));
const err2 = await rpc("tools/call", {
  name: "ilo_get_data",
  arguments: { dataflow: flowId, filters: { REF_AREA: Array.from({ length: 31 }, (_, i) => `A${i}`) } },
});
console.log(">30 áreas → isError:", err2.isError, "|", err2.content[0].text.slice(0, 90));

// Segunda chamada de metadata: agora deve vir do cache KV
const meta2 = await rpc("tools/call", {
  name: "ilo_get_indicator_metadata",
  arguments: { dataflow: flowId, provenance_mode: "detailed" },
});
const meta2Sc = conteudo(meta2, "ilo_get_indicator_metadata (2ª chamada)");
if (meta2Sc) {
  console.log("\nmetadata 2ª chamada served_from_cache:", meta2Sc.provenance.served_from_cache);
}

// Deep Research: search → fetch pelo id devolvido → id desconhecido. O `content`
// das duas é o JSON do contrato (sem rodapé); a proveniência vem no
// structuredContent. A url citável é o data explorer público (rplumber.ilo.org),
// nunca a API SDMX.
const dr = await rpc("tools/call", { name: "search", arguments: { query: "unemployment rate by sex and age" } });
const drSc = conteudo(dr, "search");
if (drSc) {
  const results = JSON.parse(dr.content[0].text).results;
  console.log("\nsearch:", results.length, "resultados | 1º:", JSON.stringify(results[0]));
  if (!results.length) throw new Error("search sem resultado para uma consulta óbvia");
  if (!/^ind:DF_/.test(results[0].id)) throw new Error(`search: id fora do padrão ind:DF_…: ${results[0].id}`);
  if (!/^https:\/\/rplumber\.ilo\.org\/dataexplorer\//.test(results[0].url)) {
    throw new Error(`search: url não é o data explorer público: ${results[0].url}`);
  }
  if (!drSc.provenance) throw new Error("search sem provenance no structuredContent");

  const doc = await rpc("tools/call", { name: "fetch", arguments: { id: results[0].id } });
  const docSc = conteudo(doc, "fetch");
  if (docSc) {
    const d = JSON.parse(doc.content[0].text);
    console.log("fetch:", d.id, "|", d.title, "|", d.url, "| texto:", d.text.length, "chars");
    if (d.id !== results[0].id) throw new Error(`fetch devolveu id ${d.id}, esperado ${results[0].id}`);
    if (!docSc.provenance) throw new Error("fetch sem provenance no structuredContent");
  }
}
const desconhecido = await rpc("tools/call", { name: "fetch", arguments: { id: "ind:DF_NAO_EXISTE" } });
console.log("fetch id desconhecido → isError:", desconhecido.isError, "|", desconhecido.content[0].text.slice(0, 90));
if (desconhecido.isError !== true) throw new Error("fetch de id desconhecido deveria devolver isError");

console.log(avisos ? `\nSMOKE OK (${avisos} aviso(s) de indisponibilidade da ILO)` : "\nSMOKE OK");
