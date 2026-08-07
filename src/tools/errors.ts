/**
 * Conversão de erros de domínio em resposta de tool MCP (isError=true):
 * erro de USO (IlostatUserError) devolve a mensagem pedagógica intacta;
 * erro de UPSTREAM devolve status + contexto sem stack; o resto relança
 * (bug do servidor — o SDK produz a resposta de erro padrão e o withUsage conta).
 */

import { IlostatUserError } from "../ilostat/key.js";
import { IlostatUpstreamError } from "../ilostat/sdmx.js";
import { UisUpstreamError } from "../uis/api.js";

// Type alias (não interface): CallToolResult do SDK tem index signature
// `[x: string]: unknown`, e só aliases de objeto recebem index signature implícita.
export type ToolErrorResult = {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
};

export function toToolError(e: unknown): ToolErrorResult {
  if (e instanceof IlostatUserError) {
    return { content: [{ type: "text", text: e.message }], isError: true };
  }
  if (e instanceof IlostatUpstreamError) {
    return {
      content: [
        {
          type: "text",
          text:
            `${e.message}\n` +
            "This is an upstream (ILO) failure, not an invalid query — retrying later may succeed.",
        },
      ],
      isError: true,
    };
  }
  if (e instanceof UisUpstreamError) {
    return {
      content: [
        {
          type: "text",
          text:
            `${e.message}\n` +
            "This is an upstream (UNESCO UIS) failure, not an invalid query — retrying later may succeed.",
        },
      ],
      isError: true,
    };
  }
  throw e;
}

/** Envolve um handler assíncrono com a conversão de erros acima. */
export function withToolErrors<A, R>(
  cb: (args: A) => Promise<R>,
): (args: A) => Promise<R | ToolErrorResult> {
  return async (args: A) => {
    try {
      return await cb(args);
    } catch (e) {
      return toToolError(e);
    }
  };
}
