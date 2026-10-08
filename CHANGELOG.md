# Changelog

Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). Versões
seguem o `package.json` (espelhado em `server.json`, `src/config.ts` e
`lhm.plugin.json` pelo hook `version`). Uma versão = um deploy em
`https://ilo.sidneybissoli.com` e uma publicação no npm (`ilo-mcp-server`,
runtime stdio) e no MCP Registry. A data de cada seção é a de publicação no npm
(`npm view ilo-mcp-server time`), em UTC.

**O histórico anterior à 1.4.0 foi reconstruído em 2026-10-08**, porque este arquivo
só nasceu na 1.4.0 e o resto vivia no `ROADMAP.md`, que fica fora do git. Fontes: as
tags `v*` e os commits de cada intervalo, as notas das releases do GitHub e as datas
do npm. Lacunas registradas:

- **Antes do npm:** a 0.1.0 (MVP, 07/08/2026, 4 tools e proveniência v1.0) e a 0.2.0
  (07/08, só ILOSTAT, prefixo `ilo_`) foram numeradas sem tag; a 0.2.1 e a 0.2.2
  (18/08) têm tag — a 0.2.2 também release no GitHub — e foram ao MCP Registry como
  servidor remoto, mas nunca ao npm. O pacote ficou publicável no commit `b9b26fc`
  (18/08), e a 0.3.0 é a primeira versão no npm.
- **Sem tag e sem release:** 0.3.1 (só npm; o commit da versão é `2d4da80`).
- **Com tag e sem release no GitHub:** 0.3.2, 0.4.0, 0.5.0 e 0.6.1.
- **Numeradas e nunca publicadas:** 0.7.0 e 0.8.0 (22 e 23/09); o trabalho delas saiu
  na 1.0.0, como a própria nota da 1.0.0 diz.
- **Datas corrigidas para UTC:** a 1.4.2 e a 1.4.0 estavam com a data local
  (07/10 e 05/10); o npm registra 08/10 e 06/10.

## [1.6.0] — 2026-10-08

Contrato de proveniência: tempo 2 da v1.2 e tempo 1 da v1.3
(`@sbissoli/mcp-provenance` 0.4.0). O fio das tools não muda além do
`contract_version`: o ilo não funde sub-fontes, então a 1.2 não acrescenta
`field_sources` a nenhuma resposta.

### Alterado

- O servidor emite o contrato **1.2** (`contractVersion` no contexto de
  proveniência): `contract_version` passa a `"1.2"` no modo `detailed`, no `/status`
  (`provenance_contract`) e no resource `ilostat://reference/provenance`, que ecoam a versão do
  contexto, nunca um literal.
- O `outputSchema` das tools passa a **declarar** as chaves opcionais da 1.3
  (`notices`, `derived`, `derivation_note`, `revision`), pelo esquema importado do
  pacote. A superfície declarada muda (trava e `server.json` regravados); nenhuma
  resposta as emite ainda — a 1.3 se liga numa versão posterior, depois de os
  conectores renovarem o esquema.
- Os blocos passam a informar a **`revision`** (fica no canônico; sai no fio só com a
  1.3): `current` em toda resposta, e em `ilo_get_data` com a nota que o servidor já
  publicava sobre revisões (a OIT revisa números publicados e reestima as séries
  modeladas, ids `_2`, a cada release). `final` não se usa, nem quando o `OBS_STATUS`
  marca o valor; o `OBS_STATUS` segue em `notices`, verbatim.
