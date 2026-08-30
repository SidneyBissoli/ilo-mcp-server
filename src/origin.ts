/**
 * Quais Origins este servidor aceita — a defesa contra DNS rebinding.
 *
 * Só cliente de NAVEGADOR manda `Origin`; cliente MCP comum não manda nenhum, e
 * requisição sem Origin segue válida. A spec MCP 2026-07-28 (§Security &
 * Endpoint) exige que o servidor valide o header e devolva 403 para origem
 * estrangeira: sem isso, uma página maliciosa aberta no navegador da vítima
 * resolve o próprio nome para este servidor e conversa com ele com a rede dela.
 *
 * Mora fora do src/index.ts porque a regra é testável sem subir o Worker — e
 * porque é a mesma lista em dois pontos do fluxo: o handler (que devolve o 403)
 * e o guarda de cursor, que só age sobre requisição de origem aceita para não
 * inverter a ordem "segurança antes de protocolo".
 */

import { SERVER_CONFIG } from "./config.js";

/**
 * Hostnames de Origin aceitos: os mesmos do header Host (domínio próprio,
 * workers.dev, dev local) e, quando ALLOWED_ORIGIN nomeia uma origem concreta,
 * o hostname dela — para que um app de navegador autorizado pelo CORS não seja
 * barrado aqui. "*" no CORS não afrouxa esta lista: ver o comentário no handler.
 */
export function allowedOriginHostnames(allowedOrigin: string | undefined): string[] {
  const hostnames = [...SERVER_CONFIG.extraAllowedHostnames];
  if (allowedOrigin && allowedOrigin !== "*") {
    try {
      const { protocol, hostname } = new URL(allowedOrigin);
      if ((protocol === "http:" || protocol === "https:") && hostname && !hostnames.includes(hostname)) {
        hostnames.push(hostname);
      }
    } catch {
      // ALLOWED_ORIGIN mal formado não vira permissão silenciosa: fica só a lista base.
    }
  }
  return hostnames;
}

/**
 * O Origin desta requisição está na lista? Sem header Origin (todo cliente MCP
 * que não é navegador) a resposta é sim — é o mesmo critério do handler.
 */
export function origemAceita(request: Request, hostnamesAceitos: string[]): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return hostnamesAceitos.includes(new URL(origin).hostname);
  } catch {
    return false;
  }
}
