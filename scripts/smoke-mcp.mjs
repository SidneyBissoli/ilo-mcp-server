/**
 * Smoke do endpoint MCP em produção (Streamable HTTP, JSON-RPC):
 * initialize → tools/list (contagem DERIVADA do baseline stdio mais recente —
 * nunca um literal) → as 4 tools ilo_* com consultas reais → erros pedagógicos
 * → search → fetch (contrato Deep Research) → id desconhecido.
 *
 * O script fala com o SERVIDOR, nunca com a OIT diretamente — quem consulta a
 * OIT é o servidor. A única exceção é a SONDA (abaixo): um GET mínimo direto
 * na fonte, só quando uma tool falhou.
 *
 * Uso:
 *   node scripts/smoke-mcp.mjs                      # produção
 *   node scripts/smoke-mcp.mjs http://localhost:8787  # outra base
 *   node scripts/smoke-mcp.mjs --sonda              # só pergunta à OIT se ela está servindo (sai 0/2)
 *
 * FONTE FORA NÃO É DEPLOY QUEBRADO. O smoke só vê o que viaja no fio (`isError`
 * + texto; a classe do erro da origem não viaja), e até 22/10/2026 decidia por
 * REGEX sobre o texto da tool (`/50\d|timeout|tempo limite|gateway/`): texto
 * fora da regex = vermelho, e o painel abria "Deploy FALHOU" para deploy que
 * não falhou (medido no bcb com o SGS em 502 e no ibge com o IBGE recusando
 * conexões de parte das nuvens, 22/10/2026). Agora a decisão é do `criarSmoke`
 * do @sbissoli/mcp-live-source: tool com `isError` inesperado → sonda direta
 * na fonte declarada → fonte fora = AVISO (`::warning title=Fonte
 * indisponível`, saída 0); fonte servindo = FALHA com o texto da tool (saída
 * 1). Verificação que lança (asserção, HTTP, JSON-RPC) é defeito do deploy e
 * sai vermelha sem sondar. Erro pedagógico (sem REF_AREA, >30 áreas, id
 * desconhecido no fetch) é `esperaErro`: a recusa é o resultado certo.
 *
 * O POOL DA OIT (medido em 22/10/2026, 30 pedidos pelo fetch do Node): a API
 * fica atrás de um balanceador com três servidores (cookie
 * `frontier-backend-https`); `srv-hematite-dmz` respondia 200 e `srv-onyx-dmz`
 * e `srv-topaze-dmz` respondiam 403 com a página HTML do IIS a um pedido bom —
 * ~60% dos pedidos naquele instante. O servidor sobrevive porque repete esse
 * 403 (`retryUpstream`, src/ilostat/upstream.ts, medido em 15/10/2026). Para o
 * classificador, 4xx é "a origem respondeu" (de pé), então uma sonda de UMA
 * tentativa diria "de pé" em 60% das vezes que a fonte estivesse fora — e
 * pintaria de vermelho. Por isso a sonda espelha a política do servidor
 * (`fetchDaSonda`): página HTML com 403 repete, até 3 tentativas, e a ÚLTIMA
 * resposta vai ao classificador sem retoque. Ressalva: se os TRÊS servidores do
 * pool estiverem na página de erro, a sonda diz "de pé, mas recusou o pedido
 * mínimo (HTTP 403)" e a tool que falhou sai vermelha — ler esse 403 no log é
 * ler "pool inteiro em página de erro"; tratar 4xx-HTML como queda é decisão do
 * pacote, não deste script.
 */

import { readdirSync, readFileSync } from "node:fs";
import { criarSmoke } from "@sbissoli/mcp-live-source";

const args = process.argv.slice(2);
const BASE = args.find((a) => !a.startsWith("--")) ?? "https://ilo.sidneybissoli.com";