- Textos que fixavam a versão do contrato ("contract v1.1", "bloco de proveniência
  v1.0") passam a não citar número: a descrição do bloco no `outputSchema`, o README e o
  LEIA-ME.
- Dependências: `@sbissoli/mcp-provenance` ^0.4.0, `@sbissoli/mcp-upstream` ^0.4.2.

## [1.5.0] — 2026-10-08

O que cada número é, e em que versão. Um leitor do artigo do bcb no dev.to (Daniel
Oliveira, sobre os dados XBRL da SEC) apontou que o período e a versão de cada número
precisam vir ditos. Medido aqui: o servidor já repassa `FREQ`, `TIME_PERIOD` e o
`OBS_STATUS` por linha, e o `data_vintage` é o `LAST_UPDATE` do dataflow — mas nada dizia
que os valores podem mudar entre releases.

### Alterado

- `ilo_get_data` e as `instructions` dizem como ler cada observação (`TIME_PERIOD` com o
  `FREQ`; `OBS_STATUS` quando presente: quebra de série, valor estimado ou provisório) e
  que todo valor é o da release datada no `data_vintage`: a OIT revisa números publicados
  e reestima as séries modeladas (ids com `_2`) a cada release, anos passados inclusive;
  o servidor só devolve a release vigente.
- Superfície declarada nova: trava, `server.json` e `lhm.plugin.json` regravados.

## [1.4.2] — 2026-10-08

A impressão digital da superfície passa a ir **na entrada do MCP Registry**, para o
cliente conferir. **Nenhuma tool, resource, prompt ou resposta muda** — o sha da
superfície declarada é o mesmo travado em 1.4.0 (`1e9f95bd3482`).

### Adicionado

- `server.json` publica, sob `_meta["io.modelcontextprotocol.registry/publisher-provided"]`,
  o sha256 da superfície declarada e quem responde sem credencial no endpoint
  publicado (forma `mcp-surface/1`, SPEC.md do `@sbissoli/mcp-surface` 0.5.0). Um host
  pode recalcular na primeira conexão e recusar, ou pedir nova aprovação, se divergir.
  Ideia de dois leitores do artigo do replay (Mike Dabydeen e Valentina Koniukhova, dev.to).
- `npm run surface:lock` grava o bloco (`mcp-surface registro`); o teste da trava
  reprova `server.json` que publique outra coisa que a trava.
- `publish.yml`: depois do `mcp-publisher publish`, `mcp-surface conferir-registro` lê
  a entrada desta versão no registro e a compara com o endpoint no ar, como um cliente
  faria, sem ler a trava.
- README / LEIA-ME: como conferir por conta própria (`verify.mjs`, sem dependência).

## [1.4.1] — 2026-10-06

Só dependências: SDK do MCP 2.1.0 → 2.3.0 e `agents` 0.24.0 → 0.26.0.
Nenhuma resposta e nenhum esquema mudam (a trava de superfície passou sem
regravar).

### Segurança

- **GHSA-6qxp-vccf-f47h (high) em `@modelcontextprotocol/client`
  2.0.0–2.1.0** ("OAuth client could send credentials to an authorization
  server chosen by the MCP server"): o `client` sobe a 2.3.0. Aqui ele é
  devDependency, importado só pelos testes e pelo gerador do manifesto
  (nenhum `src/` de runtime), sem OAuth — o pacote publicado nunca o
  carregou.
- `source-map-js` 1.2.1 → 1.2.2 (GHSA-68fv-2mgg-jv7q), só de
  desenvolvimento.

### Alterado

- **`@modelcontextprotocol/server` 2.1.0 → 2.3.0 e `agents` 0.24.0 →
  0.26.0**, no mesmo diretório; `wrangler` 4.147.0. O `agents` ainda declara
  o SDK 2.0.0 como peer exato; com o `legacy-peer-deps` do `.npmrc` os dois
  resolvem a MESMA cópia 2.3.0 — conferido em runtime antes do merge.

## [1.4.0] — 2026-10-06

### Alterado

- **`@sbissoli/mcp-provenance` 0.3.0 (contrato v1.2) no tempo 1**, com
  `@sbissoli/mcp-upstream` 0.4.0. O `outputSchema` de todas as tools passa a
  declarar a chave opcional `field_sources` no bloco `concise` (com
  `served_from_cache` opcional por sub-fonte, também no `detailed`), e o
  `contract_version` do `detailed` vira o enum `["1.1", "1.2"]`. É só o que os
  schemas aceitam: **nenhuma resposta muda** — o servidor continua emitindo a
  1.1, byte a byte o que a 0.2.0 emitia, e não preenche `field_sources`.
  Ligar a 1.2 (`contractVersion: "1.2"` no contexto) é o tempo 2. A trava de
  superfície acendeu só por esses schemas; por isso o minor.
- `GET /status` (`provenance_contract`) e a resource
  `ilostat://reference/provenance` ("contract v…") passam a ler a versão que o
  servidor **emite** do contexto de proveniência (`provenance.contractVersion`),
  não a constante do pacote. Hoje continua "1.1"; o vínculo fica certo para o
  tempo 2.

## [1.3.0] — 2026-10-04

### Adicionado

- **Unidade e multiplicador em toda linha de `ilo_get_data`.** `attributes` ganha
  `UNIT_MEASURE_TYPE`, `UNIT_MEASURE` e `UNIT_MULT` (`{id, name}`, por exemplo
  `UNIT_MULT 3 = Thousands`), lidos dos atributos SDMX de série e de dataset da OIT.
  Ficam de fora, nunca adivinhados, quando a mensagem da fonte não os determina. Antes,
  um número de emprego temporário do Brasil saía como `102453.886` sem dizer que era em
  milhares. No modo `detailed`, `notices` resume `UNIT_MEASURE` e `UNIT_MULT`. (#33)
- **Contrato de saída com forma de cliente:** os testes deixam o `Client` do SDK validar o
  resultado contra o esquema listado e provam que um resultado quebrado entre servidor e
  cliente faz a chamada falhar. (#33)

### Corrigido

- Teste do pacote aceita o formato de `npm pack --json` do npm 12. (#32)

## [1.2.1] — 2026-10-02

### Alterado

- Só empacotamento: a página do npm passa a mostrar o README em inglês. O par em
  português vira `LEIA-ME.md` (o npm empacota todo `README*` da raiz e exibia o
  traduzido); um teste prende o tarball a um único `README.md`. Superfície igual. (#31)

## [1.2.0] — 2026-10-02

### Alterado

- **`search` e `fetch` recusam chave desconhecida** (`@sbissoli/mcp-search` 0.9.0, com
  `z.strictObject`): publicam `additionalProperties: false` e o erro nomeia a chave, em
  vez de descartá-la calado — a mesma classe já fechada nas tools `ilo_*` em 11/09. A
  trava regravou só esses dois esquemas. (#30)
- **Classe do erro na telemetria pelo TIPO da falha, não pela frase** (#24); o 422 da OIT
  é `contrato`, e a mensagem para de mandar repetir (#26); `search`/`fetch` com a classe
  pelo tipo (`@sbissoli/mcp-search` 0.8.0, #27); erro de uso também sai com a classe
  declarada (#28).

### Adicionado

- **Trava da superfície** (`surface.lock.json`): superfície que muda sem subir a versão
  reprova o build e recusa o deploy. (#29)

### Segurança

- `undici` 7.29.1 e `wrangler` 4.145.0 (#25); dependências do grupo minor/patch (#23).

## [1.1.0] — 2026-09-27

### Adicionado

- **Fetch comum do portfólio** (`@sbissoli/mcp-upstream` 0.3.0) em toda chamada à OIT, e
  bloco de proveniência no contrato **v1.1** (`@sbissoli/mcp-provenance` 0.2.0) com
  `retrieval`: idas, tentativas, anomalias superadas e `unstable`; `null` quando a
  resposta não tocou a OIT. O `outputSchema` passa a publicar a forma real de
  `provenance` em vez de `{}`. Timeout e falha de rede viram erro de tool legível. (#22)
- Primeira política de rede, medida contra a API viva em 27/09/2026: 65 s por tentativa
  (acima dos ~61 s em que o gateway da OIT recusa consulta irrestrita com 504), até 3
  tentativas em 5xx, 429 e erro de rede, 70 s no total; 504, 404 e timeout não se
  repetem. (#22)

### Corrigido

- O manifesto do LobeHub passa a ser preso à superfície servida — a ficha estava na 0.5.0
  com o npm na 1.0.0. (#21)

## [1.0.0] — 2026-09-25

Primeira major. A superfície (6 tools, 3 resources, 3 prompts, `outputSchema` e os gates de
contrato de saída) é a da 0.6.0 byte a byte; o número diz que ela passa a ser contrato:
mudança que quebre chamador vira major. Cobre tudo desde a 0.6.1 — a 0.7.0 e a 0.8.0
foram numeradas e nunca publicadas. (#20)

### Alterado

- **A busca casa o INÍCIO de uma palavra, nunca o miolo** (`ilo_search_indicators` e o
  índice de `search`): `LIKE '%termo%'` fazia `formal` casar dentro de `informal`. Os dois
  caminhos (D1 no Worker, memória no stdio) respondem igual; 7 de 22 casos novos falhavam
  no código anterior. (#16)

### Corrigido

- Telemetria: exceção de runtime vira classe `defeito`, não `outro` (#17, #18); a recusa de
  esquema, a ferramenta inexistente e o método inexistente — três respostas HTTP 200 —
  deixam de sumir da contagem (#19).

### Segurança

- zod 4.6.5, agents 0.23.0, wrangler 4.134.0, vitest 5.0.1 e tipos. (#15)

## [0.6.1] — 2026-09-16

### Alterado

- A mecânica do vocabulário sobe para `@sbissoli/mcp-search` 0.5.0. (#14)
- Telemetria grava os métodos de protocolo, como o sih, e ganha id de sessão e nome do
  cliente (blobs 9 e 10), com `DELETE` uniforme.
- Dependências do grupo minor/patch (#13); baseline de produção da 0.6.0, idêntico ao
  stdio byte a byte (#12).

## [0.6.0] — 2026-09-14

### Alterado

- **Contrato de entrada mais estrito** (no `main` desde 11/09, publicado aqui): chave
  desconhecida é RECUSADA nas tools `ilo_*` (`additionalProperties: false`), e
  `REF_AREA` passa a ser exigido no esquema de `ilo_get_data`, não só na prosa — o modelo
  lia o esquema, e a chamada sem área derrubava o gateway da OIT em 504.

### Adicionado

- **A busca fala a língua de quem pergunta:** tabela de vocabulário medida nos 1.212
  dataflows (`wages` → earnings, `informality` → informal, `gender` → sex…), a tradução
  dita na resposta (`vocabulary_notes`) e um `hint` quando a busca dá zero. Pares sem dado
  na OIT (`telework`, `gig work`) seguem em zero de propósito. (#11)
- README com "Questions it answers", a tabela do vocabulário e comparação com Rilostat,
  sdmx1, pandaSDMX, DBnomics e a API crua; `docs/alternatives.md` com os números medidos.
  (#11)
- Telemetria grava a FORMA da chamada (classe do erro e nomes dos parâmetros); rota
  privada do dono, para o uso próprio parar de virar adoção; auditoria semanal do
  mcpscore.

### Corrigido

- `search` e `fetch` gravavam classe e parâmetros vazios na telemetria.

### Segurança

- `sharp` 0.35.4 por override (libheif, alerta high do Dependabot, #8); vitest 5 com vite 8
  como peer explícito; dependências (#2, #5).

## [0.5.0] — 2026-09-03

### Adicionado

- **`search` e `fetch`** — o contrato Deep Research do ChatGPT sobre o catálogo do ILOSTAT.
- Landing indexável, com o produto também em português; `robots.txt`, `sitemap.xml` e
  IndexNow; rota `/.well-known/mcpindex-challenge` para o claim do mcpindex.ai.
- Baselines de superfície (dump normalizado do stdio e de produção).

### Alterado

- Piso de Node sobe para `>=22`; TypeScript 7.0.2; `agents` 0.22.0, zod 4.5.4; Dependabot
  com as Actions agrupadas.

### Corrigido

- `description` do `server.json` dentro dos 100 caracteres do MCP Registry, com gate.

## [0.4.0] — 2026-08-30

### Adicionado

- **mcpscore vira contrato:** catraca contra regressão de qualidade no CI, com piso
  medido para o stdio e para produção.
- `websiteUrl` no handshake, preso ao manifesto.

### Corrigido

- Valida `Origin` (403) e recusa cursor de paginação inválido; `server/discover` anuncia
  todas as revisões atendidas.

### Alterado

- Uma geração só do SDK na árvore e `@types/node` atual; o `ROADMAP.md` passa a ficar
  local, como nos repositórios irmãos.

## [0.3.2] — 2026-08-29

### Adicionado

- Deploy contínuo do Worker, com guarda de versão; ícone declarado (rota própria,
  `serverInfo` e `server.json`).

### Corrigido

- Versão dessincronizada e título da landing, com guarda; uma convenção só para a versão,
  com mecanismo (o hook `version`) e teste.
- O smoke distingue a OIT fora do ar de falha nossa, em vez de morrer com `TypeError`.
- `description` do registro de 100 para 88 caracteres, com folga contra o limite duro.

## [0.3.1] — 2026-08-27

### Adicionado

- O `server.json` declara o caminho de instalação por npm no MCP Registry.
- `publish.yml` publica no npm antes do registro, por trusted publishing (OIDC) (#1).
- Telemetria de tool calls no Analytics Engine (dataset `ilo_mcp_tool_calls`).
- Teste de contrato dos dataflows curados contra o SDMX real, em cron semanal.
- Badge da Smithery nos READMEs, links de diretórios na landing e aviso de não-afiliação
  com a OIT no topo dos READMEs.

## [0.3.0] — 2026-08-19

Primeira versão no npm (`ilo-mcp-server`, `npx`), publicada a partir do commit que tornou
o pacote publicável (`b9b26fc`: `agents` em devDependencies, `mcpName` para o registro,
READMEs com o uso por `npx`).

### Adicionado

- **Resources** estáticas: `ilostat://guide`, `ilostat://reference/key-dataflows` e
  `ilostat://reference/provenance`.
- **Prompts:** `ilo_country_labour_profile`, `ilo_compare_countries` e
  `ilo_indicator_trend`.
- Descrições mais ricas para `ilo_search_indicators` e `ilo_list_dimension_values`;
  `GET /status` com as contagens de resources e prompts; `npm run manifest:lhm`; todo id de
  dataflow citado nas resources e prompts é conferido contra o seed do catálogo.
