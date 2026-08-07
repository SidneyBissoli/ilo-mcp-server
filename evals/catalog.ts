/**
 * Catálogo vivo das tools para os evals de seleção (@sbissoli/mcp-evals).
 * Um grupo por módulo de src/tools/ — grupo faltando encolhe o eval em silêncio.
 */

import { buildCatalog, type CatalogGroup, type CapturingServer } from "@sbissoli/mcp-evals";
import type { McpServer } from "@modelcontextprotocol/server";
import { registerCatalogTools } from "../src/tools/catalog.js";
import { registerDataTools } from "../src/tools/data.js";
import { registerMetadataTools } from "../src/tools/metadata.js";
import type { Env } from "../src/types.js";

const ENV: Env = {}; // registro não executa handlers — bindings não são tocados
const NOOP = () => {};

const asServer = (s: CapturingServer) => s as unknown as McpServer;

const GROUPS: CatalogGroup[] = [
  { area: "catalogo", register: (s) => registerCatalogTools(asServer(s), ENV, NOOP) },
  { area: "metadados", register: (s) => registerMetadataTools(asServer(s), ENV, NOOP) },
  { area: "dados", register: (s) => registerDataTools(asServer(s), ENV, NOOP) },
];

export const CATALOG = buildCatalog(GROUPS);
