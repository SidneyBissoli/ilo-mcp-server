/**
 * A lista de Origins aceitos (src/origin.ts) — o achado de severidade HIGH da
 * varredura de 29/08/2026.
 *
 * O servidor respondia 200 a requisição com `Origin` estrangeiro porque o
 * handler recebia `allowedOriginHostnames: "*"` sempre que ALLOWED_ORIGIN era
 * "*", e "*" DESLIGA a validação. O teste prende as duas metades da correção:
 * a lista não é "*" (senão a validação volta a não existir) e ela contém os
 * hostnames que o servidor de fato serve — a mesma lista do header Host, para
 * as duas defesas não divergirem em silêncio.
 */

import { describe, expect, it } from "vitest";

import { SERVER_CONFIG } from "../src/config.js";
import { allowedOriginHostnames, origemAceita } from "../src/origin.js";

const req = (headers: Record<string, string> = {}): Request =>
  new Request("https://ilo.sidneybissoli.com/mcp", { method: "POST", headers });

describe("allowedOriginHostnames", () => {
  it("com CORS aberto, a lista NÃO vira '*' — é a lista do header Host", () => {
    const lista = allowedOriginHostnames("*");
    expect(lista).toEqual([...SERVER_CONFIG.extraAllowedHostnames]);
    // A regressão que este teste existe para pegar: qualquer forma de "*" na
    // lista faz o handler dispensar a validação inteira.
    expect(lista).not.toContain("*");
  });

  it("ALLOWED_ORIGIN ausente cai na mesma lista", () => {
    expect(allowedOriginHostnames(undefined)).toEqual([...SERVER_CONFIG.extraAllowedHostnames]);
  });

  it("origem concreta entra pelo hostname, sem esquema nem porta duplicada", () => {
    const lista = allowedOriginHostnames("https://app.exemplo.org");
    expect(lista).toContain("app.exemplo.org");
    expect(lista).toContain("ilo.sidneybissoli.com");
  });

  it("origem já listada não duplica", () => {
    const lista = allowedOriginHostnames("https://ilo.sidneybissoli.com");
    expect(lista.filter((h) => h === "ilo.sidneybissoli.com")).toHaveLength(1);
  });

  it("ALLOWED_ORIGIN mal formado não vira permissão silenciosa", () => {
    expect(allowedOriginHostnames("nao-e-url")).toEqual([...SERVER_CONFIG.extraAllowedHostnames]);
    // Esquema que não é http(s) não descreve origem de navegador.
    expect(allowedOriginHostnames("javascript:alert(1)")).toEqual([...SERVER_CONFIG.extraAllowedHostnames]);
  });

  it("o domínio próprio e o workers.dev estão na lista — o default do handler deixaria ambos de fora", () => {
    const lista = allowedOriginHostnames("*");
    expect(lista).toContain("ilo.sidneybissoli.com");
    expect(lista.some((h) => h.endsWith(".workers.dev"))).toBe(true);
  });
});

describe("origemAceita", () => {
  const lista = allowedOriginHostnames("*");

  it("sem header Origin → aceita (é todo cliente MCP que não é navegador)", () => {
    expect(origemAceita(req(), lista)).toBe(true);
  });

  it("origem própria → aceita", () => {
    expect(origemAceita(req({ Origin: "https://ilo.sidneybissoli.com" }), lista)).toBe(true);
  });

  it("origem estrangeira → não aceita (segue para o 403 do handler)", () => {
    expect(origemAceita(req({ Origin: "https://evil.example" }), lista)).toBe(false);
  });

  it("Origin ilegível não é tratado como ausente", () => {
    expect(origemAceita(req({ Origin: "null" }), lista)).toBe(false);
  });
});
