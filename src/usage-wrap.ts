/**
 * Instrumentação por tool: conta toda chamada (tool_call) e as falhas (tool_error),
 * inclusive exceções — relançadas para o SDK produzir a resposta de erro normal.
 * (Extraído do server.ts do template para que os módulos de tools importem sem
 * dependência circular com a construção do servidor.)
 */

import type { RecordUsage } from "./usage-core.js";

export function withUsage<A, R>(
  name: string,
  record: RecordUsage,
  cb: (args: A) => Promise<R>,
): (args: A) => Promise<R> {
  return async (args: A) => {
    let isError = false;
    try {
      const result = await cb(args);
      isError = (result as { isError?: unknown } | null | undefined)?.isError === true;
      return result;
    } catch (e) {
      isError = true;
      throw e;
    } finally {
      record("tool_call", name);
      if (isError) record("tool_error", name);
    }
  };
}