/**
 * As fontes que as tools deste roteiro consultam, num pedido mínimo cada: um
 * recurso que EXISTE, com corpo pequeno, com os MESMOS cabeçalhos que o
 * servidor manda (src/ilostat/sdmx.ts: JSON só pelo `Accept`; `Accept-Language`
 * explícito porque o gateway da OIT responde 500 ao `*` que o fetch do Node
 * envia; User-Agent identificável). `SMOKE_SONDA_<NOME>` aponta a sonda para
 * outro lugar — para provar o `--sonda` dizendo FORA sem esperar a OIT cair.
 *
 * É UM host (sdmx.ilo.org), mas dois backends: a estrutura (dataflow +
 * codelists, ~3 KB em ~1 s) e os DADOS (a consulta que o gateway corta em 504
 * quando é larga; a mínima, 1 série × 1 observação, ~7 KB, medida entre 2 e
 * 15 s em 22/10/2026 — por isso o prazo maior). Sondar as duas é o que separa
 * "a OIT caiu" de "só a consulta de dados caiu". A versão `1.0` do dataflow é
 * a que a estrutura publica (o servidor também a usa literal na URL de dados;
 * `latest` responde 400). O catálogo (ilo_search_indicators, search) é D1 no
 * Worker — não tem fonte externa, e falha nele é nossa (`sondas: []`).
 */
const ehJson = (f) => (corpo) => {
  try {
    return f(JSON.parse(corpo));
  } catch {
    return false;
  }
};
const USER_AGENT = "ilo-mcp-server smoke (https://ilo.sidneybissoli.com; sbissoli76@gmail.com)";
const cabecalhos = (accept) => ({ Accept: accept, "Accept-Language": "en", "User-Agent": USER_AGENT });
const DATAFLOW_DA_SONDA = "DF_UNE_2EAP_SEX_AGE_RT";

/** Corpo que é página HTML, não resposta da API (o mesmo teste de `retryUpstream`). */
const paginaHtml = (corpo) => /^\s*<(!doctype html|html)/i.test(corpo);

/**
 * O `fetch` da sonda: a política do servidor para o pool da OIT (cabeçalho).
 * 403 com página HTML = um servidor do pool recusou; o pedido seguinte cai em
 * outro. Três tentativas, como o servidor (1 + 2 retries); qualquer outra
 * resposta — e a terceira página de erro — vai ao classificador como veio.
 */
async function fetchDaSonda(url, init) {
  let resposta;
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    resposta = await fetch(url, init);
    if (resposta.status !== 403 || !paginaHtml(await resposta.clone().text())) return resposta;
    console.log(`        sonda ${new URL(String(url)).pathname.slice(0, 48)}: 403 com página HTML do pool da OIT (tentativa ${tentativa} de 3)`);
  }
  return resposta;
}

const smoke = criarSmoke({
  fetchImpl: fetchDaSonda,
  sondas: [
    {
      nome: "sdmx-estrutura",
      url: process.env.SMOKE_SONDA_SDMX_ESTRUTURA ?? `https://sdmx.ilo.org/rest/dataflow/ILO/${DATAFLOW_DA_SONDA}/latest`,
      cabecalhos: cabecalhos("application/vnd.sdmx.structure+json"),
      aceita: ehJson((j) => j?.data?.dataflows?.[0]?.id === DATAFLOW_DA_SONDA),
    },
    {
      nome: "sdmx-dados",
      url:
        process.env.SMOKE_SONDA_SDMX_DADOS ??
        `https://sdmx.ilo.org/rest/data/ILO,${DATAFLOW_DA_SONDA},1.0/BRA.A..SEX_T.AGE_YTHADULT_YGE15?lastNObservations=1`,
      cabecalhos: cabecalhos("application/vnd.sdmx.data+json"),
      aceita: ehJson((j) => Object.keys(j?.data?.dataSets?.[0]?.series ?? {}).length > 0),
      timeoutMs: 30_000,
    },
  ],
});

// Sair no mesmo tick em que o socket do fetch fecha derruba o Node 24 no
// Windows ("Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)", rc 127
// em vez do código pedido). Um respiro resolve; medido no bcb em 22/10/2026.
async function sair(codigo) {
  await new Promise((r) => setTimeout(r, 200));
  process.exit(codigo);
}

if (args.includes("--sonda")) {
  const estados = await smoke.sondar();
  await sair(estados.every((e) => e.veredito === "servindo") ? 0 : 2);
}

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
let nextId = 1;
let sessionId = null;

async function rpc(method, params, isNotification = false) {
  const body = { jsonrpc: "2.0", method, params };
  if (!isNotification) body.id = nextId++;
  const res = await fetch(`${BASE}${ROTA_MCP}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    },
    body: JSON.stringify(body),
  });
  sessionId ??= res.headers.get("mcp-session-id");
  const text = await res.text();
  if (isNotification) return null;
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status} ${text.slice(0, 300)}`);
  // Streamable HTTP pode responder SSE; extrair o(s) data:
  const payloads =
    text.startsWith("event:") || text.includes("\ndata:") || text.startsWith("data:")
      ? text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim())
      : [text];
  const msg = JSON.parse(payloads[payloads.length - 1]);
  if (msg.error) throw new Error(`${method}: ${JSON.stringify(msg.error).slice(0, 400)}`);
  return msg.result;
}

