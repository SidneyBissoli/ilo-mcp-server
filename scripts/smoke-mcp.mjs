/**
 * Smoke manual do endpoint MCP em produção (Streamable HTTP, JSON-RPC):
 * initialize → tools/list → as 4 tools ilo_* com consultas reais.
 *
 * Uso: node scripts/smoke-mcp.mjs [base-url]
 */

const BASE = process.argv[2] ?? "https://ilostat.sidneybissoli.com";
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
const flowId = search.structuredContent.indicators[0].id;

const meta = await rpc("tools/call", {
  name: "ilo_get_indicator_metadata",
  arguments: { dataflow: flowId, provenance_mode: "detailed" },
});
console.log("\nget_indicator_metadata:", flowId, "dims:", JSON.stringify(meta.structuredContent.dimensions));
console.log("data_vintage:", meta.structuredContent.data_vintage, "| served_from_cache:", meta.structuredContent.provenance.served_from_cache);

const dims = await rpc("tools/call", {
  name: "ilo_list_dimension_values",
  arguments: { dataflow: flowId, dimension: "SEX" },
});
console.log("\nlist_dimension_values SEX:", JSON.stringify(dims.structuredContent.values));

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
const sc = data.structuredContent;
console.log("\nget_data rows:", sc.rows_count, "| sample:", JSON.stringify(sc.rows.slice(0, 2)));
console.log("provenance detailed:", JSON.stringify(sc.provenance, null, 1));
console.log("\nfooter:", data.content[data.content.length - 1].text);

// Erros pedagógicos: sem REF_AREA e >30 áreas
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
console.log("\nmetadata 2ª chamada served_from_cache:", meta2.structuredContent.provenance.served_from_cache);

console.log("\nSMOKE OK");
