/**
 * Entrypoint do Worker — template de hosting da Fase 0.
 *
 * Fluxo por request: rotas públicas (landing, /health, /status, /metrics) →
 * Bearer auth opcional → rate limit por cliente → createMcpHandler (stateless,
 * factory cria um McpServer novo por request — MCP SDK v2 + agents 0.20+).
 */

import { createMcpHandler } from "agents/mcp/server";
import { checkAuth } from "./auth.js";
import { SERVER_CONFIG } from "./config.js";
import { ICON_PNG_BASE64 } from "./icon.js";
import { landingResponse } from "./landing.js";
import { discoveryResponseForPath } from "./discovery.js";
import { logger } from "./logger.js";
import { allowedOriginHostnames, origemAceita } from "./origin.js";
import { cursorRejection } from "./pagination.js";
import { checkRateLimit } from "./rate-limit.js";
import { tagRequest, withAnalytics } from "./analytics.js";
import { buildServer } from "./server.js";
import { buildStatus } from "./status.js";
import type { Env } from "./types.js";
import { createUsageRecorder, usageSnapshot, UsageTracker } from "./usage.js";

// O runtime instancia o Durable Object a partir do export do entrypoint.
export { UsageTracker };

function json(data: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

// Decodificado uma vez por isolate, nao por request.
const ICON_PNG = Uint8Array.from(atob(ICON_PNG_BASE64), (c) => c.charCodeAt(0));

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const start = Date.now();
    const record = createUsageRecorder(env, ctx);
    const isMcp = url.pathname === SERVER_CONFIG.mcpRoute;

    // --- Rotas públicas, servidas antes de qualquer auth ---
    if (url.pathname === "/") return landingResponse();
    // robots.txt, sitemap.xml e a chave do IndexNow vêm ANTES da auth: um
    // rastreador não tem credencial, e robots.txt atrás de Bearer é o mesmo que
    // não ter robots.txt.
    const descoberta = discoveryResponseForPath(url.pathname);
    if (descoberta) return descoberta;
    if (url.pathname === "/health") {
      return new Response("ok", { status: 200, headers: { "Content-Type": "text/plain" } });
    }
    if (url.pathname === "/status") {
      return json(buildStatus(env), { "Cache-Control": "no-store" });
    }
    // Icone do servidor — publico: e o que server.json declara e o que os
    // diretorios buscam. Mesmo host do servidor, como o schema do MCP recomenda.
    if (url.pathname === "/icon.png") {
      return new Response(ICON_PNG, {
        status: 200,
        headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" },
      });
    }
    if (url.pathname === "/metrics") {
      const snap = await usageSnapshot(env);
      return json(snap ?? { aviso: "binding USAGE ausente — estatísticas de uso desativadas" });
    }

    // Desafio de posse do claim no mcpindex.ai: serve o token temporário do
    // secret MCPINDEX_CHALLENGE (janela de 15 min do claim) como text/plain.
    // Sem o secret — o estado permanente — a rota responde 404.
    if (url.pathname === "/.well-known/mcpindex-challenge") {
      if (!env.MCPINDEX_CHALLENGE) {
        return new Response("Not Found", {
          status: 404,
          headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
        });
      }
      return new Response(env.MCPINDEX_CHALLENGE, {
        status: 200,
        headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
      });
    }

    // Preflight CORS nunca carrega Authorization — o handler MCP responde o OPTIONS.
    if (request.method !== "OPTIONS") {
      const authResponse = await checkAuth(request, env.API_KEY);
      if (authResponse) {
        if (isMcp) record("auth_failure", url.pathname);
        logger.warn("auth_failure", {
          method: request.method,
          path: url.pathname,
          status: authResponse.status,
        });
        return authResponse;
      }

      const clientId = request.headers.get("CF-Connecting-IP") ?? "unknown";
      const decision = checkRateLimit(clientId);
      if (!decision.allowed) {
        if (isMcp) record("rate_limited", url.pathname);
        return new Response("Too Many Requests", {
          status: 429,
          headers: { "Retry-After": String(decision.retryAfterS), "Content-Type": "text/plain" },
        });
      }
    }

    // Só o endpoint MCP entra nas métricas de uso: paths inexistentes (varredura de
    // bots) inflavam "request"/"rate_limited" em ordens de grandeza sobre o uso real.
    if (isMcp) record("request", url.pathname);

    // Contexto da requisição (país/AS/marcador self) + escrita no Analytics
    // Engine pegando carona no hook de uso — ver src/analytics.ts.
    const recordWithAnalytics = withAnalytics(record, env.ANALYTICS, tagRequest(request, env.SELF_MARKER));

    const origensAceitas = allowedOriginHostnames(env.ALLOWED_ORIGIN);

    // Cursor de paginação inválido → -32602 (ver src/pagination.ts: os handlers
    // de lista do SDK ignoram o cursor). Só depois do guarda de Origin abaixo é
    // que o handler recusaria a requisição estrangeira; para a ordem não
    // inverter (recusa de protocolo ANTES da recusa de segurança), a mesma
    // lista de origens vale aqui: Origin estrangeiro cai direto no handler, que
    // devolve o 403.
    if (isMcp && request.method === "POST" && origemAceita(request, origensAceitas)) {
      const recusa = await cursorRejection(request, env.ALLOWED_ORIGIN || "*");
      if (recusa) {
        logger.info("invalid_cursor", { path: url.pathname });
        return recusa;
      }
    }

    const handler = createMcpHandler(() => buildServer(env, recordWithAnalytics), {
      route: SERVER_CONFIG.mcpRoute,
      // Sem a opção, o handler aceita localhost e *.workers.dev. Ao definir
      // extraAllowedHostnames (domínio próprio), a lista SUBSTITUI os defaults —
      // inclua nela também o hostname workers.dev se ele continuar servido.
      ...(SERVER_CONFIG.extraAllowedHostnames.length
        ? { allowedHostnames: [...SERVER_CONFIG.extraAllowedHostnames] }
        : {}),
      // Header Origin (só clientes de NAVEGADOR o enviam; cliente MCP comum não
      // manda nenhum, e requisição sem Origin segue válida). A spec 2026-07-28
      // §Security exige 403 para Origin estrangeiro: é a defesa contra DNS
      // rebinding — a página maliciosa que, no navegador da vítima, resolve o
      // nome dela para este servidor e conversa com ele.
      //
      // Aqui havia `allowedOriginHostnames: "*"` sempre que ALLOWED_ORIGIN era
      // "*", e "*" DESLIGA a validação (o handler só a dispensa quando ela roda
      // em middleware confiável antes) — o mcpscore media 200 para Origin
      // estrangeiro, achado de severidade HIGH em 29/08/2026. O CORS e o Origin
      // respondem a perguntas diferentes: CORS "*" diz quem pode LER a resposta,
      // esta lista diz de qual página o servidor aceita ser chamado.
      //
      // Também não serve deixar em branco: o default do handler é localhost +
      // o hostname de um corsOptions.origin concreto, e com "*" isso deixaria o
      // próprio domínio de fora. A lista é a mesma do header Host, mais a origem
      // configurada quando ALLOWED_ORIGIN nomeia uma.
      allowedOriginHostnames: origensAceitas,
      corsOptions: {
        origin: env.ALLOWED_ORIGIN || "*",
        methods: "GET, POST, DELETE, OPTIONS",
        headers: "Content-Type, Accept, mcp-session-id, MCP-Protocol-Version, Authorization",
        maxAge: 86400,
      },
    });

    const response = await handler(request, env, ctx);
    logger.info("request", {
      method: request.method,
      path: url.pathname,
      status: response.status,
      ms: Date.now() - start,
    });
    return response;
  },
} satisfies ExportedHandler<Env>;
