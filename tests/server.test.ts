import { describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/server";
import { buildServer, withUsage } from "../src/server.js";
import { TOOL_NAMES } from "../src/tools/index.js";
import type { UsageKind } from "../src/usage-core.js";

describe("buildServer", () => {
  it("constrói um McpServer com as 4 tools do MVP", () => {
    expect(buildServer({})).toBeInstanceOf(McpServer);
  });

  it("nomes de tool respeitam o teto de 64 chars do diretório", () => {
    for (const name of TOOL_NAMES) expect(name.length).toBeLessThanOrEqual(64);
  });

  it("são exatamente as 4 tools do docs/01", () => {
    expect([...TOOL_NAMES].sort()).toEqual(
      ["ilo_get_data", "ilo_get_indicator_metadata", "ilo_list_dimension_values", "ilo_search_indicators"].sort(),
    );
  });
});

describe("withUsage", () => {
  function recorder() {
    const events: Array<{ kind: UsageKind; name?: string | undefined }> = [];
    return { events, record: (kind: UsageKind, name?: string) => events.push({ kind, name }) };
  }

  it("registra tool_call em sucesso", async () => {
    const { events, record } = recorder();
    const wrapped = withUsage("t", record, async (_: unknown) => ({ ok: true }));
    await wrapped(undefined);
    expect(events).toEqual([{ kind: "tool_call", name: "t" }]);
  });

  it("registra tool_error quando o resultado tem isError (caminho dos erros pedagógicos)", async () => {
    const { events, record } = recorder();
    const wrapped = withUsage("t", record, async (_: unknown) => ({ isError: true }));
    await wrapped(undefined);
    expect(events.map((e) => e.kind)).toEqual(["tool_call", "tool_error"]);
  });

  it("registra tool_error e relança quando o handler lança", async () => {
    const { events, record } = recorder();
    const wrapped = withUsage("t", record, async (_: unknown): Promise<{ isError?: boolean }> => {
      throw new Error("boom");
    });
    await expect(wrapped(undefined)).rejects.toThrow("boom");
    expect(events.map((e) => e.kind)).toEqual(["tool_call", "tool_error"]);
  });
});