const chamar = (name, args) => rpc("tools/call", { name, arguments: args });

/** Asserção do roteiro: lança, e o `verificar` registra como defeito do deploy. */
function exigir(condicao, msg) {
  if (!condicao) throw new Error(msg);
}

/**
 * O `structuredContent` de um resultado SEM erro. Toda tool deste servidor
 * responde com ele; a ausência é defeito nosso (o envelope de proveniência não
 * foi montado), não da OIT.
 */
function estruturado(r) {
  exigir(r?.structuredContent, `resposta sem structuredContent — ${JSON.stringify(r).slice(0, 300)}`);
  return r.structuredContent;
}

/** Verificação de que o resto depende: se falhou, conclui e sai agora. */
async function ouPara(resultado) {
  if (resultado !== undefined) return resultado;
  const resumo = smoke.concluir();
  await sair(resumo.codigoDeSaida);
}

// --- Roteiro ----------------------------------------------------------------

/** Handshake contra a rota PÚBLICA, para uma quebra só nela não passar batida. */
async function confereRotaPublica() {
  const res = await fetch(`${BASE}/mcp`, {
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
  exigir(res.ok, `rota pública /mcp: HTTP ${res.status} ${texto.slice(0, 200)}`);
  const linha = texto.includes("data:")
    ? texto.split("\n").find((l) => l.startsWith("data:"))?.slice(5).trim()
    : texto;
  const nome = JSON.parse(linha)?.result?.serverInfo?.name;
  exigir(nome, `rota pública /mcp: handshake sem serverInfo (${texto.slice(0, 200)})`);
  return nome;
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
  exigir(/^[A-Za-z0-9._~-]{1,64}$/.test(sid), `initialize sem Mcp-Session-Id legível (${JSON.stringify(sid)})`);
  const lista = await fetch(endpoint, {
    method: "POST", headers: { ...cab, "mcp-session-id": "contrato-inexistente-" + Date.now() },
    body: JSON.stringify({ jsonrpc: "2.0", id: 92, method: "tools/list", params: {} })
  });
  await lista.text();
  exigir(lista.status === 200, `tools/list com id desconhecido respondeu HTTP ${lista.status} (o handler stateless tem de ignorar o cabeçalho)`);
  const del = await fetch(endpoint, { method: "DELETE", headers: { "mcp-session-id": sid } });
  await del.text();
  exigir(del.status === 405, `DELETE respondeu HTTP ${del.status}, esperado 405 (servidor sem sessão)`);
  return "id emitido no initialize, id desconhecido ignorado, DELETE 405";
}

if (ROTA_MCP !== "/mcp") await ouPara(await smoke.verificar("rota pública /mcp", confereRotaPublica, { detalhe: (n) => n }));
await ouPara(await smoke.verificar("contrato de sessão", () => contratoDeSessao(`${BASE}${ROTA_MCP}`), { detalhe: (d) => d }));

await ouPara(
  await smoke.verificar(
    "initialize",
    async () => {
      const init = await rpc("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "smoke", version: "0.0.0" },
      });
      exigir(init?.serverInfo?.name, "handshake sem serverInfo");
      await rpc("notifications/initialized", {}, true).catch(() => {});
      return init;
    },
    { detalhe: (init) => `${init.serverInfo.name} ${init.serverInfo.version} | ${(init.instructions ?? "").slice(0, 60)}...` },
  ),
);

/** `toolCount` do baseline stdio mais recente (maior versão no nome do arquivo). */
function expectedToolCount() {
  const versao = (f) => f.match(/^surface-stdio-(\d+)\.(\d+)\.(\d+)\.json$/)?.slice(1).map(Number);
  const baselines = readdirSync("baselines")
    .filter((f) => versao(f))
    .sort((a, b) => {
      const [va, vb] = [versao(a), versao(b)];
      return va[0] - vb[0] || va[1] - vb[1] || va[2] - vb[2];
    });
  exigir(baselines.length > 0, "nenhum baselines/surface-stdio-<v>.json para derivar a contagem de tools");
  const ultimo = baselines[baselines.length - 1];
  const { toolCount } = JSON.parse(readFileSync(`baselines/${ultimo}`, "utf8"));
  exigir(Number.isInteger(toolCount), `${ultimo} sem toolCount inteiro`);
  return { toolCount, baseline: ultimo };
}

await ouPara(
  await smoke.verificar(
    "tools/list",
    async () => {
      const { toolCount, baseline } = expectedToolCount();
      const r = await rpc("tools/list", {});
      exigir(r.tools.length === toolCount, `tools/list devolveu ${r.tools.length} tools; o baseline ${baseline} diz ${toolCount}`);
      return { r, baseline };
    },
    { detalhe: ({ r, baseline }) => `${r.tools.length} tools (baseline ${baseline}): ${r.tools.map((t) => t.name).join(", ")}` },
  ),
);

// 1) A busca alimenta todo o resto: sem ela não há flowId, e nada abaixo pode
// ser afirmado sobre as tools ilo_*. É catálogo D1, sem fonte externa: falha
// aqui é nossa, e as dependentes saem "não medidas".
const busca = await smoke.verificar(
  "ilo_search_indicators",
  async () => {
    const r = await chamar("ilo_search_indicators", { query: "unemployment rate sex age", limit: 5 });
    if (r.isError) return r;
    const sc = estruturado(r);
    exigir(sc.indicators?.[0]?.id, `busca sem indicadores: ${JSON.stringify(sc).slice(0, 300)}`);
    return { flowId: sc.indicators[0].id, sc };
  },
  { sondas: [], detalhe: ({ sc }) => `${sc.total_matches} matches | [0] = ${sc.indicators[0].id} | provenance ${sc.provenance?.source}` },
);

const DEPENDEM_DA_BUSCA = [
  "ilo_get_indicator_metadata",
  "ilo_list_dimension_values SEX",
  "ilo_get_data BRA+ARG 2020–2024",
  "ilo_get_data sem REF_AREA → isError",
  "ilo_get_data >30 áreas → isError",
  "ilo_get_indicator_metadata (2ª chamada, cache)",
];

if (busca === undefined) {
  for (const nome of DEPENDEM_DA_BUSCA) smoke.naoMedida(nome, "depende do flowId que ilo_search_indicators devolveria");
} else {
  const { flowId } = busca;

  // 2) Estrutura do dataflow (uma ida ao SDMX ou acerto de KV).
  await smoke.verificar(
    DEPENDEM_DA_BUSCA[0],
    async () => {
      const r = await chamar("ilo_get_indicator_metadata", { dataflow: flowId, provenance_mode: "detailed" });
      if (r.isError) return r;
      const sc = estruturado(r);
      exigir(Array.isArray(sc.dimensions), `estrutura sem dimensions: ${JSON.stringify(sc).slice(0, 300)}`);
      return sc;
    },
    {
      sondas: ["sdmx-estrutura"],
      detalhe: (sc) => `${flowId} dims ${JSON.stringify(sc.dimensions)} | data_vintage ${sc.data_vintage} | served_from_cache ${sc.provenance?.served_from_cache}`,
    },
  );

  // 3) Codelist de uma dimensão (estrutura + codelist, o mesmo backend).
  await smoke.verificar(
    DEPENDEM_DA_BUSCA[1],
    async () => {
      const r = await chamar("ilo_list_dimension_values", { dataflow: flowId, dimension: "SEX" });
      if (r.isError) return r;
      return estruturado(r);
    },
    { sondas: ["sdmx-estrutura"], detalhe: (sc) => JSON.stringify(sc.values).slice(0, 200) },
  );

  // 4) Dados reais: a estrutura (para montar a chave) e os dados.
  await smoke.verificar(
    DEPENDEM_DA_BUSCA[2],
    async () => {
      const r = await chamar("ilo_get_data", {
        dataflow: flowId,
        filters: { REF_AREA: ["BRA", "ARG"], SEX: "SEX_T", AGE: "AGE_YTHADULT_YGE15" },
        start_period: "2020",
        end_period: "2024",
        provenance_mode: "detailed",
      });
      if (r.isError) return r;
      const sc = estruturado(r);
      return { sc, rodape: r.content?.[r.content.length - 1]?.text ?? "" };
    },
    {
      sondas: ["sdmx-estrutura", "sdmx-dados"],
      detalhe: ({ sc, rodape }) =>
        `rows ${sc.rows_count} | sample ${JSON.stringify(sc.rows?.slice(0, 1))} | retrieval ${JSON.stringify(sc.provenance?.retrieval)} | footer "${rodape.slice(0, 80)}"`,
    },
  );

  // 5) Erros pedagógicos: sem REF_AREA e >30 áreas. O isError É o resultado
  // esperado (validação local, antes de qualquer ida à OIT).
  await smoke.verificar(
    DEPENDEM_DA_BUSCA[3],
    () => chamar("ilo_get_data", { dataflow: flowId }),
    { esperaErro: true, detalhe: (e) => (e.content?.[0]?.text ?? "").replaceAll(/\s+/g, " ").slice(0, 90) },
  );
  await smoke.verificar(
    DEPENDEM_DA_BUSCA[4],
    () => chamar("ilo_get_data", { dataflow: flowId, filters: { REF_AREA: Array.from({ length: 31 }, (_, i) => `A${i}`) } }),
    { esperaErro: true, detalhe: (e) => (e.content?.[0]?.text ?? "").replaceAll(/\s+/g, " ").slice(0, 90) },
  );

  // 6) Segunda chamada de metadata: agora deve vir do cache KV.
  await smoke.verificar(
    DEPENDEM_DA_BUSCA[5],
    async () => {
      const r = await chamar("ilo_get_indicator_metadata", { dataflow: flowId, provenance_mode: "detailed" });
      if (r.isError) return r;
      return estruturado(r);
    },
    { sondas: ["sdmx-estrutura"], detalhe: (sc) => `served_from_cache ${sc.provenance?.served_from_cache}` },
  );
}

// 7) Deep Research: search → fetch pelo id devolvido → id desconhecido. O
// `content` das duas é o JSON do contrato (sem rodapé); a proveniência vem no
// structuredContent. A url citável é o data explorer público (rplumber.ilo.org),
// nunca a API SDMX. O índice do search é o catálogo D1 (sem fonte externa);
// o fetch lê a estrutura do dataflow no SDMX.
const dr = await smoke.verificar(
  "search (Deep Research)",
  async () => {
    const r = await chamar("search", { query: "unemployment rate by sex and age" });
    if (r.isError) return r;
    const sc = estruturado(r);
    const results = JSON.parse(r.content[0].text).results;
    exigir(results.length, "search sem resultado para uma consulta óbvia");
    exigir(/^ind:DF_/.test(results[0].id), `search: id fora do padrão ind:DF_…: ${results[0].id}`);
    exigir(/^https:\/\/rplumber\.ilo\.org\/dataexplorer\//.test(results[0].url), `search: url não é o data explorer público: ${results[0].url}`);
    exigir(sc.provenance, "search sem provenance no structuredContent");
    return { primeiro: results[0], total: results.length };
  },
  { sondas: [], detalhe: ({ primeiro, total }) => `${total} resultados | 1º: ${JSON.stringify(primeiro)}` },
);

if (dr === undefined) {
  smoke.naoMedida("fetch (Deep Research)", "depende do id que o search devolveria");
} else {
  await smoke.verificar(
    "fetch (Deep Research)",
    async () => {
      const r = await chamar("fetch", { id: dr.primeiro.id });
      if (r.isError) return r;
      const sc = estruturado(r);
      const d = JSON.parse(r.content[0].text);
      exigir(d.id === dr.primeiro.id, `fetch devolveu id ${d.id}, esperado ${dr.primeiro.id}`);
      exigir(sc.provenance, "fetch sem provenance no structuredContent");
      return d;
    },
    { sondas: ["sdmx-estrutura"], detalhe: (d) => `${d.id} | ${d.title} | ${d.url} | texto ${d.text.length} chars` },
  );
}

// 8) Id desconhecido: recusado pelo índice, sem tocar a OIT — o isError é o certo.
await smoke.verificar(
  "fetch id desconhecido → isError",
  () => chamar("fetch", { id: "ind:DF_NAO_EXISTE" }),
  { esperaErro: true, detalhe: (e) => (e.content?.[0]?.text ?? "").replaceAll(/\s+/g, " ").slice(0, 90) },
);

const resumo = smoke.concluir();
console.log(resumo.codigoDeSaida === 0 ? (resumo.naoMedidas.length > 0 ? "\nSMOKE OK com aviso de fonte" : "\nSMOKE OK") : "\nSMOKE FALHOU");
await sair(resumo.codigoDeSaida);
