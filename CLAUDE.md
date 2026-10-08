# CLAUDE.md

Orientação para o Claude Code neste repositório. O histórico por versão está no
`CHANGELOG.md`, desde a 0.3.0 (a primeira no npm; o anterior à 1.4.0 foi reconstruído em
08/10/2026 a partir de tags, releases, commits e datas do npm). O planejamento fica no
`ROADMAP.md` (gitignored, cópia em `portfolio-monitor/roadmaps-fonte/ilo-tecnico.md`).

## O que é

Servidor MCP das estatísticas de trabalho da OIT (ILOSTAT), pela API SDMX REST oficial
(`https://sdmx.ilo.org/rest`). Publicado no npm como `ilo-mcp-server` (runtime stdio,
`dist/cli.js`) e hospedado como Cloudflare Worker em `https://ilo.sidneybissoli.com/mcp`
(Streamable HTTP, stateless). Os dois runtimes servem o MESMO `buildServer`
(`src/server.ts`): mesmas tools, validações, limites e bloco de proveniência
(`src/cli.ts`, cabeçalho).

Superfície (travada em `surface.lock.json`, `declarada` desde a 1.4.0): seis tools —
`ilo_search_indicators`, `ilo_get_data`, `ilo_get_indicator_metadata`,
`ilo_list_dimension_values` e o par Deep Research `search`/`fetch` —, 3 resources e
3 prompts. Idioma do servidor: inglês (persona internacional; a OIT publica em inglês);
fuso UTC (`src/config.ts`). Dependências de runtime: `@modelcontextprotocol/server`
(SDK v2), `@sbissoli/mcp-provenance`, `@sbissoli/mcp-search`, `@sbissoli/mcp-upstream`,
`zod`.

## Comandos

```bash
npm run build          # tsc -p tsconfig.build.json → dist/
npm start              # node dist/cli.js (stdio)
npm test               # vitest run (tests/**/*.test.ts)
npm run typecheck      # tsc --noEmit
npm run dev            # wrangler dev (Worker local)
npm run deploy         # wrangler deploy (o CI faz isto; ver CI)
npm run surface:lock   # regrava a trava e o bloco do server.json (ver Trava)
npm run seed:sql       # node scripts/seed-catalog.mjs → scripts/seed-catalog.sql
npm run manifest:lhm   # regenera lhm.plugin.json (LobeHub)
npm run eval           # eval com MODELO REAL — CUSTA DINHEIRO (ver abaixo)

node scripts/smoke-mcp.mjs [base-url]       # smoke do endpoint em produção
node scripts/dump-surface.mjs --stdio       # dump da superfície (baselines/)
```

`npm run eval` (`evals/run.ts`) cobra a API da Anthropic à parte de qualquer
assinatura: nunca rodar com `ANTHROPIC_API_KEY` sem decisão explícita do dono; sem a
chave, imprime instruções e sai (cabeçalho de `evals/run.ts`).

Seed do catálogo no D1, antes do primeiro uso (README, "Catalogue seed"):
`node scripts/seed-catalog.mjs` e depois
`npx wrangler d1 execute ilostat-catalog --remote --file=scripts/seed-catalog.sql`
(`--local` para o dev).

O `package.json` é minificado, numa linha só. Manter assim ao editar.

## Arquitetura

| Caminho | O quê |
|:--|:--|
| `src/index.ts` | Entrada do Worker: rotas públicas (landing, `/health`, `/status`, `/metrics`, server card) → Bearer opcional → rate limit → `createMcpHandler` (factory cria um `McpServer` por request) |
| `src/cli.ts` | Entrada stdio: o mesmo servidor, sem bindings — cache SDMX em `Map` com TTL, catálogo em memória, sem uso/rate limit/auth; logs em stderr |
| `src/server.ts` | `buildServer`: anotações obrigatórias, envelope de proveniência v1.1 em todo retorno, instrumentação de uso fora do caminho crítico |
| `src/config.ts` | Identidade e tunáveis; o site é declarado em `server.json`, `package.json` e `serverInfo.websiteUrl` e preso por `tests/serverinfo-sync.test.ts` |
| `src/tools/` | Um módulo por grupo (`catalog`, `data`, `metadata`, `deep-research`) + `shared`, `errors` |
| `src/resources.ts`, `src/prompts.ts` | Documentação de referência e workflows, offline e sem estado |
| `src/ilostat/sdmx.ts` | Cliente SDMX com cache KV (`SDMX_CACHE`) |
| `src/ilostat/upstream.ts` | Ponto único de rede: fetch comum do portfólio (`@sbissoli/mcp-upstream`), coletor do `retrieval` |
| `src/ilostat/catalog.ts` / `src/ilostat/catalog-memory.ts` | Busca de indicadores no D1 (`CATALOG_DB`, Worker) ou em memória (stdio) — mesma semântica |
| `src/ilostat/key.ts` | Montagem e validação da chave SDMX |
| `src/ilostat/structure.ts`, `src/ilostat/parser.ts` | Estrutura do dataflow e parser SDMX-JSON → tabela |
| `src/ilostat/vocabulary.ts` | Vocabulário da pergunta × da fonte (inglês americano → britânico da OIT) |
| `src/ilostat/provenance.ts` | Contexto de proveniência ILOSTAT (CC BY 4.0, atribuição obrigatória) |
| `src/origin.ts` | Validação de `Origin` (DNS rebinding → 403) |
| `src/pagination.ts`, `src/discover.ts` | Cursor inválido → -32602; `server/discover` |
| `src/usage*.ts`, `src/analytics.ts`, `src/call-shape.ts` | Uso (Durable Object `USAGE`), Analytics Engine (`ilo_mcp_tool_calls`), forma da chamada e classe do erro |

