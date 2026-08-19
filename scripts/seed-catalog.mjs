/**
 * Seed do catálogo de dataflows (D1).
 *
 * Baixa o catálogo oficial completo (`/dataflow/ILO?detail=allstubs`, ~557 KB,
 * ~1.210 dataflows — medição do spike), registra o instante REAL da extração
 * (é o retrieved_at que o bloco de proveniência de ilo_search_indicators reporta) e
 * gera `scripts/seed-catalog.sql` para o `wrangler d1 execute`.
 *
 * Uso:
 *   node scripts/seed-catalog.mjs [catalogo.json]
 *   npx wrangler d1 execute ilostat-catalog --local  --file=scripts/seed-catalog.sql
 *   npx wrangler d1 execute ilostat-catalog --remote --file=scripts/seed-catalog.sql
 *
 * Download via fetch do Node com `Accept-Language: en` explícito: o gateway da
 * OIT responde HTTP 500 ao `Accept-Language: *` que o undici envia por padrão
 * (era isso — não o User-Agent — que fazia o Node parecer rejeitado; 18/08/2026).
 * Com argumento, lê o JSON do arquivo indicado (baixado AGORA — o retrieved_at
 * gravado é o instante da execução).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CATALOG_URL = "https://sdmx.ilo.org/rest/dataflow/ILO?detail=allstubs";
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "seed-catalog.sql");
/**
 * Lista compacta de ids (versionada, ~30 KB): a suíte de testes prova que todo
 * dataflow citado nas resources/prompts existe no catálogo — o SQL completo é
 * gitignorado, então o CI precisa desta lista. Regenerada junto com o SQL.
 */
const IDS_OUT = join(HERE, "..", "tests", "fixtures", "catalog-ids.txt");

// JSON só via header Accept — ?format= é ignorado pelo endpoint (decisão do spike).
let body;
const fileArg = process.argv[2];
if (fileArg) {
  body = readFileSync(fileArg, "utf8");
} else {
  const res = await fetch(CATALOG_URL, {
    headers: {
      Accept: "application/vnd.sdmx.structure+json",
      "Accept-Language": "en",
      "User-Agent": "ilo-mcp-server seed (https://ilo.sidneybissoli.com; sbissoli76@gmail.com)",
    },
  });
  if (!res.ok) throw new Error(`ILOSTAT catalogue HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  body = await res.text();
}
const retrievedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const dataflows = JSON.parse(body).data?.dataflows ?? [];
if (dataflows.length < 100) throw new Error(`catálogo suspeito: só ${dataflows.length} dataflows`);

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const searchWeight = (df) => {
  const a = (df.annotations ?? []).find((x) => (x.type ?? x.id) === "SEARCH_WEIGHT");
  const n = Number(a?.title ?? a?.text);
  return Number.isFinite(n) ? n : 0;
};

const lines = [
  "-- Gerado por scripts/seed-catalog.mjs — não editar à mão.",
  `-- Fonte: ${CATALOG_URL}`,
  `-- Extraído em: ${retrievedAt}`,
  "CREATE TABLE IF NOT EXISTS dataflows (",
  "  id TEXT PRIMARY KEY, agency TEXT NOT NULL, version TEXT NOT NULL,",
  "  name TEXT NOT NULL, id_lc TEXT NOT NULL, name_lc TEXT NOT NULL,",
  "  search_weight INTEGER NOT NULL DEFAULT 0",
  ");",
  "CREATE TABLE IF NOT EXISTS catalog_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
  "DELETE FROM dataflows;",
  "DELETE FROM catalog_meta;",
];

const CHUNK = 50;
for (let i = 0; i < dataflows.length; i += CHUNK) {
  const values = dataflows.slice(i, i + CHUNK).map((df) => {
    const name = df.name ?? df.names?.en ?? df.id;
    return `(${q(df.id)}, ${q(df.agencyID ?? "ILO")}, ${q(df.version ?? "1.0")}, ${q(name)}, ${q(
      df.id.toLowerCase(),
    )}, ${q(name.toLowerCase())}, ${searchWeight(df)})`;
  });
  lines.push(
    `INSERT INTO dataflows (id, agency, version, name, id_lc, name_lc, search_weight) VALUES\n${values.join(",\n")};`,
  );
}

lines.push(
  `INSERT INTO catalog_meta (key, value) VALUES ('retrieved_at', ${q(retrievedAt)});`,
  `INSERT INTO catalog_meta (key, value) VALUES ('source_url', ${q(CATALOG_URL)});`,
  `INSERT INTO catalog_meta (key, value) VALUES ('dataflow_count', ${q(String(dataflows.length))});`,
);

writeFileSync(OUT, lines.join("\n") + "\n", "utf8");
writeFileSync(
  IDS_OUT,
  `# ids do catálogo ILOSTAT — gerado por scripts/seed-catalog.mjs em ${retrievedAt}; não editar à mão.\n` +
    dataflows.map((df) => df.id).sort().join("\n") +
    "\n",
  "utf8",
);
console.log(`OK: ${dataflows.length} dataflows, extraído em ${retrievedAt}`);
console.log(`SQL: ${OUT}`);
console.log(`IDs: ${IDS_OUT}`);
console.log("Aplicar com:");
console.log("  npx wrangler d1 execute ilostat-catalog --local  --file=scripts/seed-catalog.sql");
console.log("  npx wrangler d1 execute ilostat-catalog --remote --file=scripts/seed-catalog.sql");
