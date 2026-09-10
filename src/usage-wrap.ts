/**
 * Instrumentação por tool: conta toda chamada (tool_call) e as falhas (tool_error),
 * inclusive exceções — relançadas para o SDK produzir a resposta de erro normal.
 * (Extraído do server.ts do template para que os módulos de tools importem sem
 * dependência circular com a construção do servidor.)
 *
 * Também é o ÚNICO ponto por onde passa toda chamada de tool, e por isso é aqui
 * que a FORMA da chamada é montada: os NOMES dos parâmetros e a CLASSE do erro.
 * Nunca o valor de um parâmetro — ver `call-shape.ts`.
 */

import { classifyError, errorText, paramNames } from "./call-shape.js";
import type { RecordUsage } from "./usage-core.js";

export function withUsage<A, R>(
  name: string,
  record: RecordUsage,
  cb: (args: A) => Promise<R>,
): (args: A) => Promise<R> {
  return async (args: A) => {
    let isError = false;
    let classe = "";
    try {
      const result = await cb(args);
      isError = (result as { isError?: unknown } | null | undefined)?.isError === true;
      if (isError) classe = classifyError(errorText(result));
      return result;
    } catch (e) {
      isError = true;
      classe = classifyError(e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      const forma = { params: paramNames(args), classe: "" };
      record("tool_call", name, forma);
      if (isError) record("tool_error", name, { ...forma, classe });
    }
  };
}
