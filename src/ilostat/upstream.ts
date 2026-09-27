/**
 * A ida à origem: timeout, retry, orçamento — e a CONTAGEM que alimenta o bloco
 * `retrieval` do contrato de proveniência v1.1.
 *
 * Até a 1.0.0 nenhum dos três `fetch` deste servidor (estrutura/codelist, dados,
 * catálogo em memória do stdio) tinha timeout, retry ou AbortSignal: um gateway
 * lento prendia a chamada da tool até o cliente desistir, e um 503 transitório
 * virava erro na primeira tentativa. Desde a 1.1.0 (27/09/2026) a ida é do
 * `@sbissoli/mcp-upstream`, o fetch comum do portfólio: retry com backoff e
 * `Retry-After`, timeout por tentativa, orçamento total por ida e a contagem
 * de idas, tentativas e anomalias que sai na proveniência de toda resposta.
 * O pacote CLASSIFICA; este módulo DECIDE.
 *
 * Os números (`UPSTREAM_POLICY`) são a PRIMEIRA política que o servidor tem,
 * não a preservação de uma antiga — decisão de 27/09/2026, MEDIDA antes de
 * fixar (curl à API SDMX, mesmos headers do servidor): estrutura de dataflow
 * ~2,3 s; consulta pequena de dados ~1,3 s; 30 áreas × 25 anos (o teto de
 * áreas da tool) 10 s; 30 áreas, série inteira, todas as dimensões — o pior
 * caso que a tool aceita — 13 s e 11 MB; e a consulta IRRESTRITA, que o
 * gateway da OIT recusa com 504, leva **61 s** para ser recusada.
 *  - 65 s por tentativa: acima do corte do próprio gateway. Um teto menor (o
 *    rascunho dizia 20 s) cortaria toda consulta larga ANTES de a OIT
 *    responder — a legítima, que ela ainda serve, e a grande demais, cujo
 *    504 vira a mensagem pedagógica "narrow it" que o servidor sempre deu.
 *    O teto existe para a conexão pendurada, não para apressar a OIT;
 *  - 2 retries (3 tentativas) para o que é transitório, backoff 1 s → 4 s
 *    sem jitter (os testes contam o relógio);
 *  - 70 s de orçamento total: cabem 3 tentativas de falha rápida (503 em
 *    menos de 1 s, 429) com as esperas; não cabe uma segunda tentativa de
 *    65 s — e não deve caber, o cliente MCP tem paciência finita.
 *
 * O que repete e o que não (`retryOn`):
 *  - 5xx, 429 (honrando `Retry-After`) e falha de rede repetem — o padrão do pacote;
 *  - **timeout NÃO repete**: a tentativa que estourou já gastou 65 s, mais do
 *    que qualquer cliente espera duas vezes; a resposta é o erro legível
 *    ("timed out"), com "retrying later may succeed" acrescentado por
 *    `toToolError`;
 *  - **504 NÃO repete**: no gateway da OIT é "consulta grande demais",
 *    determinístico — repetir só gastaria mais 2 × 61 s para ouvir o mesmo.
 *    `fetchData` o converte no `IlostatUserError` pedagógico de sempre;
 *  - 404 não repete (o pacote já não repete): para dados é "sem observações"
 *    (linhas vazias), para estrutura é dataflow inexistente — quem decide é
 *    `sdmx.ts`, por `upstreamNotFound`;
 *  - **200 que não é JSON NÃO repete**: nunca medido na OIT. O pacote
 *    repetiria por padrão porque o bcb mediu HTML-em-200 transitório na origem
 *    DELE; aqui é paridade com o que este servidor sempre fez (o `res.json()`
 *    lançava e a chamada caía). Quando for medido, é uma linha em `retryOn`.
 *
 * O que MUDOU para quem chama: timeout e falha de rede deixam de vazar o
 * `TypeError` do fetch — que `toToolError` relançava como erro JSON-RPC cru e
 * `classifyThrown` gravava como `defeito` — e viram `IlostatUpstreamError`
 * com status 0: isError legível ("retrying later may succeed") e classe
 * `fonte` na telemetria (a mensagem diz "upstream").
 *
 * O coletor por chamada: `withUpstreamCall` abre UM `UpstreamCall` por chamada
 * de tool, propagado por `AsyncLocalStorage` (Worker com `nodejs_compat`;
 * stdio em Node). `withUsage` o chama para toda tool `ilo_*`; os handlers de
 * `search`/`fetch` (registrados pelo `@sbissoli/mcp-search`, fora do
 * `withUsage`) o chamam eles mesmos — senão o `retrieval` deles sairia `null`
 * mentindo. Chamada aninhada REUSA o coletor aberto. `ilostatProvenance` lê
 * `currentRetrieval()`. Fora de um coletor (chamada direta de handler em
 * teste) a ida ganha um descartável — a política vale — e a proveniência sai
 * `retrieval: null` ("não medido"), nunca quebra.
 *
 * `retrieved_at` continua vindo do KV/`nowIso()`, NÃO de `call.retrievedAt()`:
 * o coletor não vê o KV, e o instante relevante de um acerto de cache é o da
 * extração original, guardado junto ao valor.
 */

