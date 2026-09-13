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
| `surface-stdio-0.5.0.json` | `--stdio` sobre `dist/cli.js` do fonte atual | o que o canal npm (`ilo-mcp-server`) publica |
| `surface-http-prod-0.5.0.json` | `--url https://ilo.sidneybissoli.com/mcp` | o que o endpoint hospedado serve DE FATO |
| `surface-{stdio,http-prod}-0.4.0.json` | idem, na 0.4.0 | baseline anterior — o diff 0.4.0 → 0.5.0 é exatamente `search` e `fetch` |

## Medição da captura inicial (2026-09-01)

**As duas superfícies são IDÊNTICAS byte a byte** — 4 tools, 3 resources,
3 prompts, mesmo `serverName`. Não é sorte: o stdio (`src/cli.ts`) roda o
MESMO `buildServer` de `src/server.ts` que o Worker usa, então os dois canais
partilham a superfície por construção. Nota da captura: o fonte estava em
0.4.0 (não lançada) e ainda assim bateu com produção — a diferença da 0.4.0
não toca a superfície. As divergências possíveis aqui são de DEPLOY (fonte à
frente da produção), não de definição dupla como era no bcb pré-fundação —
por isso o script não tem modo `--source`.

## Captura da 0.5.0 (2026-09-03)

`search` e `fetch` (contrato Deep Research do ChatGPT, `src/tools/deep-research.ts`)
entram: 4 → 6 tools. As 4 tools `ilo_*`, as 3 resources e os 3 prompts ficaram
byte a byte iguais ao baseline 0.4.0 (conferido por script antes do commit).
`scripts/smoke-mcp.mjs` deriva a contagem esperada do `surface-stdio-<v>.json`
mais recente — nunca de um literal.

## Captura da 0.6.0 (2026-09-13)

Seis tools, três resources e três prompts — a superfície não ganhou nem perdeu
membro. O diff estrutural contra a 0.5.0 (chaves ordenadas, ignorando fim de
linha) tem exatamente duas famílias:

1. **O que o master já levava e a 0.5.0 não publicou** (commits de 11/09):
   `additionalProperties: false` nos esquemas de entrada — chave desconhecida
   passa a ser RECUSADA — e `filters` com `REF_AREA` exigido no `required`, não
   só na prosa. É contrato de ENTRADA mais estrito viajando num bump; foi
   exatamente o que escapou no sih em 13/09 ([[tag-leva-o-master-inteiro]]), e
   por isso este é minor, não patch.
2. **O que a 0.6.0 acrescenta**: a descrição de `ilo_search_indicators` passa a
   dizer que traduz o vocabulário do usuário para o da OIT, e a saída ganha
   `vocabulary_notes` (a tradução que aconteceu) e `hint` (o que fazer quando o
   resultado é zero).

Nenhuma outra diferença. O baseline `surface-http-prod-0.6.0.json` só faz
sentido DEPOIS do deploy desta versão — capturar então, e conferir que volta a
bater com o stdio.

## Como usar no gate

Depois de qualquer mudança que possa mexer na superfície:

```bash
npm run build
node scripts/dump-surface.mjs --stdio > depois.json
# diff contra o baseline vigente (surface-stdio-0.6.0.json)
```

Toda diferença precisa ser deliberada e listada no CHANGELOG. Depois de um
deploy, recapturar `--url` e conferir que voltou a bater com o stdio (a
propagação da Cloudflare serve isolates mistos por alguns segundos — se
divergir logo após o deploy, re-sondar antes de concluir deriva).
