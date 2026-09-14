# ilo-mcp-server and the alternatives for ILOSTAT

**Anyone working with ILO labour statistics** already has good tools:
[Rilostat][ri] (the ILO's own R package), the generic SDMX clients [sdmx1][s1] and
[pandaSDMX][ps], the [DBnomics][db] aggregator, and the [ILOSTAT SDMX REST API][api]
itself. They came first and they solve a problem this server does not solve. This
document says, with measured numbers, **where each one serves** — and when to use
more than one.

One line: Rilostat and the SDMX clients hand you the **dataset**; `ilo-mcp-server`
answers **one question** inside the assistant, with provenance attached.

Every number below was measured on 2026-09-13 and can be re-measured with the
commands in [How to check the numbers](#how-to-check-the-numbers).

## The chain of data, and where each tool sits

```
ILO — ILOSTAT, SDMX REST API (sdmx.ilo.org/rest)        1,212 dataflows; structure of ONE of them,
   │                                                     with all references: 488 KiB of SDMX-JSON
   │
   ├── Rilostat (R, by the ILO) ......... bulk download of a dataset + metadata, into a data frame
   ├── sdmx1 / pandaSDMX (Python) ....... generic SDMX client; ILO is 1 of ~36 sources
   ├── DBnomics ......................... republishes 1,071 ILO datasets beside other providers
   │
   └── ilo-mcp-server (this) ............ one question, answered in the assistant
            │                             catalogue snapshot of 1,212 dataflows, searched locally
            └── provenance block ........ source URL, data vintage, real retrieval instant, licence,
                                          ILO citation — on every answer, on three channels
```

## Table

| | Language / distribution | What it hands you | What you write | Where it runs |
| --- | --- | --- | --- | --- |
| **ilo-mcp-server** | TypeScript, [npm][np] + [MCP Registry][mr], or nothing at all (hosted) | **One answer**: the observations you asked for, labelled, with provenance | The question, in plain language | MCP client (Claude, ChatGPT, Cursor, Claude Code) or HTTP |
| [Rilostat][ri] 2.5.0 | R, CRAN — **by the ILO** | **The dataset**, as a data frame, plus metadata | `get_ilostat()`, the filter and the analysis | R, locally |
| [sdmx1][s1] 2.27.0 | Python, PyPI | SDMX objects (structures, codelists, observations) | The client code, key by key | Python, locally |
| [pandaSDMX][ps] 1.10.0 | Python, PyPI | The same, into pandas | The same | Python, locally |
| [DBnomics][db] | Web API, `dbnomics` (Python), [rdbnomics][rd] 0.6.4 (R) | ILO series in DBnomics' own shape, next to other providers | The series code and the call | Anywhere |
| [ILOSTAT SDMX REST][api] | HTTP | The SDMX message, raw | Everything: content negotiation, the dimension key, the codelists | Anywhere |

## Three questions, side by side

### 1. "What has happened to unemployment in Brazil since 2015?"

*Straight from the API:* you need the dataflow id (`DF_UNE_2EAP_SEX_AGE_RT`), the
**position** of every dimension in the key, a code for each one, and the right
`Accept` header — ILOSTAT returns XML unless you negotiate
`application/vnd.sdmx.data+json`, and answers HTTP 500 to the `Accept-Language: *`
that Node's `fetch` sends by default. Then the reply, 10,050 bytes, reads like this:

```json
"series": { "0:0:0:0:0": { "observations": { "0": [8.538, 0, null, null, 0, ...] } } }
```

Series and observations are keyed by **position**, values come in arrays whose first
element is the number and the rest are indices into attribute codelists. To learn that
`0:0:0:0:0` means Brazil, annual, unemployment rate, both sexes, 15+, and that `0` is
2015, you fetch the structure message: **488 KiB** more.

*Here:* one `ilo_get_data` call with `REF_AREA: ["BRA"]` and the period. The answer is
**8.8 KB**, every row labelled (`REF_AREA: "BRA"`, `TIME_PERIOD: "2015"`, `value: 8.538`),
`OBS_STATUS` spelled out ("Real value"), and the provenance block carrying the source URL,
`data_vintage: 2025-12-02`, the real `retrieved_at` and the ILO citation. The series:
**8.5% in 2015, up to 13.7% in 2020, down to 6.8% in 2024**.

*With Rilostat:* `get_ilostat("UNE_2EAP_SEX_AGE_RT")` and you filter the data frame — the
right tool if what you want is the table, not the sentence.

### 2. "Which dataflow has average monthly earnings by sex and economic activity?"

*Straight from the API:* the catalogue is one request
(`/dataflow/ILO?detail=allstubs`, 545 KiB, 1,212 dataflows) and then it is your problem
to search it. Asking the structure of a single candidate, with the codelists you need to
read it, is the **488 KiB** message above.

*Here:* `ilo_search_indicators("average monthly earnings by sex and economic activity")`
searches a local snapshot of the same catalogue — no upstream call — and
`ilo_get_indicator_metadata("DF_EAR_EMTA_SEX_ECO_NB")` returns the dimensions, the
codelists, the vintage and the ILO's default selection in **3.1 KB**: the same information,
**157× smaller**, which is the difference between a readable answer and a context window.

### 3. "How large is the gender pay gap?"

The ILO publishes it: *Gender wage gap by occupation*, `DF_EAR_GGAP_OCU_RT`. But
ILOSTAT is worded in British statistical English, and until 0.6.0 this server matched the
catalogue name literally — so *"gender pay gap"* returned **zero**, and so did *wages*,
*salary*, *informality*, *productivity*, *jobless* and every US spelling of *labour*.
Measured over the 1,212 names:

| you ask | names containing it | ILOSTAT writes | names |
| --- | ---: | --- | ---: |
| labor / labor force | 0 | labour / labour force | 176 / 122 |
| wages, salary, remuneration | 0 | earnings | 107 |
| informality | 0 | informal | 133 |
| gender | 2 | sex | 1,131 |
| productivity | 0 | output per worker | 4 |
| pay gap | 0 | wage gap | 1 |
| jobless | 0 | unemployment | 108 |

Since 0.6.0 the search resolves the word you used to the word the ILO uses, and **says so
in the answer** (`vocabulary_notes`). A term the ILO simply does not publish — telework,
gig work, vacancies — still returns zero: the table only carries pairs that were counted
in the catalogue, because an alias for data that does not exist promises what the ILO
never published.

## Numbers, measured

| | |
| --- | ---: |
| Dataflows in the ILOSTAT catalogue (2026-09-13) | 1,212 |
| The catalogue message (`detail=allstubs`) | 545 KiB |
| Structure of ONE dataflow, `references=all` | 488 KiB |
| The same metadata through `ilo_get_indicator_metadata` | 3.1 KB |
| Raw data message, Brazil unemployment 2015–2024 | 9.8 KiB, unlabelled |
| The same through `ilo_get_data` | 8.8 KB, labelled, with provenance |
| ILO datasets republished by DBnomics | 1,071 |
| Tools / resources / prompts here | 6 / 3 / 3 |

## What this server does not do

- **It does not hand you the dataset.** One `ilo_get_data` call is one REST query, capped
  at 30 areas, and the answer is meant to be read. For a whole table, repeatedly, use
  Rilostat's bulk download.
- **It does not publish microdata.** ILOSTAT is aggregates; so is this.
- **It does not transform values.** `derived` is always `false`: no server-side
  aggregation, no interpolation, no harmonisation. What you read is what the ILO published.
- **It is not the ILO.** Independent project, unofficial client of a public API, not
  endorsed by the International Labour Organization. Data remain © ILO under CC BY 4.0.

## How to check the numbers

```bash
# The catalogue (1,212 dataflows) and its size
curl -sH 'Accept: application/vnd.sdmx.structure+json;version=1.0' -H 'Accept-Language: en' \
  'https://sdmx.ilo.org/rest/dataflow/ILO?detail=allstubs' | wc -c

# The structure of ONE dataflow, with the codelists needed to read its data
curl -sH 'Accept: application/vnd.sdmx.structure+json;version=1.0' -H 'Accept-Language: en' \
  'https://sdmx.ilo.org/rest/dataflow/ILO/DF_UNE_2EAP_SEX_AGE_RT/latest?references=all&detail=full' | wc -c

# The same question, through this server (the URL above is what its provenance reports)
curl -s -X POST https://ilo.sidneybissoli.com/mcp \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -H 'MCP-Protocol-Version: 2025-06-18' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"ilo_get_data","arguments":{"dataflow":"DF_UNE_2EAP_SEX_AGE_RT","filters":{"REF_AREA":["BRA"],"SEX":["SEX_T"],"AGE":["AGE_YTHADULT_YGE15"]},"start_period":"2015","end_period":"2024"}}}'
```

The vocabulary counts are reproducible from the catalogue message: count the names that
contain each word. The regressions in `tests/vocabulary.test.ts` use real id/name pairs
from the catalogue, checked against the versioned id list of the seed.

## Using them together

They are not rivals. A common shape: ask the question in the assistant (here), see the
indicator, the codes and the vintage with provenance, and then — if the analysis needs the
whole table — pull that same dataflow with Rilostat or sdmx1 and work in R or Python. The
dataflow id and the dimension codes this server reports are the same ones those tools take.

## Em português

O servidor **não substitui** o [Rilostat][ri] (o pacote R da própria OIT), os clientes SDMX
em Python nem o [DBnomics][db]: eles entregam a **base**, e este servidor responde **uma
pergunta** dentro do assistente, com fonte, safra e licença grudadas na resposta. Os
números acima foram medidos em 13/09/2026: o catálogo tem 1.212 dataflows; a estrutura de
UM deles, com as codelists necessárias para ler os dados, são 488 KiB de SDMX-JSON, contra
3,1 KB da mesma informação pelo `ilo_get_indicator_metadata`; a mensagem crua de dados vem
com séries e observações indexadas por POSIÇÃO (`"0:0:0:0:0"`), ilegível sem a estrutura.
Desemprego no Brasil: 8,5% em 2015, 13,7% em 2020, 6,8% em 2024 (safra de 02/12/2025).
Para a base inteira, o caminho é o Rilostat; para microdado, nenhum dos dois — o ILOSTAT
publica agregados.

[ri]: https://ilostat.github.io/Rilostat/
[s1]: https://pypi.org/project/sdmx1/
[ps]: https://pypi.org/project/pandasdmx/
[db]: https://db.nomics.world/ILO
[rd]: https://cran.r-project.org/package=rdbnomics
[api]: https://ilostat.ilo.org/resources/sdmx-tools/
[np]: https://www.npmjs.com/package/ilo-mcp-server
[mr]: https://registry.modelcontextprotocol.io/v0.1/servers/io.github.SidneyBissoli%2Filo-mcp-server/versions