import {
  createUpstream,
  defaultRetryOn,
  UpstreamError,
  type RetryContext,
  type Upstream,
  type UpstreamCall,
} from "@sbissoli/mcp-upstream";
import { currentCall, withCall } from "@sbissoli/mcp-upstream/als";
import type { RetrievalInput } from "@sbissoli/mcp-provenance";

/**
 * User-Agent identificável (política do portfólio: sysadmins upstream devem
 * conseguir chegar ao contato). Sem User-Agent, o gateway da OIT responde 500.
 */
export const USER_AGENT = "ilo-mcp-server (https://ilo.sidneybissoli.com; sbissoli76@gmail.com)";

/** A política de rede do servidor (ver o cabeçalho: números medidos em 27/09/2026). */
export const UPSTREAM_POLICY = {
  /** Teto de UMA tentativa (cabeçalhos + corpo) — acima dos 61 s do corte do gateway. */
  timeoutMs: 65_000,
  /** Retries além da primeira tentativa (só para o que é transitório — ver `retryUpstream`). */
  retries: 2,
  /** Orçamento TOTAL de uma ida, esperas incluídas. */
  budgetMs: 70_000,
  backoff: { baseMs: 1_000, maxMs: 4_000, jitterMs: 0 },
} as const;

/**
 * Erro do upstream (não é uso errado da tool): status + trecho do corpo.
 * `status` 0 = a origem não respondeu (timeout, rede): a mensagem diz
 * "unreachable" em vez de "HTTP 0". Nos dois casos ela contém "upstream", que
 * é o que `classifyError` lê para a classe `fonte`.
 */
export class IlostatUpstreamError extends Error {
  readonly status: number;
  constructor(status: number, context: string, detail: string) {
    super(
      status === 0
        ? `ILOSTAT upstream unreachable (${context}): ${detail}`
        : `ILOSTAT upstream HTTP ${status} (${context}): ${detail}`,
    );
    this.name = "IlostatUpstreamError";
    this.status = status;
  }
}

/**
 * I/O da espera entre tentativas, num objeto para os testes trocarem
 * (`vi.spyOn(upstreamIo, "sleep")`): o 503 permanente de um stub custaria
 * 5 s reais de backoff por teste.
 */
