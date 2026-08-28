import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { SERVER_CONFIG } from "../src/config";

/**
 * A versão vive em package.json e é ESPELHADA em três lugares: SERVER_CONFIG
 * (handshake MCP e /status), server.json (o registro oficial) e o packages[]
 * dentro dele (o pacote npm que a ficha anuncia).
 *
 * Espelho sem guarda diverge em silêncio. Foi o que aconteceu ao publicar a
 * 0.3.1 em 2026-08-27: o package.json subiu, o SERVER_CONFIG ficou em 0.3.0, e
 * o servidor passou a reportar uma versão que não existia mais. Nada quebrou,
 * ninguém viu — que é exatamente o defeito.
 *
 * O teste não pina número nenhum: compara os espelhos com a fonte.
 */
describe("versão sincronizada entre package.json, config e server.json", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const srv = JSON.parse(readFileSync(new URL("../server.json", import.meta.url), "utf8"));

  it("SERVER_CONFIG espelha a versão do package.json", () => {
    expect(SERVER_CONFIG.version).toBe(pkg.version);
  });

  it("server.json espelha a versão do package.json", () => {
    expect(srv.version).toBe(pkg.version);
  });

  it("o pacote npm declarado em server.json aponta para esta versão", () => {
    // packages[] é opcional: um servidor só-remoto não declara caminho npm.
    // Quando declara, a versão tem de existir — o registro oficial recusa a
    // publicação se o pacote não estiver no npm NA VERSÃO DECLARADA.
    const npmPkg = (srv.packages ?? []).find(
      (p: { registryType?: string }) => p.registryType === "npm",
    );
    if (!npmPkg) return;
    expect(npmPkg.identifier).toBe(pkg.name);
    expect(npmPkg.version).toBe(pkg.version);
  });

  it("o nome do servidor espelha o nome do pacote", () => {
    expect(SERVER_CONFIG.name).toBe(pkg.name);
  });
});
