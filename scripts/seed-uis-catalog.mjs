/**
 * Seed do catálogo UIS (D1 — tabelas uis_indicators / uis_geounits / uis_meta).
 *
 * Baixa o catálogo de indicadores (`/definitions/indicators`, ~5.060 indicadores),
 * os geo units (`/definitions/geounits`, 462) e a release corrente
 * (`/versions/default`), registra o instante REAL da extração (é o retrieved_at
 * que os blocos de proveniência das tools uis_* de catálogo reportam) e gera
 * `scripts/seed-uis-catalog.sql` para o `wrangler d1 execute`.
 *
 * Uso:
 *   node scripts/seed-uis-catalog.mjs
 *   npx wrangler d1 execute ilostat-catalog --local  --file=scripts/seed-uis-catalog.sql
 *   npx wrangler d1 execute ilostat-catalog --remote --file=scripts/seed-uis-catalog.sql
 *
 * Ao contrário do gateway da OIT, a UIS Data API responde 200 ao fetch do Node —
 * não é preciso curl (medição do mini-spike, docs/06, 07/08/2026).
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "https://api.uis.unesco.org/api/public";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "seed-uis-catalog.sql");
const UA = "ilostat-mcp (https://ilostat.sidneybissoli.com; sbissoli76@gmail.com)";

async function getJson(path) {
  const res = await fetch(`${BASE}${path}`, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return await res.json();
}

const [indicators, geounits, release] = await Promise.all([
  getJson("/definitions/indicators"),
  getJson("/definitions/geounits"),
  getJson("/versions/default"),
]);
const retrievedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
if (indicators.length < 1000) throw new Error(`catálogo suspeito: só ${indicators.length} indicadores`);
if (geounits.length < 100) throw new Error(`geo units suspeitos: só ${geounits.length}`);

const q = (s) => (s === null || s === undefined ? "NULL" : `'${String(s).replace(/'/g, "''")}'`);
const n = (v) => (Number.isFinite(v) ? String(v) : "NULL");
// lastDataUpdate vem em MM/DD/YYYY (ex.: "02/09/2026" = 9 de fevereiro) → ISO.
const isoDate = (mdY) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(mdY ?? "");
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
};

const lines = [
  "-- Gerado por scripts/seed-uis-catalog.mjs — não editar à mão.",
  `-- Fontes: ${BASE}/definitions/indicators · /definitions/geounits · /versions/default`,
  `-- Extraído em: ${retrievedAt} (release ${release.version})`,
  "CREATE TABLE IF NOT EXISTS uis_indicators (",
  "  code TEXT PRIMARY KEY, name TEXT NOT NULL, code_lc TEXT NOT NULL, name_lc TEXT NOT NULL,",
  "  theme TEXT NOT NULL, last_data_update TEXT, record_count INTEGER,",
  "  year_min INTEGER, year_max INTEGER, geo_types TEXT",
  ");",
  "CREATE TABLE IF NOT EXISTS uis_geounits (",
  "  id TEXT PRIMARY KEY, name TEXT NOT NULL, name_lc TEXT NOT NULL, type TEXT NOT NULL",
  ");",
  "CREATE TABLE IF NOT EXISTS uis_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
  "DELETE FROM uis_indicators;",
  "DELETE FROM uis_geounits;",
  "DELETE FROM uis_meta;",
];

const CHUNK = 50;
for (let i = 0; i < indicators.length; i += CHUNK) {
  const values = indicators.slice(i, i + CHUNK).map((ind) => {
    const da = ind.dataAvailability ?? {};
    return `(${q(ind.indicatorCode)}, ${q(ind.name)}, ${q(ind.indicatorCode.toLowerCase())}, ${q(
      ind.name.toLowerCase(),
    )}, ${q(ind.theme)}, ${q(isoDate(ind.lastDataUpdate))}, ${n(da.totalRecordCount)}, ${n(
      da.timeLine?.min,
    )}, ${n(da.timeLine?.max)}, ${q((da.geoUnits?.types ?? []).join(","))})`;
  });
  lines.push(
    "INSERT INTO uis_indicators (code, name, code_lc, name_lc, theme, last_data_update, record_count, year_min, year_max, geo_types) VALUES\n" +
      values.join(",\n") +
      ";",
  );
}

for (let i = 0; i < geounits.length; i += CHUNK) {
  const values = geounits
    .slice(i, i + CHUNK)
    .map((g) => `(${q(g.id)}, ${q(g.name)}, ${q(g.name.toLowerCase())}, ${q(g.type)})`);
  lines.push(`INSERT INTO uis_geounits (id, name, name_lc, type) VALUES\n${values.join(",\n")};`);
}

lines.push(
  `INSERT INTO uis_meta (key, value) VALUES ('retrieved_at', ${q(retrievedAt)});`,
  `INSERT INTO uis_meta (key, value) VALUES ('release_version', ${q(release.version)});`,
  `INSERT INTO uis_meta (key, value) VALUES ('release_publication_date', ${q(release.publicationDate)});`,
  `INSERT INTO uis_meta (key, value) VALUES ('indicator_count', ${q(String(indicators.length))});`,
  `INSERT INTO uis_meta (key, value) VALUES ('geounit_count', ${q(String(geounits.length))});`,
);

writeFileSync(OUT, lines.join("\n") + "\n", "utf8");
console.log(`OK: ${indicators.length} indicadores, ${geounits.length} geo units, release ${release.version}, extraído em ${retrievedAt}`);
console.log(`SQL: ${OUT}`);
console.log("Aplicar com:");
console.log("  npx wrangler d1 execute ilostat-catalog --local  --file=scripts/seed-uis-catalog.sql");
console.log("  npx wrangler d1 execute ilostat-catalog --remote --file=scripts/seed-uis-catalog.sql");
