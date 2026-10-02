/**
 * Impressão digital da superfície (@sbissoli/mcp-surface): mudou sem subir a
 * versão = vermelho, e o deploy não roda (deploy-worker.yml roda `npm test`
 * antes do wrangler). Duas seções no `surface.lock.json`:
 *
 *  - `declarada`: `initialize` (instructions, capabilities, identidade sem a
 *    versão) + tools/resources/templates/prompts, do `buildServer` — o MESMO
 *    que o Worker e a CLI stdio usam;
 *  - `semToken`: quais métodos respondem sem credencial em `/mcp` e na rota
 *    privada do dono, com `API_KEY` ausente (produção) e presente. Nenhuma
 *    listagem mostra isso; só a borda HTTP sabe medir.
 *
 * Ao mudar a superfície: `npm version <nível> --no-git-tag-version` e
 * `npm run surface:lock`. A trava recusa regravar sob a versão antiga.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  CABECALHOS_MCP,
  capturarSuperficie,
  comHost,
  conferirSecao,
  corpoDoPedido,
  ipDaSonda,
  medirSemToken,
  sondaSemToken,
} from "@sbissoli/mcp-surface";
import { describe, expect, it } from "vitest";

import { SELF_ROUTE } from "../src/analytics.js";
import worker from "../src/index.js";
import { buildServer } from "../src/server.js";
import type { Env } from "../src/types.js";

const raiz = fileURLToPath(new URL("../", import.meta.url).href);
const trava = `${raiz}surface.lock.json`;
const versao = (JSON.parse(readFileSync(`${raiz}package.json`, "utf8")) as { version: string }).version;

const HOST = "ilo.sidneybissoli.com";
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
const envs: Record<string, Env> = {
  apiKeyAusente: {} as Env,
  apiKeyPresente: { API_KEY: "chave-da-sonda" } as Env,
};

// `tools/call` sem binding de catálogo responde na hora com resultado de erro
// ("binding CATALOG_DB ausente") — não vai à rede do ILOSTAT, e o que se mede é se
// a borda deixou a chamada chegar à tool, não o que a tool achou.
const sonda = sondaSemToken({ name: "ilo_search_indicators", arguments: { query: "unemployment" } });

const medirBorda = () =>
  medirSemToken(Object.keys(envs), ["POST /mcp", `POST ${SELF_ROUTE}`], sonda, (config, rota, pedido) =>
    worker.fetch(
      comHost(
        new Request(`https://${HOST}${rota.slice("POST ".length)}`, {
          method: "POST",
          headers: { ...CABECALHOS_MCP, "CF-Connecting-IP": ipDaSonda() },
          body: corpoDoPedido(pedido),
        }),
        HOST,
      ),
      envs[config]!,
      ctx,
    ),
  );

describe("surface.lock.json", () => {
  it("superfície declarada bate com a trava, ou a versão subiu junto", async () => {
    const v = conferirSecao(trava, "declarada", await capturarSuperficie(buildServer({} as Env)), versao);
    expect(v.ok, v.mensagem).toBe(true);
  });

  it("quem responde sem token bate com a trava, ou a versão subiu junto", async () => {
    const m = await medirBorda();
    // Sanidade ANTES de conferir — e, no modo de escrita, antes de GRAVAR: uma
    // sonda quebrada (tudo false, ou tudo true) não pode virar trava. Já
    // aconteceu: com o dublê errado, `npm run surface:lock` gravou tudo false
    // e só o teste seguinte, rodando depois da gravação, reclamou.
    const aberta = m["apiKeyAusente"]?.["POST /mcp"];
    const fechada = m["apiKeyPresente"]?.["POST /mcp"];
    expect(aberta?.["tools/list"], "sonda quebrada: sem API_KEY, tools/list tem de responder").toBe(true);
    expect(aberta?.["tools/call"], "sonda quebrada: sem API_KEY, a tool local tem de responder").toBe(true);
    expect(fechada?.["tools/list"], "sonda quebrada: com API_KEY e sem token, tools/list não pode responder").toBe(false);
    const v = conferirSecao(trava, "semToken", m, versao);
    expect(v.ok, v.mensagem).toBe(true);
  }, 60_000);
});
