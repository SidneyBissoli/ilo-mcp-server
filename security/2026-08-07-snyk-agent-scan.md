# Gate de segurança — Snyk Agent Scan (2026-08-07)

Gate de submissão ao diretório (Fase 3 do projeto ilostat).

## Resultado

**PASSOU** — nenhum achado de análise, nenhuma falha de runtime.

- Scanner: `snyk-agent-scan` v0.5.16 (via `uvx`), autenticado (SNYK_TOKEN).
- Modo: `--ci` (exit code ≠ 0 se houver achado) → **exit 0**.
- Alvo: as 4 tools reais de produção (`ilo_search_indicators`,
  `ilo_get_indicator_metadata`, `ilo_list_dimension_values`, `ilo_get_data`),
  enumeradas com sucesso; sem prompts, resources ou resource templates.
- Evidência bruta: `2026-08-07-snyk-agent-scan.json` (contém também o
  `uis-mcp-server`, escaneado na mesma rodada).

## Desvio documentado: ponte stdio→HTTP

O `snyk-agent-scan` só lança servidores **stdio locais** a partir de um arquivo
de configuração MCP. Este servidor é **remoto-only** (decisão do decisor,
07/08/2026 — sem versão híbrida stdio). O gate foi executado apontando o
scanner para uma ponte stdio local que apenas proxeia o endpoint de produção:

```json
{
  "mcpServers": {
    "ilo-mcp-server": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://ilo.sidneybissoli.com/mcp"]
    }
  }
}
```

O scanner enxerga, portanto, as tools reais servidas em produção — que é o que
o gate audita. A ponte (`mcp-remote` 0.1.37) conectou via
StreamableHTTPClientTransport e repassou `initialize`, `tools/list`,
`prompts/list`, `resources/list` e `resources/templates/list` sem erro.
