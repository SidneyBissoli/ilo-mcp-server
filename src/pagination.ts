/**
 * Cursor de paginação inválido — a recusa que o SDK não faz.
 *
 * O PROBLEMA. Toda lista deste servidor cabe numa página só (6 tools, 3
 * resources, 1 template, 3 prompts), então nenhuma resposta traz `nextCursor` e
 * nenhum cursor emitido por este servidor existe. Os quatro handlers de lista
 * do `@modelcontextprotocol/server` 2.0.0 simplesmente IGNORAM `params.cursor` e
 * devolvem a lista inteira — inclusive para um cursor que o servidor nunca
 * emitiu. A spec (§Pagination, Error Handling, em toda revisão datada) diz que
 * cursor inválido DEVE virar `-32602`, e o `mcpscore` reprovava os quatro
 * endpoints nos dois transportes (medição de 29/08/2026).
 *
 * POR QUE AQUI, E NÃO NO HANDLER DO SDK. Sobrescrever `tools/list` exigiria
 * reimplementar a listagem a partir do registro privado do McpServer
 * (`_registeredTools`, com a conversão de schema junto) — trocar um defeito
 * pequeno por uma cópia do SDK que envelhece sozinha. A recusa é uma decisão
 * sobre a MENSAGEM, não sobre o conteúdo da lista, então mora na borda por onde
 * a mensagem entra: o POST do Worker (src/index.ts) e o transporte stdio
 * (src/cli.ts). O predicado é o mesmo nos dois — este módulo.
 *
 * ENQUANTO NÃO HOUVER SEGUNDA PÁGINA. Se algum dia uma lista passar a paginar
 * de verdade, este módulo deixa de valer: a recusa passa a ser "cursor que não
 * decodifica", e quem emite o cursor é quem sabe reconhecê-lo. O teste
 * tests/pagination.test.ts prende a premissa (nenhuma lista emite nextCursor)
 * para que a mudança não passe em silêncio.
 */

/** Código JSON-RPC de parâmetro inválido (spec §Pagination, Error Handling). */
export const INVALID_PARAMS = -32602;

/** Os quatro métodos de lista paginável do MCP. */
export const PAGINATED_LIST_METHODS = [
  "tools/list",
  "resources/list",
  "resources/templates/list",
  "prompts/list",
] as const;

/** Resposta de erro JSON-RPC — a forma que os dois transportes enviam. */
export interface JsonRpcErrorResponse {
  jsonrpc: "2.0";
  id: string | number;
  error: { code: number; message: string };
}

interface PossivelRequisicao {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: { cursor?: unknown } | null;
}

/**
 * Devolve a recusa `-32602` quando a mensagem é uma requisição de lista que
 * carrega `cursor`; `undefined` em qualquer outro caso (inclusive notificação,
 * lote e mensagem malformada — nenhum deles é assunto deste guarda, e o SDK
 * responde por eles).
 */
export function unknownCursorError(message: unknown): JsonRpcErrorResponse | undefined {
  if (typeof message !== "object" || message === null || Array.isArray(message)) return undefined;
  const { jsonrpc, id, method, params } = message as PossivelRequisicao;
  if (jsonrpc !== "2.0") return undefined;
  // Sem id é notificação: não existe resposta para devolver.
  if (typeof id !== "string" && typeof id !== "number") return undefined;
  if (typeof method !== "string") return undefined;
  if (!(PAGINATED_LIST_METHODS as readonly string[]).includes(method)) return undefined;
  if (params === null || typeof params !== "object" || params.cursor === undefined) return undefined;

  return {
    jsonrpc: "2.0",
    id,
    error: {
      code: INVALID_PARAMS,
      message:
        `Invalid params: unknown pagination cursor for ${method}. ` +
        "This server returns every list in a single page and never issues a nextCursor, " +
        "so no cursor value is valid — retry without one.",
    },
  };
}

/**
 * Adaptador HTTP: lê uma CÓPIA do corpo (o original segue intacto para o
 * handler) e devolve a resposta de recusa, ou `undefined` para seguir o fluxo.
 * Corpo que não é JSON não é assunto daqui — o handler dá o erro dele.
 */
export async function cursorRejection(
  request: Request,
  corsOrigin: string,
): Promise<Response | undefined> {
  let corpo: unknown;
  try {
    corpo = await request.clone().json();
  } catch {
    return undefined;
  }
  const erro = unknownCursorError(corpo);
  if (!erro) return undefined;
  // 200 com erro JSON-RPC no corpo: a falha é de protocolo, não de HTTP — é
  // assim que o cliente MCP lê o código -32602.
  return new Response(JSON.stringify(erro), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": corsOrigin,
    },
  });
}
