# ilostat-mcp — servidor MCP provenance-first (ILOSTAT + UNESCO UIS)

Servidor [MCP](https://modelcontextprotocol.io) (Streamable HTTP) para **duas fontes
estatísticas oficiais**: o **ILOSTAT** (base estatística da Organização Internacional
do Trabalho) e o **UNESCO UIS** (Instituto de Estatística da UNESCO — educação,
ciência, cultura e comunicação), hospedado em Cloudflare Workers. Fases 1–2 do
projeto ilostat (`C:\dev\mcp\ilostat\roadmap.md`), instanciado do template da Fase 0
do portfólio (`mcp-br-commons/templates/cloudflare-worker`).

Produção: **`https://ilostat.sidneybissoli.com`** (endpoint MCP em `/mcp`; padrão de
URLs do portfólio). O hostname `ilostat-mcp.sidneybissoli.workers.dev` permanece
servido como secundário.

## Tools

ILOSTAT (docs/01 do projeto, Fase 1):

| Tool | O quê | Fonte |
|---|---|---|
| `search_indicators` | busca ~1.210 dataflows por palavra-chave | catálogo em D1 (100% local) |
| `get_indicator_metadata` | dimensões, codelists, vintage, defaults de um dataflow | estrutura em KV (miss → upstream) |
| `list_dimension_values` | códigos válidos de uma dimensão | codelist em KV (miss → upstream) |
| `get_data` | observações com filtros por dimensão e período | 1 chamada REST por consulta |

UNESCO UIS (Fase 2 — tools separadas por exigência de segregação de licenças):

| Tool | O quê | Fonte |
|---|---|---|
| `uis_search_indicators` | busca ~5.060 indicadores (4 temas), com disponibilidade de dados | catálogo em D1 (100% local) |
| `uis_list_geo_units` | 462 códigos de país/região (NATIONAL/REGIONAL) | D1 (100% local) |
| `uis_get_data` | registros por indicador/geo unit/anos, footnotes opcionais | 1 chamada à Data API por consulta (release fixada) |

Toda resposta carrega o **bloco de proveniência v1.0** (`@sbissoli/mcp-provenance`,
modos `concise`/`detailed` via parâmetro `provenance_mode`) nos três canais do
contrato: `structuredContent`, `_meta` namespaced (`com.sidneybissoli.ilostat/*`) e
rodapé de texto — **um bloco por fonte**: tools `uis_*` emitem exclusivamente
proveniência UIS (CC BY-SA), as demais exclusivamente ILOSTAT (CC BY).

## Decisões vinculantes (spike Sessão 04 + decisor, 07/08/2026)

- **JSON só via header `Accept`** (`application/vnd.sdmx.{structure,data}+json`) —
  `?format=` é ignorado pelo endpoint e devolve XML.
- **Nunca emitir consulta irrestrita** (`/all` → HTTP 504 do gateway em ~61 s).
  `REF_AREA` é obrigatório em `get_data`, com **teto de 30 áreas por chamada** e erro
  pedagógico pedindo lotes/paginação por período. Sem fatiamento server-side no MVP;
  reavaliar pós-lançamento com dados do UsageTracker.
- **Codelists cacheadas POR CODELIST** (`codelist:ILO:CL_AREA:1.0`, TTL 7 dias) —
  `CL_MEASURE`/`CL_AREA` são compartilhadas entre dataflows (~90% de economia de KV).
  Estrutura de dataflow em KV com TTL 24 h (é a fonte do `data_vintage`).
- **`data_vintage`** = annotation `LAST_UPDATE` do dataflow (`dd/MM/yyyy` → ISO),
  servido da estrutura cacheada — consulta típica permanece **1 chamada REST**.
- **Catálogo em D1**, seed via `scripts/seed-catalog.mjs`; o `retrieved_at` do seed é
  gravado em `catalog_meta` e reportado na proveniência de `search_indicators`
  (`served_from_cache: true`).
- **`retrieved_at` é sempre o instante REAL da extração no upstream**, preservado
  junto ao valor cacheado — nunca o momento do build ou da resposta.
- **User-Agent identificável** em toda chamada upstream (o gateway da OIT responde
  500 a clientes sem UA reconhecível; o fetch do Node/undici é rejeitado mesmo com UA
  — o seed usa `curl`).
- **Idioma do servidor: inglês; fuso: UTC** (persona internacional; dados da OIT são
  publicados em inglês).

### Regra de `derived` (caso de fronteira — decisão do decisor, 07/08/2026)

Conversão de unidade e arredondamento **não** contam como derivação: `derived=false`
com nota documentando a conversão. `derived=true` fica reservado a **transformação
real** (agregação, taxa calculada pelo servidor, interpolação, harmonização), sempre
com `derivation_note`. Regra operativa: *valor com o mesmo significado = não derivado;
valor calculado = derivado.* O MVP não transforma nada — `derived` é sempre `false`.

### Notices

`notices` reproduz os valores de `OBS_STATUS` (canal de status/disclaimer do SDMX,
ex.: "Break in series"), verbatim com contagem. Atributos técnicos por observação
(`DECIMALS` etc.) permanecem nas linhas (`rows[].attributes`).

### Decisões da Fase 2 (UIS — mini-spike docs/06, 07/08/2026)

- **Release fixada em toda consulta de dados** (`version=` explícita, resolvida de
  `/versions/default` com cache KV TTL 24 h) — pinagem reprodutível + aproveitamento
  do cache CloudFront do upstream (keyed pela URL completa). A release é o
  `data_vintage` UIS (ex.: `20260507-91260335 (published 2026-05-08)`).
- **Catálogo UIS em D1** (mesma database, tabelas `uis_indicators`/`uis_geounits`/
  `uis_meta`), seed via `scripts/seed-uis-catalog.mjs` — a UIS aceita fetch do Node
  (sem a patologia do gateway da OIT).
- **Teto de 100k registros é do upstream** (HTTP 400 pedagógico com contagem exata —
  repassado ao cliente). Teto próprio de **5.000 registros por resposta** (proteção do
  contexto MCP): acima disso, erro pedagógico com a contagem real — **nunca truncar
  silenciosamente** (dado parcial apresentado como completo viola o contrato
  anti-alucinação). Máx. 25 indicadores/chamada. Reavaliar com uso real.
- **Notices UIS** = tipos de footnote + magnitude + qualifier com contagem; o texto
  integral de cada footnote fica na linha (`include_footnotes: true`).

## Obrigações de licença (docs/02 do projeto)

- ILOSTAT: **CC BY 4.0** (dados/metadados desde 03/05/2023; `verified_at` 2026-08-04).
- Atribuição ILO em toda resposta (campo `citation`):
  `International Labour Organization, ILOSTAT, https://ilostat.ilo.org/data/, accessed <data>.`
- **Não** usar o logo da OIT. Landing declara "not endorsed by the ILO".
- UIS: **CC BY-SA 4.0** (Terms do Data Browser, que governam a Data API; `verified_at`
  2026-08-04, confirmação manual 07/08/2026). Atribuição obrigatória com **URL completa
  + data de extração**:
  `Source: UNESCO Institute for Statistics (UIS), <URL>, date of extraction <data>.`
- **Segregação CC BY / CC BY-SA**: um bloco de proveniência por fonte; dados das duas
  fontes nunca compartilham a mesma estrutura de resposta (tools separadas).

## Desenvolvimento

```bash
npm install
npm run typecheck && npm test   # 71 testes offline (parsers, chave, tools ILO+UIS, evals-fixtures)
npm run dev                     # http://localhost:8787/mcp

# Seeds dos catálogos (D1) — necessários antes do primeiro uso:
node scripts/seed-catalog.mjs       # ILOSTAT: baixa via curl e gera scripts/seed-catalog.sql
node scripts/seed-uis-catalog.mjs   # UIS: baixa via fetch e gera scripts/seed-uis-catalog.sql
npx wrangler d1 execute ilostat-catalog --local  --file=scripts/seed-catalog.sql
npx wrangler d1 execute ilostat-catalog --remote --file=scripts/seed-catalog.sql
npx wrangler d1 execute ilostat-catalog --local  --file=scripts/seed-uis-catalog.sql
npx wrangler d1 execute ilostat-catalog --remote --file=scripts/seed-uis-catalog.sql

npm run deploy
node scripts/smoke-mcp.mjs      # smoke do MCP em produção (initialize → 4 tools → erros)
```

## Evals

`@sbissoli/mcp-evals`: 32 fixtures próprias em `evals/fixtures/queries.ts`, validadas
offline em `npm test`. A rodada com modelo real (`npm run eval`) **custa API** — só
com decisão explícita (`ANTHROPIC_API_KEY`; sem a chave, sai 0 com instruções).

## Rotas

`/` landing · `/health` liveness · `/status` versão+deploy · `/metrics` uso agregado ·
`/mcp` MCP Streamable HTTP. Auth Bearer opcional (`wrangler secret put API_KEY`);
rate limit token-bucket por IP.
