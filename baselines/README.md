# Baselines de superfície

Dumps NORMALIZADOS de `tools/list` + resources + prompts, gerados por
`node scripts/dump-surface.mjs` (chaves ordenadas recursivamente, tools por
name / resources por uri / prompts por name, versão do servidor omitida de
propósito — mudaria a cada release e sujaria todo diff). Prática transplantada
do bcb-br-mcp, onde o dump revelou que stdio e worker haviam divergido de
verdade (contrato HTTP sem `minItems`, resources com nomes diferentes,
descrições 12× menores em produção). Nenhum teste unitário pega essa classe.

| Arquivo | Como foi capturado | O que representa |
|:--|:--|:--|
| `surface-stdio-0.4.0.json` | `--stdio` sobre `dist/cli.js` do fonte atual | o que o canal npm (`ilo-mcp-server`) publica |
| `surface-http-prod-0.4.0.json` | `--url https://ilo.sidneybissoli.com/mcp` | o que o endpoint hospedado serve DE FATO |

## Medição da captura inicial (2026-09-01)

**As duas superfícies são IDÊNTICAS byte a byte** — 4 tools, 3 resources,
3 prompts, mesmo `serverName`. Não é sorte: o stdio (`src/cli.ts`) roda o
MESMO `buildServer` de `src/server.ts` que o Worker usa, então os dois canais
partilham a superfície por construção. Nota da captura: o fonte estava em
0.4.0 (não lançada) e ainda assim bateu com produção — a diferença da 0.4.0
não toca a superfície. As divergências possíveis aqui são de DEPLOY (fonte à
frente da produção), não de definição dupla como era no bcb pré-fundação —
por isso o script não tem modo `--source`.

## Como usar no gate

Depois de qualquer mudança que possa mexer na superfície:

```bash
npm run build
node scripts/dump-surface.mjs --stdio > depois.json
# diff contra o baseline vigente (surface-stdio-0.4.0.json)
```

Toda diferença precisa ser deliberada e listada no CHANGELOG. Depois de um
deploy, recapturar `--url` e conferir que voltou a bater com o stdio (a
propagação da Cloudflare serve isolates mistos por alguns segundos — se
divergir logo após o deploy, re-sondar antes de concluir deriva).
