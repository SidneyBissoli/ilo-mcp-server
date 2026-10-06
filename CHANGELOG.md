# Changelog

Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). Versões
seguem o `package.json` (espelhado em `server.json`, `src/config.ts` e
`lhm.plugin.json` pelo hook `version`). Uma versão = um deploy em
`https://ilo.sidneybissoli.com` e uma publicação no npm (`ilo-mcp-server`,
runtime stdio) e no MCP Registry. Este arquivo nasceu na 1.4.0; o histórico
anterior está no `ROADMAP.md` e nos PRs.

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
