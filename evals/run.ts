/**
 * Rodada de eval com modelo real (Anthropic Messages API).
 *
 * CUSTO: cobra uso de API separado de qualquer assinatura. Nunca rodar com
 * ANTHROPIC_API_KEY sem decisão explícita. Sem a chave, imprime instruções e
 * sai com código 0 (nunca quebra CI).
 *
 * Uso: npm run eval   (env: EVAL_MODEL, EVAL_CONCURRENCY, EVAL_LIMIT)
 */

import { runEval } from "@sbissoli/mcp-evals";
import { CATALOG } from "./catalog.js";
import { FIXTURES } from "./fixtures/queries.js";

// Roda sob tsx/Node; o tsconfig é o do Worker (sem @types/node) — declaração mínima.
declare const process: { exit(code: number): void };

const { exitCode } = await runEval({
  catalog: CATALOG,
  fixtures: FIXTURES,
  systemPrompt:
    "You are the tool router of the ILOSTAT MCP server (ILO labour statistics). " +
    "Given the user's request, choose the single best tool for the FIRST step of the " +
    "answer and call it. Do not answer in text — just call the tool.",
});
process.exit(exitCode);
