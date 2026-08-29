/**
 * O ícone do servidor é declarado em TRÊS lugares que não podem discordar:
 *
 *   1. `src/icon.ts`   — os bytes, em base64, servidos pela rota `/icon.png`.
 *      É a FONTE: não há cópia em `assets/`;
 *   2. `src/server.ts` — `serverInfo.icons`, o que todo cliente MCP vê no
 *      handshake;
 *   3. `server.json`   — o que o MCP Registry publica e o que os diretórios
 *      espelham (`icons[0]`).
 *
 * POR QUE ISTO EXISTE. No senado-br-mcp-cloudflare só (2) declarava o ícone: o
 * `server.json` ficava calado, e o registry — logo, o mcpindex.ai, que tira dele
 * o snapshot — acreditava que o servidor não tinha ícone, descontando 5 pontos
 * de um servidor que tinha um perfeitamente bom. Corrigido lá, o modo de falha
 * inverte: alguém edita um dos dois e não o outro, e o handshake passa a
 * anunciar uma imagem diferente da dos diretórios. Nenhum lado dá erro; eles só
 * discordam em silêncio.
 *
 * `mimeType` e `sizes` são conferidos contra o cabeçalho IHDR REAL do PNG. Um
 * manifesto que anuncia 512x512 servindo outra coisa é a mesma classe de mentira
 * que o output-contract pega nas respostas das tools.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ICON_PNG_BASE64 } from "../src/icon.js";

const raiz = join(__dirname, "..");
const bytesDoIcone = (): Buffer => Buffer.from(ICON_PNG_BASE64, "base64");

/** Dimensões lidas do cabeçalho IHDR do PNG — sem dependência de imagem. */
function dimensoesPng(buf: Buffer): { largura: number; altura: number } {
  if (buf.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error("não é um PNG");
  }
  return { largura: buf.readUInt32BE(16), altura: buf.readUInt32BE(20) };
}

interface ManifestoIcone {
  src: string;
  mimeType?: string;
  sizes?: string[];
}

const manifesto = (): ManifestoIcone[] | undefined =>
  (JSON.parse(readFileSync(join(raiz, "server.json"), "utf8")) as { icons?: ManifestoIcone[] })
    .icons;

describe("ícone do servidor: bytes × serverInfo × manifesto × rota", () => {
  it("os bytes embutidos são um PNG válido, e são a única cópia", () => {
    expect(() => dimensoesPng(bytesDoIcone())).not.toThrow();
    // Uma cópia em assets/ reintroduziria a deriva que o arranjo de fonte
    // única existe para eliminar.
    expect(
      () => readFileSync(join(raiz, "assets", "icon.png")),
      "voltou a existir uma segunda cópia do ícone — src/icon.ts é a fonte única",
    ).toThrow();
  });

  it("server.json e serverInfo declaram a MESMA URL", () => {
    const icone = manifesto()?.[0];
    expect(
      icone,
      "server.json precisa declarar icons — são 5 pontos de completeness nos diretórios",
    ).toBeDefined();
    const serverTs = readFileSync(join(raiz, "src", "server.ts"), "utf8");
    expect(
      serverTs,
      "serverInfo.icons e server.json apontam para imagens diferentes",
    ).toContain(icone!.src);
  });

  it("a URL declarada é servida pelo próprio domínio, em rota pública", () => {
    expect(manifesto()![0]!.src).toBe("https://ilo.sidneybissoli.com/icon.png");
    const indexTs = readFileSync(join(raiz, "src", "index.ts"), "utf8");
    // Pública e ANTES de qualquer auth: quem busca o ícone é o crawler do
    // diretório, nunca um cliente autenticado.
    expect(indexTs).toContain('url.pathname === "/icon.png"');
  });

  it("mimeType e sizes descrevem a imagem que existe, não uma promessa", () => {
    const { largura, altura } = dimensoesPng(bytesDoIcone());
    expect(manifesto()![0]!.mimeType).toBe("image/png");
    expect(manifesto()![0]!.sizes).toEqual([`${largura}x${altura}`]);
  });

  it("o ícone cabe no teto de 1 MB do Smithery", () => {
    expect(bytesDoIcone().byteLength).toBeLessThan(1024 * 1024);
  });
});
