import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { CONTRACT_VERSION } from "@sbissoli/mcp-provenance";
import { SERVER_CONFIG } from "../src/config.js";
import { buildServer } from "../src/server.js";
import { buildStatus } from "../src/status.js";
import { TOOL_NAMES } from "../src/tools/index.js";

describe("buildStatus", () => {
  it("sem binding version_metadata → sem bloco deploy", () => {
    const status = buildStatus({});
    expect(status).toEqual({
      status: "ok",
      name: SERVER_CONFIG.name,
      version: SERVER_CONFIG.version,
      mcp: SERVER_CONFIG.mcpRoute,
      tools: TOOL_NAMES.length,
      tool_names: [...TOOL_NAMES],
      provenance_contract: CONTRACT_VERSION,
    });
  });

  it("tools/tool_names batem com o que o servidor anuncia em tools/list (fonte dos badges)", async () => {
    const server = buildServer({});
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "status-test", version: "0.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const { tools } = await client.listTools();
    const status = buildStatus({});
    expect(tools.map((t) => t.name).sort()).toEqual([...status.tool_names].sort());
    expect(status.tools).toBe(tools.length);
    await client.close();
  });

  it("com binding → bloco deploy com id/tag/timestamp", () => {
    const status = buildStatus({
      CF_VERSION_METADATA: { id: "abc123", tag: "", timestamp: "2026-08-06T12:00:00Z" },
    });
    expect(status).toMatchObject({
      deploy: { id: "abc123", tag: null, timestamp: "2026-08-06T12:00:00Z" },
    });
  });
});
