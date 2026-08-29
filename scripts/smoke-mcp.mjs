/**
 * Smoke manual do endpoint MCP em produção (Streamable HTTP, JSON-RPC):
 * initialize → tools/list → as 4 tools ilo_* com consultas reais.
 *
 * Uso: node scripts/smoke-mcp.mjs [base-url]
 */

const BASE = process.argv[2] ?? "https://ilo.sidneybissoli.com";
let nextId = 1;
let sessionId = null;

async function rpc(method, params) {
  const res = await fetch(`${BASE}/mcp`, {
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

const init = await rpc("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "smoke", version: "0.0.0" },
});
console.log("initialize:", init.serverInfo, "| instructions:", (init.instructions ?? "").slice(0, 60) + "...");

await rpc("notifications/initialized", {}).catch(() => {});

const tools = await rpc("tools/list", {});
console.log("tools/list:", tools.tools.map((t) => t.name));

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

console.log(avisos ? `\nSMOKE OK (${avisos} aviso(s) de indisponibilidade da ILO)` : "\nSMOKE OK");
