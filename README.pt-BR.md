# ILOSTAT MCP Server

![Cloudflare Workers](https://img.shields.io/badge/Cloudflare%20Workers-F38020?logo=cloudflare&logoColor=white)
![MCP](https://img.shields.io/badge/MCP-Streamable%20HTTP-1f6feb)
![Tools](https://img.shields.io/badge/tools-4-2ea44f)
![Provenance](https://img.shields.io/badge/provenance-v1.0-8250df)
[![ilo-mcp-server MCP server](https://glama.ai/mcp/servers/SidneyBissoli/ilo-mcp-server/badges/score.svg)](https://glama.ai/mcp/servers/SidneyBissoli/ilo-mcp-server)
[![GitHub stars](https://img.shields.io/github/stars/SidneyBissoli/ilo-mcp-server?style=flat&logo=github)](https://github.com/SidneyBissoli/ilo-mcp-server)
[![Status](https://img.shields.io/website?url=https%3A%2F%2Filo.sidneybissoli.com%2Fhealth&up_message=online&down_message=offline&label=status)](https://ilo.sidneybissoli.com/status)

🇺🇸 [Read in English](README.md)

Servidor [MCP](https://modelcontextprotocol.io) **público, hospedado e provenance-first** para o
**ILOSTAT**, a base estatística da Organização Internacional do Trabalho (OIT) — **sem
instalação, sem conta, sem chave de API**. Aponte seu cliente MCP para o endpoint hospedado e
pergunte sobre desemprego, emprego, salários, jornada e outros indicadores de trabalho por país,
ano, sexo e idade. Roda em Cloudflare Workers via Streamable HTTP e fala com a API SDMX REST
oficial do ILOSTAT.

Toda resposta carrega um **bloco de proveniência** (URL da fonte, vintage dos dados, instante
real da extração, licença, citação da OIT) — números exatos com trilha de auditoria, não
palpites da base de treino. As estatísticas da UNESCO UIS vivem no servidor irmão
[`uis-mcp-server`](https://github.com/SidneyBissoli/uis-mcp-server) (um servidor por fonte:
segregação estrutural entre dados CC BY e CC BY-SA).

## Use (hospedado — sem setup)

Aponte qualquer cliente MCP para o endpoint Streamable HTTP:

```
https://ilo.sidneybissoli.com/mcp
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

## Tools

| Tool | O quê | Fonte |
|---|---|---|
| `ilo_search_indicators` | busca ~1.210 dataflows por palavra-chave (paginação por `offset`) | catálogo em D1 (100% local) |
| `ilo_get_indicator_metadata` | dimensões, codelists, vintage, defaults de um dataflow | estrutura em KV (miss → upstream) |
| `ilo_list_dimension_values` | códigos válidos de uma dimensão (paginação por `offset`) | codelist em KV (miss → upstream) |
| `ilo_get_data` | observações com filtros por dimensão e período | 1 chamada REST por consulta |

Fluxo típico: `ilo_search_indicators` → `ilo_get_indicator_metadata` / `ilo_list_dimension_values`
para descobrir os códigos válidos de filtro → `ilo_get_data` com filtros de país e período.

Toda resposta carrega o **bloco de proveniência v1.0**
([`@sbissoli/mcp-provenance`](https://www.npmjs.com/package/@sbissoli/mcp-provenance), modos
`concise`/`detailed` via parâmetro `provenance_mode`) nos três canais do contrato:
`structuredContent`, `_meta` namespaced (`com.sidneybissoli.ilostat/*`) e rodapé de texto.

## Decisões de projeto (vinculantes)

Achados do spike SDMX, fixados como regras do servidor:

- **JSON só via header `Accept`** (`application/vnd.sdmx.{structure,data}+json`) —
  `?format=` é ignorado pelo endpoint e devolve XML.
- **Nunca emitir consulta irrestrita** (`/all` → HTTP 504 do gateway da OIT em ~61 s).
  `REF_AREA` é obrigatório em `ilo_get_data`, com **teto de 30 áreas por chamada** e erro
  pedagógico pedindo lotes / paginação por período. Sem fatiamento server-side no MVP;
  reavaliar pós-lançamento com dados do UsageTracker.
- **Codelists cacheadas POR CODELIST** (`codelist:ILO:CL_AREA:1.0`, TTL 7 dias) —
  `CL_MEASURE`/`CL_AREA` são compartilhadas entre dataflows (~90% de economia de KV).
  Estrutura de dataflow em KV com TTL 24 h (é a fonte do `data_vintage`).
- **`data_vintage`** = annotation `LAST_UPDATE` do dataflow (`dd/MM/yyyy` → ISO), servido da
  estrutura cacheada — consulta típica permanece **1 chamada REST**.
- **Catálogo em D1**, seed via `scripts/seed-catalog.mjs`; o `retrieved_at` do seed é gravado
  em `catalog_meta` e reportado na proveniência de `ilo_search_indicators`
  (`served_from_cache: true`).
- **`retrieved_at` é sempre o instante REAL da extração no upstream**, preservado junto ao
  valor cacheado — nunca o momento do build ou da resposta.
- **User-Agent identificável** em toda chamada upstream (o gateway da OIT responde 500 a
  clientes sem UA reconhecível; o `fetch` do Node/undici é rejeitado mesmo com UA — o seed
  usa `curl`).
- **Idioma do servidor: inglês; fuso: UTC** (persona internacional; dados da OIT são
  publicados em inglês).

### Regra de `derived` (caso de fronteira)

Conversão de unidade e arredondamento **não** contam como derivação: `derived=false` com nota
documentando a conversão. `derived=true` fica reservado a **transformação real** (agregação,
taxa calculada pelo servidor, interpolação, harmonização), sempre com `derivation_note`. Regra
operativa: *valor com o mesmo significado = não derivado; valor calculado = derivado.* O MVP
não transforma nada — `derived` é sempre `false`.

### Notices

`notices` reproduz os valores de `OBS_STATUS` (canal de status/disclaimer do SDMX, ex.: "Break
in series"), verbatim com contagem. Atributos técnicos por observação (`DECIMALS` etc.)
permanecem nas linhas (`rows[].attributes`).

## Obrigações de licença

- ILOSTAT: **CC BY 4.0** (dados/metadados desde 03/05/2023; `verified_at` 2026-08-04).
- Atribuição ILO em toda resposta (campo `citation`):
  `International Labour Organization, ILOSTAT, https://ilostat.ilo.org/data/, accessed <data>.`
- **Não** usar o logo da OIT. Landing declara "not endorsed by the ILO".
- Dados UIS (CC BY-SA) vivem no servidor irmão `uis-mcp-server` — segregação estrutural: os
  dois regimes nunca coabitam um servidor.

## Self-hosting / desenvolvimento

Tudo abaixo só é necessário para rodar a sua própria instância — **não** é preciso para usar o
servidor público.

```bash
npm install
npm run typecheck && npm test   # 74 testes offline (parsers, chave, tools, contrato de saída, evals-fixtures)
npm run dev                     # http://localhost:8787/mcp

# Seed do catálogo (D1) — necessário antes do primeiro uso:
node scripts/seed-catalog.mjs   # baixa via curl e gera scripts/seed-catalog.sql
npx wrangler d1 execute ilostat-catalog --local  --file=scripts/seed-catalog.sql
npx wrangler d1 execute ilostat-catalog --remote --file=scripts/seed-catalog.sql

npm run deploy
node scripts/smoke-mcp.mjs      # smoke do MCP em produção (initialize → 4 tools → erros)
```

Bindings (ver `wrangler.jsonc`): KV `SDMX_CACHE`, D1 `CATALOG_DB`, Durable Object `USAGE`
(contadores de uso em SQLite), `CF_VERSION_METADATA`. Auth Bearer opcional
(`wrangler secret put API_KEY`); rate limit token-bucket por IP.

### Refresh do catálogo (D1)

Estratégia: **seed manual com gatilho definido; sem cron do Worker.** Os dados de
`ilo_get_data` são sempre live (nunca envelhecem); o que o seed congela é só o catálogo de
busca (~1.210 dataflows, quase estático no upstream). A proveniência de
`ilo_search_indicators` expõe o `retrieved_at` REAL do seed, então a idade do catálogo é
sempre visível ao cliente — staleness explícita, não silenciosa.

- **Gatilhos de re-seed**: (a) trimestral; (b) imediato se um dataflow existente no upstream
  não aparecer na busca (sintoma de catálogo defasado). Procedimento: os 3 comandos de seed
  acima.
- **Cron rejeitado por ora**: cadência upstream baixa não justifica código/estado extra;
  reavaliar pós-submissão, com tráfego real — mesma janela da reavaliação dos tetos
  operacionais.

## Evals

[`@sbissoli/mcp-evals`](https://www.npmjs.com/package/@sbissoli/mcp-evals): 24 fixtures
próprias em `evals/fixtures/queries.ts`, validadas offline em `npm test`. A rodada com modelo
real (`npm run eval`) **custa API** — só com decisão explícita (`ANTHROPIC_API_KEY`; sem a
chave, sai 0 com instruções). Rodada de 07/08/2026: **top-1 100% (24/24)** — `evals/results/`.

**End-to-end (formato mcp-builder)**: 10 perguntas complexas com resposta única verificável em
`evals/e2e/evaluation.xml`, respostas validadas manualmente contra a produção
(`evals/e2e/validacao-respostas.md`). Rodada de 07/08/2026 (Sonnet): **9/10 string exata;
10/10 substantivo** — `evals/results/2026-08-07-e2e.md`.

## Rotas

| Rota | Finalidade |
|---|---|
| `/` | landing page (identidade do serviço + contato — pública) |
| `/health` | liveness |
| `/status` | versão + deploy corrente |
| `/metrics` | uso agregado (só o endpoint MCP; sem IPs, sem conteúdo de consulta) |
| `/mcp` | MCP Streamable HTTP |

## Segurança

Gate de submissão ao diretório: Snyk Agent Scan (07/08/2026) **passou** — evidência em
[`security/`](security/2026-08-07-snyk-agent-scan.md).

## Licença

Código: [MIT](LICENSE.md). Dados: ILOSTAT, CC BY 4.0 (ver "Obrigações de licença" acima).

## Privacidade

Política de privacidade do serviço hospedado: [PRIVACY.md](PRIVACY.md).

## Contato

Sidney da S. P. Bissoli — sbissoli76@gmail.com. Este serviço não é endossado pela OIT.
