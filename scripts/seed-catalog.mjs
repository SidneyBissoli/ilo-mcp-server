/**
 * Seed do catálogo de dataflows (D1).
 *
 * Baixa o catálogo oficial completo (`/dataflow/ILO?detail=allstubs`, ~557 KB,
 * ~1.210 dataflows — medição do spike), registra o instante REAL da extração
 * (é o retrieved_at que o bloco de proveniência de search_indicators reporta) e
 * gera `scripts/seed-catalog.sql` para o `wrangler d1 execute`.
 *
 * Uso:
 *   node scripts/seed-catalog.mjs [catalogo.json]
 *   npx wrangler d1 execute ilostat-catalog --local  --file=scripts/seed-catalog.sql
 *   npx wrangler d1 execute ilostat-catalog --remote --file=scripts/seed-catalog.sql
 *
 * O gateway da OIT responde HTTP 500 ao fetch do Node/undici (qualquer header;
 * observado em 07/08/2026), mas 200 ao curl e ao fetch do workerd. Sem argumento,
 * o script baixa via `curl`; com argumento, lê o JSON do arquivo indicado
 * (baixado AGORA — o retrieved_at gravado é o instante da execução).
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CATALOG_URL = "https://sdmx.ilo.org/rest/dataflow/ILO?detail=allstubs";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "seed-catalog.sql");

// JSON só via header Accept — ?format= é ignorado pelo endpoint (decisão do spike).
let body;
const fileArg = process.argv[2];
if (fileArg) {
  body = readFileSync(fileArg, "utf8");
} else {
  body = execFileSync(
    "curl",
    ["-sS", "--fail", "-H", "Accept: application/vnd.sdmx.structure+json", CATALOG_URL],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
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
console.log(`OK: ${dataflows.length} dataflows, extraído em ${retrievedAt}`);
console.log(`SQL: ${OUT}`);
console.log("Aplicar com:");
console.log("  npx wrangler d1 execute ilostat-catalog --local  --file=scripts/seed-catalog.sql");
console.log("  npx wrangler d1 execute ilostat-catalog --remote --file=scripts/seed-catalog.sql");
