# ILOSTAT MCP Server

![Cloudflare Workers](https://img.shields.io/badge/Cloudflare%20Workers-F38020?logo=cloudflare&logoColor=white)
![MCP](https://img.shields.io/badge/MCP-Streamable%20HTTP-1f6feb)
[![Version](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Filo.sidneybissoli.com%2Fstatus&query=%24.version&label=version&color=1f6feb)](https://ilo.sidneybissoli.com/status)
[![Tools](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Filo.sidneybissoli.com%2Fstatus&query=%24.tools&label=tools&color=2ea44f)](https://ilo.sidneybissoli.com/status)
[![Provenance](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Filo.sidneybissoli.com%2Fstatus&query=%24.provenance_contract&label=provenance&prefix=v&color=8250df)](https://ilo.sidneybissoli.com/status)
[![ilo-mcp-server MCP server](https://glama.ai/mcp/servers/SidneyBissoli/ilo-mcp-server/badges/score.svg)](https://glama.ai/mcp/servers/SidneyBissoli/ilo-mcp-server)
[![GitHub stars](https://img.shields.io/github/stars/SidneyBissoli/ilo-mcp-server?style=flat&logo=github)](https://github.com/SidneyBissoli/ilo-mcp-server)
[![Status](https://img.shields.io/website?url=https%3A%2F%2Filo.sidneybissoli.com%2Fhealth&up_message=online&down_message=offline&label=status)](https://ilo.sidneybissoli.com/status)

🇧🇷 [Leia em Português](README.pt-BR.md)

A **public, hosted, provenance-first** [MCP](https://modelcontextprotocol.io) server for
**ILOSTAT**, the statistical database of the International Labour Organization (ILO) —
**no installation, no account, no API key**. Point your MCP client at the hosted endpoint and
ask about unemployment, employment, wages, working time and other labour indicators by
country, year, sex and age. It runs on Cloudflare Workers over Streamable HTTP and talks to
the official ILOSTAT SDMX REST API.

Every response carries a **provenance block** (source URL, data vintage, real retrieval
timestamp, license, ILO citation) — exact figures with an audit trail, not numbers guessed
from training data. UNESCO UIS statistics live in the sibling server
[`uis-mcp-server`](https://github.com/SidneyBissoli/uis-mcp-server) (one server per source:
structural separation of CC BY and CC BY-SA data).

## Use it (hosted — no setup)

Point any MCP client at the Streamable HTTP endpoint:

```
https://ilo.sidneybissoli.com/mcp
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

## Tools

| Tool | What it does | Source |
|---|---|---|
| `ilo_search_indicators` | keyword search over ~1,210 dataflows (paginated by `offset`) | catalogue in D1 (100% local) |
| `ilo_get_indicator_metadata` | dimensions, codelists, vintage and default selection of a dataflow | structure in KV (miss → upstream) |
| `ilo_list_dimension_values` | valid codes of one dimension (paginated by `offset`) | codelist in KV (miss → upstream) |
| `ilo_get_data` | observations filtered by dimension and period | 1 REST call per query |

Typical flow: `ilo_search_indicators` → `ilo_get_indicator_metadata` / `ilo_list_dimension_values`
to discover valid filter codes → `ilo_get_data` with country and period filters.

Every response carries the **provenance block v1.0**
([`@sbissoli/mcp-provenance`](https://www.npmjs.com/package/@sbissoli/mcp-provenance), modes
`concise`/`detailed` via the `provenance_mode` parameter) on the three channels of the contract:
`structuredContent`, namespaced `_meta` (`com.sidneybissoli.ilostat/*`) and a text footer.

## Design decisions (binding)

Findings of the SDMX spike, fixed as rules of the server:

- **JSON is negotiated only via the `Accept` header**
  (`application/vnd.sdmx.{structure,data}+json`) — `?format=` is ignored by the endpoint and
  returns XML.
- **Never issue an unrestricted query** (`/all` → HTTP 504 from the ILO gateway after ~61 s).
  `REF_AREA` is required in `ilo_get_data`, with a **cap of 30 areas per call** and a pedagogical
  error asking for batches / pagination by period. No server-side slicing in the MVP; to be
  reassessed after launch with UsageTracker data.
- **Codelists are cached PER CODELIST** (`codelist:ILO:CL_AREA:1.0`, TTL 7 days) —
  `CL_MEASURE`/`CL_AREA` are shared across dataflows (~90% KV savings). Dataflow structure is
  cached in KV with TTL 24 h (it is the source of `data_vintage`).
- **`data_vintage`** = the dataflow's `LAST_UPDATE` annotation (`dd/MM/yyyy` → ISO), served from
  the cached structure — a typical query stays at **1 REST call**.
- **Catalogue in D1**, seeded by `scripts/seed-catalog.mjs`; the seed's `retrieved_at` is stored
  in `catalog_meta` and reported in the provenance of `ilo_search_indicators`
  (`served_from_cache: true`).
- **`retrieved_at` is always the REAL instant of extraction upstream**, preserved next to the
  cached value — never the build or response time.
- **Identifiable User-Agent** on every upstream call (the ILO gateway answers 500 to clients
  without a recognisable UA; Node/undici `fetch` is rejected even with a UA — the seed uses
  `curl`).
- **Server language: English; timezone: UTC** (international persona; ILO data is published in
  English).

### `derived` rule (boundary case)

Unit conversion and rounding do **not** count as derivation: `derived=false` with a note
documenting the conversion. `derived=true` is reserved for **real transformation** (aggregation,
server-computed rate, interpolation, harmonisation), always with a `derivation_note`. Operative
rule: *value with the same meaning = not derived; computed value = derived.* The MVP transforms
nothing — `derived` is always `false`.

### Notices

`notices` reproduces the values of `OBS_STATUS` (the SDMX status/disclaimer channel, e.g. "Break in
series"), verbatim and with counts. Technical per-observation attributes (`DECIMALS` etc.) stay on
the rows (`rows[].attributes`).

## License obligations

- ILOSTAT: **CC BY 4.0** (data and metadata since 2023-05-03; `verified_at` 2026-08-04).
- ILO attribution in every response (`citation` field):
  `International Labour Organization, ILOSTAT, https://ilostat.ilo.org/data/, accessed <date>.`
- The ILO logo is **not** used. The landing page states "not endorsed by the ILO".
- UIS data (CC BY-SA) lives in the sibling `uis-mcp-server` — structural separation: the two
  regimes never share a server.

## Self-hosting / development

Everything below is only needed to run your own instance — it is **not** required to use the
public server.

```bash
npm install
npm run typecheck && npm test   # 75 offline tests (parsers, key, tools, output contract, eval fixtures)
npm run dev                     # http://localhost:8787/mcp

# Catalogue seed (D1) — required before first use:
node scripts/seed-catalog.mjs   # downloads via curl and generates scripts/seed-catalog.sql
npx wrangler d1 execute ilostat-catalog --local  --file=scripts/seed-catalog.sql
npx wrangler d1 execute ilostat-catalog --remote --file=scripts/seed-catalog.sql

npm run deploy
node scripts/smoke-mcp.mjs      # smoke test of the MCP in production (initialize → 4 tools → errors)
```

Bindings (see `wrangler.jsonc`): KV `SDMX_CACHE`, D1 `CATALOG_DB`, Durable Object `USAGE`
(SQLite-backed usage counters), `CF_VERSION_METADATA`. Optional Bearer auth
(`wrangler secret put API_KEY`); token-bucket rate limit per IP.

### Catalogue refresh (D1)

Strategy: **manual seed with defined triggers; no Worker cron.** `ilo_get_data` is always live
(never stale); the seed only freezes the search catalogue (~1,210 dataflows, nearly static
upstream). The provenance of `ilo_search_indicators` exposes the seed's REAL `retrieved_at`, so
the catalogue's age is always visible to the client — explicit staleness, not silent.

- **Re-seed triggers**: (a) quarterly; (b) immediately if a dataflow that exists upstream does not
  show up in search (symptom of a stale catalogue). Procedure: the three seed commands above.
- **Cron rejected for now**: low upstream cadence does not justify extra code/state; to be
  reassessed post-submission with real traffic — same window as the operational caps.

## Evals

[`@sbissoli/mcp-evals`](https://www.npmjs.com/package/@sbissoli/mcp-evals): 24 own fixtures in
`evals/fixtures/queries.ts`, validated offline in `npm test`. The run with a real model
(`npm run eval`) **costs API credit** — only by explicit decision (`ANTHROPIC_API_KEY`; without
the key it exits 0 with instructions). Run of 2026-08-07: **top-1 100% (24/24)** —
`evals/results/`.

**End-to-end (mcp-builder format)**: 10 complex questions with a single verifiable answer in
`evals/e2e/evaluation.xml`, answers validated manually against production
(`evals/e2e/validacao-respostas.md`). Run of 2026-08-07 (Sonnet): **9/10 exact string;
10/10 substantive** — `evals/results/2026-08-07-e2e.md`.

## Endpoints

| Route | Purpose |
|---|---|
| `/` | landing page (service identity + contact — public) |
| `/health` | liveness |
| `/status` | version, tool count/names, provenance contract version, current deploy (feeds the README badges) |
| `/metrics` | aggregated usage (MCP endpoint only; no IPs, no query content) |
| `/mcp` | MCP Streamable HTTP |

## Security

Directory submission gate: Snyk Agent Scan (2026-08-07) **passed** — evidence in
[`security/`](security/2026-08-07-snyk-agent-scan.md).

## License

Code: [MIT](LICENSE.md). Data: ILOSTAT, CC BY 4.0 (see "License obligations" above).

## Privacy

Privacy policy of the hosted service: [PRIVACY.md](PRIVACY.md).

## Contact

Sidney da S. P. Bissoli — sbissoli76@gmail.com. This service is not endorsed by the ILO.