Bindings em `wrangler.jsonc`: KV `SDMX_CACHE`, D1 `CATALOG_DB` (`ilostat-catalog`),
Durable Object `USAGE` (`UsageTracker`), Analytics Engine `ANALYTICS`, rota
`ilo.sidneybissoli.com` (custom domain). O `Dockerfile` não é deploy: serve ao Glama,
que roda o stdio por trás do `mcp-proxy` (cabeçalho do `Dockerfile`).

## Testes

`npm test` roda `tests/**/*.test.ts`. O `vitest.config.ts` aponta
`cloudflare:workers` para `tests/stub-cloudflare-workers.ts`, para importar o entrypoint
em Node. Os que vale conhecer:

- `tests/surface-lock.test.ts` — a trava da superfície (seção seguinte).
- `tests/output-contract.test.ts` — o `structuredContent` contra o `outputSchema`
  LISTADO, pelo `Client` do SDK (`@sbissoli/mcp-surface/cliente`).
- `tests/classe-do-erro.test.ts`, `tests/deep-research-classe.test.ts`,
  `tests/sem-iserror-literal.test.ts` — a classe do erro sai do tipo da falha.
- `tests/contagem-nos-textos.test.ts` — números nos textos públicos e **paridade de
  seções entre `README.md` e `LEIA-ME.md`**: seção nova num, seção nova no outro.
- `tests/serverinfo-sync.test.ts`, `tests/icon-sync.test.ts`, `tests/lhm-manifest.test.ts`,
  `tests/pacote-npm-readme.test.ts` — o que é declarado em vários lugares não discorda.
- `tests/key-dataflows-contract.integration.test.ts` — LIVE contra a OIT; só roda com
  `INTEGRATION_TESTS=1` (workflow `integration.yml`).

## Trava da superfície e impressão digital no registro

**Mudou a superfície sem subir a versão = build vermelho e deploy recusado.**
`surface.lock.json` tem duas seções, cada uma com a versão em que foi travada e o sha256
(`tests/surface-lock.test.ts`, cabeçalho):

- `declarada` — `initialize` (instructions, capabilities, identidade sem a versão) +
  tools/resources/templates/prompts do `buildServer`;
- `semToken` — quais métodos respondem sem credencial em `/mcp` e na rota privada do
  dono, com `API_KEY` ausente (produção) e presente.

**Desde a 1.4.2** o `server.json` publica a impressão digital no MCP Registry, sob
`_meta["io.modelcontextprotocol.registry/publisher-provided"]["io.github.sidneybissoli/mcp-surface"]`
(forma `mcp-surface/1`, SPEC.md do `@sbissoli/mcp-surface`), com a sonda
`ilo_search_indicators {"query":"unemployment"}`. O `surface:lock` roda o `travar` e
depois o `mcp-surface registro`, que grava o bloco. O teste confere que o `server.json`
publica o que a trava produz, e é **pulado em modo de escrita** (`skipIf(modoEscrita())`),
porque o `registro` roda depois do `travar`.

Fluxo de quem muda a superfície: `npm version <nível> --no-git-tag-version` →
`npm run surface:lock` → commitar `surface.lock.json` e `server.json` juntos. A trava
recusa superfície nova sob a versão antiga.

## CI (`.github/workflows/`)

- `ci.yml` — push em `main` e PR; Node 22 e 24: `npm ci`, typecheck, testes, build, dump
  da superfície.
