/**
 * O SITE do servidor é declarado em três lugares que não podem discordar:
 *
 *   1. `server.json`   — o que o MCP Registry publica e os diretórios espelham
 *      (`websiteUrl`, um dos eixos de completeness do mcpindex/Smithery);
 *   2. `package.json`  — `homepage`, o que o npm mostra;
 *   3. `src/config.ts` — `SERVER_CONFIG.websiteUrl`, que `src/server.ts` põe em
 *      `serverInfo.websiteUrl` e todo cliente MCP vê no handshake.
 *
 * POR QUE ISTO EXISTE. Até 30/08/2026 só (1) e (2) declaravam: o handshake
 * calava, e o `mcpscore` reprovava `server_websiteurl_present` nos dois
 * transportes — o mesmo par desalinhado que o ícone teve. O modo de falha
 * agora inverte: alguém edita um dos três e não os outros, e o handshake passa
 * a apontar para um site diferente do que os diretórios mostram. Nenhum lado dá
 * erro; eles só discordam em silêncio.
 *
 * A fonte da verificação é o próprio manifesto, nunca uma literal copiada para
 * cá: um teste que fixasse a URL na mão passaria a validar a si mesmo.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SERVER_CONFIG } from "../src/config.js";

const raiz = join(__dirname, "..");

const leJson = (arquivo: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(raiz, arquivo), "utf8")) as Record<string, unknown>;

describe("websiteUrl: manifesto × package × serverInfo", () => {
  it("server.json declara websiteUrl", () => {
    expect(
      leJson("server.json").websiteUrl,
      "server.json sem websiteUrl — é um eixo de completeness nos diretórios",
    ).toBe(SERVER_CONFIG.websiteUrl);
  });

  it("a homepage do package.json é a mesma URL", () => {
    expect(leJson("package.json").homepage).toBe(SERVER_CONFIG.websiteUrl);
  });

  it("o handshake anuncia a URL do config, e não uma literal própria", () => {
    const serverTs = readFileSync(join(raiz, "src", "server.ts"), "utf8");
    expect(
      serverTs,
      "serverInfo precisa levar websiteUrl — sem ele o mcpscore reprova server_websiteurl_present",
    ).toContain("websiteUrl: SERVER_CONFIG.websiteUrl");
  });

  it("é https e sem barra final (o que os diretórios espelham)", () => {
    expect(SERVER_CONFIG.websiteUrl).toMatch(/^https:\/\//);
    expect(SERVER_CONFIG.websiteUrl.endsWith("/")).toBe(false);
  });
});
