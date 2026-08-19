# Estatísticas do Trabalho da OIT (ILOSTAT) — MCP Server

![MCP](https://img.shields.io/badge/MCP-Streamable%20HTTP-1f6feb)
[![CI](https://github.com/SidneyBissoli/ilo-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/SidneyBissoli/ilo-mcp-server/actions/workflows/ci.yml)
[![Version](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Filo.sidneybissoli.com%2Fstatus&query=%24.version&label=version&color=1f6feb)](https://ilo.sidneybissoli.com/status)
[![Tools](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Filo.sidneybissoli.com%2Fstatus&query=%24.tools&label=tools&color=2ea44f)](https://ilo.sidneybissoli.com/status)
[![Resources](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Filo.sidneybissoli.com%2Fstatus&query=%24.resources&label=resources&color=2ea44f)](https://ilo.sidneybissoli.com/status)
[![Prompts](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Filo.sidneybissoli.com%2Fstatus&query=%24.prompts&label=prompts&color=2ea44f)](https://ilo.sidneybissoli.com/status)
[![npm](https://img.shields.io/npm/v/ilo-mcp-server?label=npm&color=cb3837)](https://www.npmjs.com/package/ilo-mcp-server)
[![MCP Registry](https://img.shields.io/badge/MCP%20Registry-listed-blue)](https://registry.modelcontextprotocol.io/v0.1/servers/io.github.SidneyBissoli%2Filo-mcp-server/versions)
[![ilo-mcp-server MCP server](https://glama.ai/mcp/servers/SidneyBissoli/ilo-mcp-server/badges/score.svg)](https://glama.ai/mcp/servers/SidneyBissoli/ilo-mcp-server)
[![smithery badge](https://smithery.ai/badge/sidneybissoli/ilo-mcp-server)](https://smithery.ai/servers/sidneybissoli/ilo-mcp-server)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow)](LICENSE.md)
[![Status](https://img.shields.io/website?url=https%3A%2F%2Filo.sidneybissoli.com%2Fhealth&up_message=online&down_message=offline&label=status)](https://ilo.sidneybissoli.com/status)

🇺🇸 [Read in English](README.md)

Servidor [MCP](https://modelcontextprotocol.io) **público, hospedado e provenance-first** para as
estatísticas da **Organização Internacional do Trabalho (OIT)** — a base **ILOSTAT** — **sem
instalação, sem conta, sem chave de API**. Aponte seu cliente MCP para o endpoint hospedado e
pergunte sobre desemprego, emprego, salários, jornada e outros indicadores de trabalho por país,
ano, sexo e idade. Roda em Cloudflare Workers via Streamable HTTP e consulta a API SDMX REST
oficial do ILOSTAT.

Toda resposta carrega um **bloco de proveniência** (URL da fonte, vintage dos dados, instante
real da extração, licença, citação da OIT) — números exatos com trilha de auditoria, não
palpites da base de treino.

## Use (hospedado — sem configuração)

Aponte qualquer cliente MCP para o endpoint Streamable HTTP:

```
https://ilo.sidneybissoli.com/mcp
```

Claude Desktop / Claude Code e outros clientes com suporte nativo a servidores remotos:

```json
{
  "mcpServers": {
    "ilostat": {
      "url": "https://ilo.sidneybissoli.com/mcp"
    }
  }
}
```

Para clientes que lançam servidores MCP como comando, use a ponte
[`mcp-remote`](https://www.npmjs.com/package/mcp-remote):

```json
{
  "mcpServers": {
    "ilostat": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://ilo.sidneybissoli.com/mcp"]
    }
  }
}
```

O hostname `ilo-mcp-server.sidneybissoli.workers.dev` também é servido, como secundário.

## Rodar localmente (stdio)

Prefere não passar suas consultas por um host de terceiros? O **mesmo servidor** também roda
como **processo stdio local**, falando direto com a API oficial do ILOSTAT — mesmas 4 tools, resources e
prompts, mesmos limites, mesmo bloco de proveniência, sem Cloudflare no caminho.

Sem instalação — o pacote está no npm ([`ilo-mcp-server`](https://www.npmjs.com/package/ilo-mcp-server), Node ≥ 20):

```json
{
  "mcpServers": {
    "ilostat": {
      "command": "npx",
      "args": ["-y", "ilo-mcp-server"]
    }
  }
}
```

Ou a partir do código-fonte:

```bash
git clone https://github.com/SidneyBissoli/ilo-mcp-server
cd ilo-mcp-server
npm install
npm run build
node dist/cli.js   # serve MCP via stdio (Ctrl+C para parar)
```

(e aponte o cliente para `node /caminho/para/ilo-mcp-server/dist/cli.js`).

Diferenças em relação ao servidor hospedado, todas por ausência dos bindings da Cloudflare: o
cache SDMX fica na memória do processo (estruturas e codelists são reaproveitadas dentro da
sessão, não entre sessões); o catálogo de busca é baixado do endpoint oficial na primeira busca
(o `retrieved_at` real dele é reportado na proveniência); sem métricas de uso, rate limit ou
autenticação. Logs vão para **stderr** — stdout carrega só o JSON-RPC. O `Dockerfile` do
repositório constrói este runtime (usado pelo registro Glama).

## Tools

| Tool | O que faz | Fonte |
|---|---|---|
| `ilo_search_indicators` | busca ~1.210 dataflows por palavra-chave (paginação por `offset`) | catálogo local (sem chamada à fonte) |
| `ilo_get_indicator_metadata` | dimensões, codelists, vintage e seleção padrão de um dataflow | estrutura em cache (miss → fonte) |
| `ilo_list_dimension_values` | códigos válidos de uma dimensão (paginação por `offset`) | codelist em cache (miss → fonte) |
| `ilo_get_data` | observações filtradas por dimensão e período | 1 chamada REST ao vivo por consulta |

Fluxo típico: `ilo_search_indicators` → `ilo_get_indicator_metadata` / `ilo_list_dimension_values`
para descobrir os códigos válidos de filtro → `ilo_get_data` com filtros de país e período.

Toda resposta carrega o **bloco de proveniência v1.0**
([`@sbissoli/mcp-provenance`](https://www.npmjs.com/package/@sbissoli/mcp-provenance), modos
`concise`/`detailed` via parâmetro `provenance_mode`) em três canais: `structuredContent`,
`_meta` com namespace (`com.sidneybissoli.ilostat/*`) e rodapé de texto.

## Resources e prompts

Três **resources** (estáticas, `text/markdown`, sem chamada à fonte) que o cliente pode anexar ao
contexto antes de chamar tools — poupam as 2–3 chamadas de descoberta ("qual dataflow, quais
códigos") que a maioria das sessões gasta:

| URI | Conteúdo |
|---|---|
| `ilostat://guide` | fluxo das tools, convenções estáveis de códigos (`REF_AREA` ISO3 + agregados `X`, `SEX`, `AGE`, `FREQ`, sufixos dos ids de dataflow), limites, regras de citação |
| `ilostat://reference/key-dataflows` | ids de dataflow verificados, por tema (desemprego, emprego, participação, salários, horas, informalidade, NEET, ODS 8, produtividade) |
| `ilostat://reference/provenance` | significado de cada campo de proveniência e como citar a OIT |

Três **prompts** — workflows prontos que encadeiam as tools e terminam nas regras de citação
(argumentos são strings; os de período são opcionais):

| Prompt | Argumentos | Resultado |
|---|---|---|
| `ilo_country_labour_profile` | `country`, `start_period`, `end_period` | perfil do mercado de trabalho de um país (desemprego, participação, razão emprego/população, informalidade, NEET, rendimentos, horas) |
| `ilo_compare_countries` | `countries`, `indicator`, `start_period`, `end_period` | tabela comparativa entre países/agregados numa única chamada de dados, sinalizando estimativas modeladas vs. dados reportados |
| `ilo_indicator_trend` | `indicator`, `country`, `start_period`, `end_period` | série temporal de um indicador com primeiro/último valor, pico/vale e quebras (`OBS_STATUS`) |

Todo id de dataflow citado nas resources e prompts é conferido contra o seed do catálogo pela
suíte de testes — a documentação nunca aponta para um id que a busca não encontraria.

## Comportamento e limites

- **`REF_AREA` é obrigatório em `ilo_get_data`, até 30 áreas por chamada.** O gateway da OIT
  expira (HTTP 504) em consultas irrestritas, então o servidor nunca emite uma; para painéis
  amplos, divida as áreas em lotes e/ou pagine por período (`start_period`/`end_period`). A
  mensagem de erro explica como.
- **Uma chamada REST ao vivo por consulta de dados.** Dados nunca são cacheados — todo resultado
  de `ilo_get_data` é buscado no ILOSTAT no momento da requisição. Estruturas de dataflow (TTL
  24 h) e codelists (TTL 7 dias, compartilhadas entre dataflows) ficam em cache.
- **`data_vintage`** é a data da última atualização do dataflow publicada pela OIT (annotation
  `LAST_UPDATE`, normalizada para ISO).
- **`retrieved_at` é sempre o instante real da extração no ILOSTAT**, preservado junto a
  qualquer valor cacheado — nunca o momento do build ou da resposta. Respostas vindas de cache
  dizem isso (`served_from_cache: true`).
- **O catálogo de indicadores é um snapshot local** (~1.210 dataflows), atualizado
  periodicamente; o `retrieved_at` dele é reportado na proveniência de `ilo_search_indicators`,
  então a idade do catálogo é sempre visível.
- **Toda chamada à fonte leva um User-Agent identificável** (URL do serviço + contato), para que
  os administradores da OIT consigam chegar ao operador.
- **Idioma: inglês; fuso: UTC** (os dados da OIT são publicados em inglês).

### Campos de proveniência

- **`derived`** — `true` só para transformação real (agregação, taxa calculada pelo servidor,
  interpolação, harmonização), sempre com `derivation_note`; conversão de unidade e
  arredondamento não contam. Este servidor não transforma valores, então `derived` é sempre
  `false`.
- **`notices`** — reproduz os valores de `OBS_STATUS` (canal de status/ressalva do SDMX, ex.:
  "Break in series"), verbatim e com contagem. Atributos técnicos por observação (`DECIMALS`
  etc.) permanecem nas linhas (`rows[].attributes`).

## Licença dos dados e atribuição

- Dados e metadados do ILOSTAT: **CC BY 4.0** (desde 03/05/2023; licença verificada em
  04/08/2026).
- Atribuição à OIT em toda resposta (campo `citation`):
  `International Labour Organization, ILOSTAT, https://ilostat.ilo.org/data/, accessed <data>.`
- O logo da OIT não é usado. Este serviço não é endossado pela OIT.

## Self-hosting / desenvolvimento

Tudo abaixo só é necessário para rodar a sua própria instância — **não** é preciso para usar o
servidor público.

```bash
npm install
npm run typecheck && npm test   # 96 testes offline (parsers, chave, tools, contrato de saída, resources/prompts, catálogo em memória, fixtures de evals)
npm run dev                     # http://localhost:8787/mcp (Worker)
npm run build && npm start      # runtime stdio (dist/cli.js)

# Seed do catálogo (D1) — necessário antes do primeiro uso:
node scripts/seed-catalog.mjs   # baixa via curl e gera scripts/seed-catalog.sql
npx wrangler d1 execute ilostat-catalog --local  --file=scripts/seed-catalog.sql
npx wrangler d1 execute ilostat-catalog --remote --file=scripts/seed-catalog.sql

npm run deploy
node scripts/smoke-mcp.mjs      # smoke test contra a produção (initialize → 4 tools → erros)
npm run manifest:lhm            # regenera tools/resources/prompts do lhm.plugin.json a partir do servidor real
# (o seed também grava tests/fixtures/catalog-ids.txt — a lista de ids versionada contra a qual os testes conferem resources/prompts)
```

Bindings (ver `wrangler.jsonc`): KV `SDMX_CACHE`, D1 `CATALOG_DB`, Durable Object `USAGE`
(contadores de uso em SQLite), `CF_VERSION_METADATA`. Autenticação Bearer opcional
(`wrangler secret put API_KEY`); rate limit token-bucket por IP.

Notas para operadores:

- O ILOSTAT devolve JSON só quando negociado via header `Accept`
  (`application/vnd.sdmx.{structure,data}+json`); `?format=` é ignorado e devolve XML.
- O gateway da OIT responde HTTP 500 (`languageTag1`) ao header `Accept-Language: *` que o
  `fetch` do Node (undici) envia por padrão; por isso toda chamada à fonte define
  `Accept-Language: en` explicitamente (o runtime da Cloudflare não envia esse header, então o
  Worker nunca foi afetado). Ele também espera um User-Agent identificável.
- **Atualização do catálogo** é manual (sem cron): trimestral, ou imediata se um dataflow que
  existe na fonte não aparecer na busca. Procedimento: os três comandos de seed acima. Consultas
  de dados são sempre ao vivo, então só o catálogo de busca pode envelhecer — e a idade dele é
  exposta na proveniência.

## Evals

[`@sbissoli/mcp-evals`](https://www.npmjs.com/package/@sbissoli/mcp-evals): 24 fixtures em
`evals/fixtures/queries.ts`, validadas offline em `npm test`. A rodada com modelo real
(`npm run eval`) usa a API da Anthropic e exige `ANTHROPIC_API_KEY` (sem a chave, sai com
instruções). Rodada de 07/08/2026: **top-1 100% (24/24)** — `evals/results/`.

**End-to-end**: 10 perguntas complexas com resposta única verificável em
`evals/e2e/evaluation.xml`, respostas validadas manualmente contra a produção
(`evals/e2e/validacao-respostas.md`). Rodada de 07/08/2026 (Sonnet): **9/10 string exata;
10/10 substantivo** — `evals/results/2026-08-07-e2e.md`.

## Endpoints

| Rota | Finalidade |
|---|---|
| `/` | landing page (identidade do serviço + contato — pública) |
| `/health` | liveness |
| `/status` | versão, contagens/nomes de tools, resources e prompts, versão do contrato de proveniência, deploy corrente (alimenta os badges do README) |
| `/metrics` | uso agregado (só o endpoint MCP; sem IPs, sem conteúdo de consulta) |
| `/mcp` | MCP Streamable HTTP |

## Segurança

Snyk Agent Scan (07/08/2026): **aprovado** — relatório em
[`security/`](security/2026-08-07-snyk-agent-scan.md).

## Licença

Código: [MIT](LICENSE.md). Dados: ILOSTAT, CC BY 4.0 (ver "Licença dos dados e atribuição" acima).

## Privacidade

Política de privacidade do serviço hospedado: [PRIVACY.md](PRIVACY.md).

## Contato

Sidney da S. P. Bissoli — sbissoli76@gmail.com. Este serviço não é endossado pela OIT.
