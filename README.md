# ILO Labour Statistics (ILOSTAT) — MCP Server

![MCP](https://img.shields.io/badge/MCP-Streamable%20HTTP-1f6feb)
[![CI](https://github.com/SidneyBissoli/ilo-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/SidneyBissoli/ilo-mcp-server/actions/workflows/ci.yml)
[![Version](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Filo.sidneybissoli.com%2Fstatus&query=%24.version&label=version&color=1f6feb)](https://ilo.sidneybissoli.com/status)
[![Tools](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Filo.sidneybissoli.com%2Fstatus&query=%24.tools&label=tools&color=2ea44f)](https://ilo.sidneybissoli.com/status)
[![Resources](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Filo.sidneybissoli.com%2Fstatus&query=%24.resources&label=resources&color=2ea44f)](https://ilo.sidneybissoli.com/status)
[![Prompts](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Filo.sidneybissoli.com%2Fstatus&query=%24.prompts&label=prompts&color=2ea44f)](https://ilo.sidneybissoli.com/status)
[![MCP Registry](https://img.shields.io/badge/MCP%20Registry-listed-blue)](https://registry.modelcontextprotocol.io/v0.1/servers/io.github.SidneyBissoli%2Filo-mcp-server/versions)
[![ilo-mcp-server MCP server](https://glama.ai/mcp/servers/SidneyBissoli/ilo-mcp-server/badges/score.svg)](https://glama.ai/mcp/servers/SidneyBissoli/ilo-mcp-server)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow)](LICENSE.md)
[![Status](https://img.shields.io/website?url=https%3A%2F%2Filo.sidneybissoli.com%2Fhealth&up_message=online&down_message=offline&label=status)](https://ilo.sidneybissoli.com/status)

🇧🇷 [Leia em Português](README.pt-BR.md)

A **public, hosted, provenance-first** [MCP](https://modelcontextprotocol.io) server for the
**International Labour Organization (ILO)** statistics — the **ILOSTAT** database —
**no installation, no account, no API key**. Point your MCP client at the hosted endpoint and
ask about unemployment, employment, wages, working time and other labour indicators by
country, year, sex and age. It runs on Cloudflare Workers over Streamable HTTP and talks to
the official ILOSTAT SDMX REST API.

Every response carries a **provenance block** (source URL, data vintage, real retrieval
timestamp, license, ILO citation) — exact figures with an audit trail, not numbers guessed
from training data.

## Use it (hosted — no setup)

Point any MCP client at the Streamable HTTP endpoint:

```
https://ilo.sidneybissoli.com/mcp
```

Claude Desktop / Claude Code and other clients with native remote support:

```json
{
  "mcpServers": {
    "ilostat": {
      "url": "https://ilo.sidneybissoli.com/mcp"
    }
  }
}
```

For clients that launch MCP servers as a command, use the
[`mcp-remote`](https://www.npmjs.com/package/mcp-remote) bridge:

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

The `ilo-mcp-server.sidneybissoli.workers.dev` hostname is also served, as a secondary.

## Run locally (stdio)

Prefer not to route queries through a third-party host? The **same server** also runs as a
**local stdio process** that talks directly to the official ILOSTAT API — same 4 tools, resources and prompts,
same limits, same provenance block, no Cloudflare in the loop.

```bash
git clone https://github.com/SidneyBissoli/ilo-mcp-server
cd ilo-mcp-server
npm install
npm run build
node dist/cli.js   # serves MCP over stdio (Ctrl+C to stop)
```

Point a command-based client at it:

```json
{
  "mcpServers": {
    "ilostat": {
      "command": "node",
      "args": ["/path/to/ilo-mcp-server/dist/cli.js"]
    }
  }
}
```

Differences from the hosted server, all due to the absence of Cloudflare bindings: the SDMX
cache lives in process memory (structures and codelists are reused within a session, not across
sessions); the search catalogue is downloaded from the official endpoint on the first search
(its real `retrieved_at` is reported in provenance); no usage metrics, rate limit or auth. Logs
go to **stderr** — stdout carries only the JSON-RPC stream. The repository `Dockerfile` builds
this runtime (used by the Glama registry).

## Tools

| Tool | What it does | Source |
|---|---|---|
| `ilo_search_indicators` | keyword search over ~1,210 dataflows (paginated by `offset`) | local catalogue (no upstream call) |
| `ilo_get_indicator_metadata` | dimensions, codelists, vintage and default selection of a dataflow | cached structure (miss → upstream) |
| `ilo_list_dimension_values` | valid codes of one dimension (paginated by `offset`) | cached codelist (miss → upstream) |
| `ilo_get_data` | observations filtered by dimension and period | 1 live REST call per query |

Typical flow: `ilo_search_indicators` → `ilo_get_indicator_metadata` / `ilo_list_dimension_values`
to discover valid filter codes → `ilo_get_data` with country and period filters.

Every response carries the **provenance block v1.0**
([`@sbissoli/mcp-provenance`](https://www.npmjs.com/package/@sbissoli/mcp-provenance), modes
`concise`/`detailed` via the `provenance_mode` parameter) on three channels:
`structuredContent`, namespaced `_meta` (`com.sidneybissoli.ilostat/*`) and a text footer.

## Resources and prompts

Three **resources** (static, `text/markdown`, no upstream call) that a client can attach to the
context before calling tools — they save the 2–3 discovery calls most sessions spend on
"which dataflow, which codes":

| URI | Content |
|---|---|
| `ilostat://guide` | tool workflow, stable code conventions (`REF_AREA` ISO3 + `X`-aggregates, `SEX`, `AGE`, `FREQ`, dataflow id suffixes), limits, reporting rules |
| `ilostat://reference/key-dataflows` | verified dataflow ids by topic (unemployment, employment, participation, wages, hours, informality, NEET, SDG 8, productivity) |
| `ilostat://reference/provenance` | meaning of every provenance field and how to cite the ILO |

Three **prompts** — ready-made workflows that chain the tools and end with the citation rules
(arguments are strings; period arguments optional):

| Prompt | Arguments | Result |
|---|---|---|
| `ilo_country_labour_profile` | `country`, `start_period`, `end_period` | labour-market profile of one country (unemployment, participation, employment ratio, informality, NEET, earnings, hours) |
| `ilo_compare_countries` | `countries`, `indicator`, `start_period`, `end_period` | comparison table across countries/aggregates in one data call, flagging modelled estimates vs reported data |
| `ilo_indicator_trend` | `indicator`, `country`, `start_period`, `end_period` | time series of one indicator with first/last, peak/trough and `OBS_STATUS` breaks |

Every dataflow id quoted in the resources and prompts is checked against the catalogue seed by
the test suite, so the documentation cannot point at an id the search would not find.

## Behaviour and limits

- **`REF_AREA` is required in `ilo_get_data`, up to 30 areas per call.** The ILO gateway times
  out (HTTP 504) on unrestricted queries, so the server never issues one; for broad panels, split
  the areas into batches and/or paginate by period (`start_period`/`end_period`). The error
  message explains how.
- **One live REST call per data query.** Data is never cached — every `ilo_get_data` result is
  fetched from ILOSTAT at request time. Dataflow structures (TTL 24 h) and codelists (TTL 7 days,
  shared across dataflows) are cached.
- **`data_vintage`** is the dataflow's last-update date as published by the ILO (`LAST_UPDATE`
  annotation, normalised to ISO).
- **`retrieved_at` is always the real instant of extraction from ILOSTAT**, preserved alongside
  any cached value — never the build or response time. Cached responses say so
  (`served_from_cache: true`).
- **The indicator catalogue is a local snapshot** (~1,210 dataflows), refreshed periodically; its
  own `retrieved_at` is reported in the provenance of `ilo_search_indicators`, so its age is
  always visible.
- **Every upstream call carries an identifiable User-Agent** (service URL + contact), so ILO
  administrators can reach the operator.
- **Language: English; timezone: UTC** (ILO data is published in English).

### Provenance fields

- **`derived`** — `true` only for real transformation (aggregation, server-computed rate,
  interpolation, harmonisation), always with a `derivation_note`; unit conversion and rounding
  do not count. This server does not transform values, so `derived` is always `false`.
- **`notices`** — reproduces the values of `OBS_STATUS` (the SDMX status/disclaimer channel,
  e.g. "Break in series"), verbatim and with counts. Technical per-observation attributes
  (`DECIMALS` etc.) stay on the rows (`rows[].attributes`).

## Data license and attribution

- ILOSTAT data and metadata: **CC BY 4.0** (since 2023-05-03; license verified 2026-08-04).
- ILO attribution in every response (`citation` field):
  `International Labour Organization, ILOSTAT, https://ilostat.ilo.org/data/, accessed <date>.`
- The ILO logo is not used. This service is not endorsed by the ILO.

## Self-hosting / development

Everything below is only needed to run your own instance — it is **not** required to use the
public server.

```bash
npm install
npm run typecheck && npm test   # 96 offline tests (parsers, key, tools, output contract, resources/prompts, in-memory catalogue, eval fixtures)
npm run dev                     # http://localhost:8787/mcp (Worker)
npm run build && npm start      # stdio runtime (dist/cli.js)

# Catalogue seed (D1) — required before first use:
node scripts/seed-catalog.mjs   # downloads via curl and generates scripts/seed-catalog.sql
npx wrangler d1 execute ilostat-catalog --local  --file=scripts/seed-catalog.sql
npx wrangler d1 execute ilostat-catalog --remote --file=scripts/seed-catalog.sql

npm run deploy
node scripts/smoke-mcp.mjs      # smoke test against production (initialize → 4 tools → errors)
npm run manifest:lhm            # regenerate tools/resources/prompts in lhm.plugin.json from the real server
# (the seed also writes tests/fixtures/catalog-ids.txt — the versioned id list the tests check resources/prompts against)
```

Bindings (see `wrangler.jsonc`): KV `SDMX_CACHE`, D1 `CATALOG_DB`, Durable Object `USAGE`
(SQLite-backed usage counters), `CF_VERSION_METADATA`. Optional Bearer auth
(`wrangler secret put API_KEY`); token-bucket rate limit per IP.

Notes for operators:

- ILOSTAT returns JSON only when negotiated via the `Accept` header
  (`application/vnd.sdmx.{structure,data}+json`); `?format=` is ignored and returns XML.
- The ILO gateway answers HTTP 500 (`languageTag1`) to the `Accept-Language: *` header that
  Node's `fetch` (undici) sends by default; every upstream call therefore sets
  `Accept-Language: en` explicitly (Cloudflare's runtime sends no such header, so the Worker was
  never affected). It also expects an identifiable User-Agent.
- **Catalogue refresh** is manual (no cron): quarterly, or immediately if a dataflow that exists
  upstream does not show up in search. Procedure: the three seed commands above. Data queries are
  always live, so only the search catalogue can age — and its age is exposed in provenance.

## Evals

[`@sbissoli/mcp-evals`](https://www.npmjs.com/package/@sbissoli/mcp-evals): 24 fixtures in
`evals/fixtures/queries.ts`, validated offline in `npm test`. The run with a real model
(`npm run eval`) uses the Anthropic API and needs `ANTHROPIC_API_KEY` (without it, it exits with
instructions). Run of 2026-08-07: **top-1 100% (24/24)** — `evals/results/`.

**End-to-end**: 10 complex questions with a single verifiable answer in `evals/e2e/evaluation.xml`,
answers validated manually against production (`evals/e2e/validacao-respostas.md`). Run of
2026-08-07 (Sonnet): **9/10 exact string; 10/10 substantive** — `evals/results/2026-08-07-e2e.md`.

## Endpoints

| Route | Purpose |
|---|---|
| `/` | landing page (service identity + contact — public) |
| `/health` | liveness |
| `/status` | version, tool/resource/prompt counts and names, provenance contract version, current deploy (feeds the README badges) |
| `/metrics` | aggregated usage (MCP endpoint only; no IPs, no query content) |
| `/mcp` | MCP Streamable HTTP |

## Security

Snyk Agent Scan (2026-08-07): **passed** — report in
[`security/`](security/2026-08-07-snyk-agent-scan.md).

## License

Code: [MIT](LICENSE.md). Data: ILOSTAT, CC BY 4.0 (see "Data license and attribution" above).

## Privacy

Privacy policy of the hosted service: [PRIVACY.md](PRIVACY.md).

## Contact

Sidney da S. P. Bissoli — sbissoli76@gmail.com. This service is not endorsed by the ILO.
