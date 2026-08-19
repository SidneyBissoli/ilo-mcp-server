/**
 * Regenera os blocos `tools`, `resources` e `prompts` de lhm.plugin.json (LobeHub)
 * a partir do servidor REAL (tools/list, resources/list, prompts/list pelo
 * transporte em memória) e sincroniza `version` com package.json. Rodar após
 * mudar qualquer tool/resource/prompt: `npx tsx scripts/gen-lhm-manifest.mts`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { buildServer } from "../src/server.js";

const server = buildServer({});
const [ct, st] = InMemoryTransport.createLinkedPair();
const client = new Client({ name: "gen-lhm-manifest", version: "0.0.0" });
await Promise.all([server.connect(st), client.connect(ct)]);

const { tools } = await client.listTools();
const { resources } = await client.listResources();
const { prompts } = await client.listPrompts();
await client.close();

const pkg = JSON.parse(readFileSync("package.json", "utf-8")) as { version: string };
const manifest = JSON.parse(readFileSync("lhm.plugin.json", "utf-8")) as Record<string, unknown>;
manifest.version = pkg.version;
manifest.tools = tools;
manifest.resources = resources;
manifest.prompts = prompts;
writeFileSync("lhm.plugin.json", JSON.stringify(manifest, null, 2) + "\n");
console.log(`lhm.plugin.json: v${pkg.version}, ${tools.length} tools, ${resources.length} resources, ${prompts.length} prompts`);
