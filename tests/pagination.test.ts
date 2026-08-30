/**
 * O guarda de cursor (src/pagination.ts) e a PREMISSA que o sustenta.
 *
 * A recusa "todo cursor é inválido" só é honesta enquanto nenhuma lista deste
 * servidor paginar. Por isso o primeiro bloco não testa o guarda: testa o
 * servidor REAL, pelo transporte em memória, para ver se alguma lista passou a
 * devolver `nextCursor`. No dia em que passar, este teste quebra e o guarda tem
 * de mudar junto — em vez de recusar em silêncio a segunda página que o próprio
 * servidor emitiu.
 */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";

import {
  INVALID_PARAMS,
  PAGINATED_LIST_METHODS,
  cursorRejection,
  unknownCursorError,
} from "../src/pagination.js";
import { buildServer } from "../src/server.js";

describe("premissa: nenhuma lista deste servidor pagina", () => {
  let client: Client;

  beforeAll(async () => {
    const server = buildServer({});
    const [ct, st] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "pagination", version: "0.0.0" });
    await Promise.all([server.connect(st), client.connect(ct)]);
  });
  afterAll(async () => {
    await client.close();
  });

  it("as quatro listas cabem numa página só — nenhuma devolve nextCursor", async () => {
    const paginas = [
      await client.listTools(),
      await client.listResources(),
      await client.listResourceTemplates(),
      await client.listPrompts(),
    ];
    for (const pagina of paginas) {
      expect(
        (pagina as { nextCursor?: string }).nextCursor,
        "uma lista passou a paginar — a recusa de src/pagination.ts deixou de valer",
      ).toBeUndefined();
    }
  });
});

describe("unknownCursorError", () => {
  const requisicao = (method: string, params?: Record<string, unknown>) => ({
    jsonrpc: "2.0",
    id: 7,
    method,
    ...(params ? { params } : {}),
  });

  it("recusa os quatro métodos de lista com -32602, preservando o id", () => {
    for (const method of PAGINATED_LIST_METHODS) {
      const erro = unknownCursorError(requisicao(method, { cursor: "invalido" }));
      expect(erro?.error.code).toBe(INVALID_PARAMS);
      expect(erro?.id).toBe(7);
      expect(erro?.error.message).toContain(method);
    }
  });

  it("deixa passar a lista sem cursor — o caso normal", () => {
    for (const method of PAGINATED_LIST_METHODS) {
      expect(unknownCursorError(requisicao(method))).toBeUndefined();
      expect(unknownCursorError(requisicao(method, {}))).toBeUndefined();
    }
  });

  it("cursor vazio ou nulo também é cursor: recusado, não ignorado", () => {
    expect(unknownCursorError(requisicao("tools/list", { cursor: "" }))?.error.code).toBe(INVALID_PARAMS);
    expect(unknownCursorError(requisicao("tools/list", { cursor: null }))?.error.code).toBe(INVALID_PARAMS);
  });

  it("não se mete com o que não é requisição de lista", () => {
    expect(unknownCursorError(requisicao("tools/call", { cursor: "x" }))).toBeUndefined();
    expect(unknownCursorError(requisicao("initialize", { cursor: "x" }))).toBeUndefined();
    // Notificação (sem id): não há resposta a devolver.
    expect(unknownCursorError({ jsonrpc: "2.0", method: "tools/list", params: { cursor: "x" } })).toBeUndefined();
    // Lote e lixo ficam com o SDK, que já tem erro próprio para eles.
    expect(unknownCursorError([requisicao("tools/list", { cursor: "x" })])).toBeUndefined();
    expect(unknownCursorError("tools/list")).toBeUndefined();
    expect(unknownCursorError(null)).toBeUndefined();
    expect(unknownCursorError({ id: 1, method: "tools/list", params: { cursor: "x" } })).toBeUndefined();
  });
});

describe("cursorRejection (borda HTTP)", () => {
  const post = (body: unknown): Request =>
    new Request("https://ilo.sidneybissoli.com/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

  it("responde 200 com o erro JSON-RPC no corpo — a falha é de protocolo", async () => {
    const req = post({ jsonrpc: "2.0", id: 1, method: "prompts/list", params: { cursor: "x" } });
    const res = await cursorRejection(req, "*");
    expect(res?.status).toBe(200);
    expect(res?.headers.get("Content-Type")).toBe("application/json");
    expect(res?.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const corpo = (await res!.json()) as { error: { code: number } };
    expect(corpo.error.code).toBe(INVALID_PARAMS);
  });

  it("lê uma cópia: o corpo original segue disponível para o handler", async () => {
    const req = post({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(await cursorRejection(req, "*")).toBeUndefined();
    expect(req.bodyUsed).toBe(false);
    expect(((await req.json()) as { method: string }).method).toBe("tools/list");
  });

  it("corpo que não é JSON não é assunto deste guarda", async () => {
    expect(await cursorRejection(post("nao e json"), "*")).toBeUndefined();
  });
});