export const upstreamIo = {
  sleep: (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** A decisão de repetir uma tentativa que falhou (o pacote diz a classe). */
export function retryUpstream(ctx: RetryContext): boolean {
  // A tentativa que estourou já gastou 65 s — ninguém espera isso duas vezes.
  if (ctx.kind === "timeout") return false;
  // "Consulta grande demais" — determinístico, e o servidor já ensina a estreitar.
  if (ctx.status === 504) return false;
  // 200 que não é JSON: nunca medido na OIT — paridade (ver cabeçalho).
  if (ctx.kind === "malformed_body") return false;
  return defaultRetryOn(ctx);
}

/**
 * A política de rede na forma do pacote, com a ligação TARDIA ao `fetch`
 * global — os testes o dublam depois de o módulo carregar.
 */
export function upstreamIlo(): Upstream {
  return createUpstream({
    userAgent: USER_AGENT,
    timeoutMs: UPSTREAM_POLICY.timeoutMs,
    retries: UPSTREAM_POLICY.retries,
    budgetMs: UPSTREAM_POLICY.budgetMs,
    backoff: UPSTREAM_POLICY.backoff,
    honorRetryAfter: true,
    retryOn: retryUpstream,
    sleep: (ms) => upstreamIo.sleep(ms),
    fetchImpl: (input, init) => globalThis.fetch(input, init),
  });
}

/**
 * Abre o coletor de UMA chamada de tool e roda `fn` dentro dele — ou reusa o
 * que já está aberto, se `fn` é um passo de uma chamada maior.
 */
export function withUpstreamCall<T>(fn: () => Promise<T>): Promise<T> {
  return currentCall() ? fn() : withCall(upstreamIlo(), () => fn());
}

/** O coletor da chamada corrente; fora de uma, um descartável (a ida ainda tem política). */
export function upstreamCall(): UpstreamCall {
  return currentCall() ?? upstreamIlo().call();
}

/** O `retrieval` medido nesta chamada — `null` fora de um coletor ou sem ida à origem. */
export function currentRetrieval(): RetrievalInput | null {
  return currentCall()?.retrieval() ?? null;
}

/** A origem respondeu 404 (ausência é resposta; o que ela significa é de quem chama). */
export function upstreamNotFound(e: unknown): boolean {
  return e instanceof UpstreamError && e.kind === "not_found";
}

/** O status HTTP da resposta final, quando uma chegou. */
export function upstreamStatus(e: unknown): number | undefined {
  return e instanceof UpstreamError ? e.status : undefined;
}

/**
 * Do erro do pacote (classe + contagem) ao erro que o resto do servidor lê
 * (`IlostatUpstreamError`, por `instanceof` em `tools/errors.ts`). Qualquer
 * outro erro passa intacto.
 */
export function translateUpstreamError(e: unknown, context: string): unknown {
  if (!(e instanceof UpstreamError)) return e;
  const tries = e.attempts === 1 ? "1 attempt" : `${e.attempts} attempts`;
  switch (e.kind) {
    // Cada fragmento abaixo tem de ter classe SOZINHO em `classifyError` (a
    // guarda de call-shape.test.ts lê os literais desta chamada, não a
    // mensagem montada): "timeout", "upstream" → `fonte`.
    case "timeout":
      return new IlostatUpstreamError(
        0,
        context,
        `timeout after ${tries} (${UPSTREAM_POLICY.timeoutMs / 1000} s each)`,
      );
    case "network":
      return new IlostatUpstreamError(0, context, `network error after ${tries}: ${causeText(e.cause)}`);
    case "aborted":
      return new IlostatUpstreamError(0, context, "upstream request aborted");
    case "malformed_body":
      return new IlostatUpstreamError(e.status ?? 200, context, "malformed upstream response: body is not valid JSON");
    default: {
      // Um status chegou: http_4xx, http_5xx, rate_limited, not_found. O corpo
      // vai junto, cortado — é nele que a OIT diz o motivo.
      const snippet = (e.body ?? "").slice(0, 300);
      return new IlostatUpstreamError(
        e.status ?? 0,
        context,
        e.attempts > 1 ? `${snippet} (after ${tries})` : snippet,
      );
    }
  }
}

function causeText(cause: unknown): string {
  if (cause instanceof Error) return cause.message || cause.name;
  return cause === undefined ? "unknown" : String(cause);
}
