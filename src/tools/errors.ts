/**
 * Conversão de erros de domínio em resposta de tool MCP (isError=true):
 * erro de USO (IlostatUserError) devolve a mensagem pedagógica intacta;
 * erro de UPSTREAM devolve status + contexto sem stack; o resto relança
 * (bug do servidor — o SDK produz a resposta de erro padrão e o withUsage conta).
 */

import { IlostatUserError } from "../ilostat/key.js";
import { IlostatUpstreamError } from "../ilostat/sdmx.js";
import { CLASSE_DO_ERRO, type ErrorClass } from "../call-shape.js";

// Type alias (não interface): CallToolResult do SDK tem index signature
// `[x: string]: unknown`, e só aliases de objeto recebem index signature implícita.
export type ToolErrorResult = {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
};

export function toToolError(e: unknown): ToolErrorResult {
  if (e instanceof IlostatUserError) {
    // A classe declarada pelo erro, não a frase: a frase ecoa o argumento
    // ("INVALID") e o regex decidia por ele. Ver IlostatUserError.
    return comClasse({ content: [{ type: "text", text: e.message }], isError: true }, e.classe);
  }
  if (e instanceof IlostatUpstreamError) {
    const r: ToolErrorResult = {
      content: [
        {
          type: "text",
          text:
            `${e.message}\n` +
            (e.classe === "contrato"
              ? "The ILO rejected an argument (see the detail above) — fix it; retrying unchanged will fail again."
              : "This is an upstream (ILO) failure, not an invalid query — retrying later may succeed."),
        },
      ],
      isError: true,
    };
    // A classe vai pelo TIPO, fora do fio: pela frase, o "invalid" do sufixo
    // acima mandava toda falha da OIT para `contrato`. Ver CLASSE_DO_ERRO.
    return comClasse(r, e.classe);
  }
  throw e;
}

/**
 * ÚNICO lugar que monta resultado de erro: todo `isError: true` sai daqui com a
 * classe anexada (chave-símbolo não enumerável — o fio não muda). A guarda
 * `tests/sem-iserror-literal.test.ts` reprova `isError: true` em outro arquivo.
 */
function comClasse(r: ToolErrorResult, classe: ErrorClass): ToolErrorResult {
  Object.defineProperty(r, CLASSE_DO_ERRO, { value: classe, enumerable: false });
  return r;
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
