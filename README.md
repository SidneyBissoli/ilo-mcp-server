# ilo-mcp-server — servidor MCP provenance-first do ILOSTAT

Servidor [MCP](https://modelcontextprotocol.io) (Streamable HTTP) para o **ILOSTAT**,
a base estatística da Organização Internacional do Trabalho, hospedado em Cloudflare
Workers. Projeto ilostat (`C:\dev\mcp\ilostat\roadmap.md`), instanciado do template
da Fase 0 do portfólio (`mcp-br-commons/templates/cloudflare-worker`). A fonte UNESCO
UIS vive no servidor irmão **`uis-mcp-server`** (decisão do decisor, 07/08/2026: um
servidor por fonte — segregação estrutural CC BY / CC BY-SA e convenção de naming do
mcp-builder; tools com prefixo de serviço `ilo_`).

Produção: **`https://ilostat.sidneybissoli.com`** (endpoint MCP em `/mcp`; padrão de
URLs do portfólio). O hostname `ilostat-mcp.sidneybissoli.workers.dev` permanece
servido como secundário.

## Tools

| Tool | O quê | Fonte |
|---|---|---|
| `ilo_search_indicators` | busca ~1.210 dataflows por palavra-chave (paginação por `offset`) | catálogo em D1 (100% local) |
| `ilo_get_indicator_metadata` | dimensões, codelists, vintage, defaults de um dataflow | estrutura em KV (miss → upstream) |
| `ilo_list_dimension_values` | códigos válidos de uma dimensão (paginação por `offset`) | codelist em KV (miss → upstream) |
| `ilo_get_data` | observações com filtros por dimensão e período | 1 chamada REST por consulta |

Toda resposta carrega o **bloco de proveniência v1.0** (`@sbissoli/mcp-provenance`,
modos `concise`/`detailed` via parâmetro `provenance_mode`) nos três canais do
contrato: `structuredContent`, `_meta` namespaced (`com.sidneybissoli.ilostat/*`) e
rodapé de texto.

## Decisões vinculantes (spike Sessão 04 + decisor, 07/08/2026)

- **JSON só via header `Accept`** (`application/vnd.sdmx.{structure,data}+json`) —
  `?format=` é ignorado pelo endpoint e devolve XML.
- **Nunca emitir consulta irrestrita** (`/all` → HTTP 504 do gateway em ~61 s).
  `REF_AREA` é obrigatório em `ilo_get_data`, com **teto de 30 áreas por chamada** e erro
  pedagógico pedindo lotes/paginação por período. Sem fatiamento server-side no MVP;
  reavaliar pós-lançamento com dados do UsageTracker.
- **Codelists cacheadas POR CODELIST** (`codelist:ILO:CL_AREA:1.0`, TTL 7 dias) —
  `CL_MEASURE`/`CL_AREA` são compartilhadas entre dataflows (~90% de economia de KV).
  Estrutura de dataflow em KV com TTL 24 h (é a fonte do `data_vintage`).
- **`data_vintage`** = annotation `LAST_UPDATE` do dataflow (`dd/MM/yyyy` → ISO),
  servido da estrutura cacheada — consulta típica permanece **1 chamada REST**.
- **Catálogo em D1**, seed via `scripts/seed-catalog.mjs`; o `retrieved_at` do seed é
  gravado em `catalog_meta` e reportado na proveniência de `ilo_search_indicators`
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

## Obrigações de licença (docs/02 do projeto)

- ILOSTAT: **CC BY 4.0** (dados/metadados desde 03/05/2023; `verified_at` 2026-08-04).
- Atribuição ILO em toda resposta (campo `citation`):
  `International Labour Organization, ILOSTAT, https://ilostat.ilo.org/data/, accessed <data>.`
- **Não** usar o logo da OIT. Landing declara "not endorsed by the ILO".
- Dados UIS (CC BY-SA) vivem no servidor irmão `uis-mcp-server` — segregação
  estrutural: os dois regimes nunca coabitam um servidor.

## Desenvolvimento

```bash
npm install
npm run typecheck && npm test   # 62 testes offline (parsers, chave, tools, evals-fixtures)
npm run dev                     # http://localhost:8787/mcp

# Seed do catálogo (D1) — necessário antes do primeiro uso:
node scripts/seed-catalog.mjs   # baixa via curl e gera scripts/seed-catalog.sql
npx wrangler d1 execute ilostat-catalog --local  --file=scripts/seed-catalog.sql
npx wrangler d1 execute ilostat-catalog --remote --file=scripts/seed-catalog.sql

npm run deploy
node scripts/smoke-mcp.mjs      # smoke do MCP em produção (initialize → 4 tools → erros)
```

## Evals

`@sbissoli/mcp-evals`: 24 fixtures próprias em `evals/fixtures/queries.ts`, validadas
offline em `npm test`. A rodada com modelo real (`npm run eval`) **custa API** — só
com decisão explícita (`ANTHROPIC_API_KEY`; sem a chave, sai 0 com instruções).

## Rotas

`/` landing · `/health` liveness · `/status` versão+deploy · `/metrics` uso agregado ·
`/mcp` MCP Streamable HTTP. Auth Bearer opcional (`wrangler secret put API_KEY`);
rate limit token-bucket por IP.
