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

import { classeAnexada, classifyError, classifyThrown, errorText, paramNames } from "./call-shape.js";
import { withUpstreamCall } from "./ilostat/upstream.js";
import type { RecordUsage } from "./usage-core.js";

/**
 * Por ser o ponto único, é também aqui que se abre o COLETOR DE REDE da
 * chamada (`withUpstreamCall`): toda ida à OIT feita dentro de `cb` conta, e
 * `ilostatProvenance` lê a contagem para o `retrieval` do bloco. `search` e
 * `fetch` não passam por aqui (são do `@sbissoli/mcp-search`) e abrem o
 * coletor nos próprios handlers — ver `tools/deep-research.ts`.
 */
export function withUsage<A, R>(
  name: string,
  record: RecordUsage,
  cb: (args: A) => Promise<R>,
): (args: A) => Promise<R> {
  return async (args: A) => {
    let isError = false;
    let classe = "";
    try {
      const result = await withUpstreamCall(() => cb(args));
      isError = (result as { isError?: unknown } | null | undefined)?.isError === true;
      // A classe que `toToolError` anexou pelo TIPO vence a frase; a frase fica
      // para o erro que nasceu sem tipo. Ver CLASSE_DO_ERRO em call-shape.ts.
      if (isError) classe = classeAnexada(result) ?? classifyError(errorText(result));
      return result;
    } catch (e) {
      isError = true;
      // `classifyThrown` e não `classifyError`: aqui o OBJETO do erro existe,
      // e o tipo dele separa bug nosso (`TypeError` & cia. -> `defeito`) de
      // condição da fonte. Pela mensagem, um `TypeError` caía em `outro`.
      classe = classifyThrown(e);
      throw e;
    } finally {
      const forma = { params: paramNames(args), classe: "" };
      record("tool_call", name, forma);
      if (isError) record("tool_error", name, { ...forma, classe });
    }
  };
}
