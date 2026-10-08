# Changelog

Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). Versões
seguem o `package.json` (espelhado em `server.json`, `src/config.ts` e
`lhm.plugin.json` pelo hook `version`). Uma versão = um deploy em
`https://ilo.sidneybissoli.com` e uma publicação no npm (`ilo-mcp-server`,
runtime stdio) e no MCP Registry. Este arquivo nasceu na 1.4.0; o histórico
anterior está no `ROADMAP.md` e nos PRs.

## [1.4.2] — 2026-10-07

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

## [1.4.0] — 2026-10-05

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
