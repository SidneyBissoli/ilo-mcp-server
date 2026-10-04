/**
 * Server card (`/.well-known/mcp/server-card.json`, @sbissoli/mcp-surface/card):
 * público (nem a API_KEY o tranca), com a versão do package.json, e a MESMA
 * superfície da seção `declarada` do surface.lock.json — o card não pode
 * divergir da trava.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { impressaoDigital, lerTrava, normalizarSuperficie } from "@sbissoli/mcp-surface";
import { superficieDoCard } from "@sbissoli/mcp-surface/card";
import { describe, expect, it } from "vitest";

import worker from "../src/index.js";
import type { Env } from "../src/types.js";

const raiz = fileURLToPath(new URL("../", import.meta.url).href);
const versao = (JSON.parse(readFileSync(`${raiz}package.json`, "utf8")) as { version: string }).version;
const trava = lerTrava(`${raiz}surface.lock.json`);

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

async function pedirCard(env: Env): Promise<Response> {
  return worker.fetch(new Request("https://ilo.sidneybissoli.com/.well-known/mcp/server-card.json"), env, ctx);
}

describe("GET /.well-known/mcp/server-card.json", () => {
  it("responde 200 em JSON, sem token mesmo com API_KEY definida", async () => {
    const res = await pedirCard({ API_KEY: "chave-do-teste" } as Env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json");
  });

  it("serverInfo.version é a do package.json", async () => {
    const card = (await (await pedirCard({} as Env)).json()) as { serverInfo: { name: string; version: string } };
    expect(card.serverInfo.version).toBe(versao);
  });

  it("superfície normalizada do card tem o sha256 da seção declarada da trava", async () => {
    const card = (await (await pedirCard({} as Env)).json()) as Record<string, unknown>;
    const sha = trava.declarada?.sha256;
    expect(sha).toBeTypeOf("string");
    expect(impressaoDigital(normalizarSuperficie(superficieDoCard(card)))).toBe(sha);
  });

  it("authentication.required é false — a trava mediu tools/list aberto sem API_KEY", async () => {
    const semToken = trava.semToken?.conteudo as Record<string, Record<string, Record<string, boolean>>>;
    expect(semToken["apiKeyAusente"]?.["POST /mcp"]?.["tools/list"]).toBe(true);
    const card = (await (await pedirCard({} as Env)).json()) as { authentication: { required: boolean } };
    expect(card.authentication).toEqual({ required: false });
  });
});