- `deploy-worker.yml` — push em `main` com caminho de `src/`, `package*.json`,
  `wrangler.jsonc` ou `surface.lock.json`: testes (incluem a trava) ANTES do wrangler →
  deploy → `/status` bate com o `package.json` (repete por até 3 min) → smoke em produção
  → `npx mcp-surface verificar` (o ar = a trava).
- `publish.yml` — push de tag `v*` (ou dispatch): preflight (versões do `package.json` e
  do `server.json` iguais) → npm com trusted publishing → MCP Registry (OIDC) →
  `mcp-surface conferir-registro` (a entrada da versão no registro × o ar, como um
  cliente, sem ler a trava). **Não cria a release do GitHub.**
- `mcpscore.yml` — catraca de conformidade: stdio no PR, produção depois do deploy e
  semanal.
- `integration.yml` (segunda 08:00 UTC) + `integration-retry.yml` (re-roda o que falhou
  num runner novo) — o contrato dos dataflows-chave contra a OIT ao vivo.

## Release

1. Conferir a versão PUBLICADA: `npm view ilo-mcp-server version` (não o `package.json`).
2. Entrada nova no `CHANGELOG.md`, cobrindo tudo desde a última publicada.
3. `npm version <patch|minor> --no-git-tag-version`. O hook `version`
   (`scripts/sync-version.mjs && git add -u`) espelha a versão em `server.json` (raiz e
   `packages[0]`), `src/config.ts` e `lhm.plugin.json`, e os estagia.
4. PR → merge em `main` → **`gh release create v<versão> --target main --generate-notes`**.
   Ele cria a tag pela API, e o push da tag dispara o `publish.yml`. **Nunca empurrar a
   tag sozinha**: o `publish.yml` não cria a release do GitHub, e a versão fica sem
   página. Aconteceu com a 1.4.2 em 07/10/2026; o conserto, sem republicar, é
   `gh release create v<x> --verify-tag --generate-notes`.

O deploy do Worker não depende da release: sai no push em `main`.

## Pontos que mordem

- **Nunca consulta irrestrita (`/all`)**: a OIT responde 504 depois de ~61 s. `REF_AREA` é
  obrigatório, com teto de 30 áreas por chamada e erro pedagógico (`src/ilostat/key.ts`,
  decisão de 07/08/2026).
- **JSON só pelo header `Accept`**: `?format=` é ignorado e devolve SDMX-ML (XML)
  (`src/ilostat/sdmx.ts`, regras do spike).
- **`retrieved_at` de cache é o instante REAL do fetch original**, guardado junto ao valor
  (`src/ilostat/sdmx.ts`); o do catálogo é o instante do seed (`scripts/seed-catalog.mjs`).
- **Unidade e escala vêm em atributos de SÉRIE com índice `null` no JSON**
  (`UNIT_MEASURE_TYPE`, `UNIT_MEASURE`, `UNIT_MULT`): só se resolvem quando o valor é
  determinado pela própria mensagem; fora disso ficam de fora, sem chute. Sem isso,
  `ilo_get_data` devolvia 101884.813 sem dizer que eram milhares (`src/ilostat/parser.ts`,
  04/10/2026, release 1.3.0).
- **A palavra do usuário não é a da OIT**: "wages"/"salary" dão 0 resultados, "earnings"
  dá 107; "gender" dá 2, "sex" dá 1.131 (medido em 13/09/2026 em 1.212 dataflows,
  `src/ilostat/vocabulary.ts`). A busca casa substrings em AND, então palavra errada dá
  ZERO, não resultado ruim.
- **O catálogo do stdio depende de `/dataflow/ILO?detail=allstubs`**, que respondeu HTTP 500
  determinístico em 27/09/2026 (falha da OIT) e voltou em 04/10/2026. O Worker lê do D1 e
  não é afetado. `integration.yml` busca a mesma URL toda semana (ROADMAP, "Catálogo do
  stdio…").
- **`derived` é sempre `false`**: conversão de unidade e arredondamento não contam como
  derivação (`src/ilostat/provenance.ts`, decisão de 07/08/2026).
- **`npm install` no Windows apaga os campos `libc` do `package-lock.json`**, e o `npm ci`
  do CI (Linux) deixaria de achar os binários opcionais. Depois de mexer no lock:
  `node C:\dev\skills\scripts\restore-libc.mjs <lock-do-HEAD> package-lock.json`.
- **README e LEIA-ME andam juntos**: o teste de paridade reprova seção que exista só num
  dos dois.
