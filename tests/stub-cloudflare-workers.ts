/**
 * Stub de `cloudflare:workers` para a suíte, que roda em Node.
 *
 * O módulo só é importado por `src/usage.ts`, e só pela CLASSE BASE do Durable
 * Object. Sem isto, importar `src/index.ts` (o que `surface-lock.test.ts` faz,
 * para medir a borda HTTP) quebra na resolução do módulo antes de qualquer
 * teste rodar. Ele torna o ENTRYPOINT importável, não o runtime da Cloudflare
 * disponível: teste que precise de Durable Object, KV ou Analytics Engine de
 * verdade não cabe aqui.
 */
export class DurableObject<E = unknown> {
  constructor(
    readonly ctx: unknown,
    readonly env: E,
  ) {}
}
