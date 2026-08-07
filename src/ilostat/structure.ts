/**
 * Extração da estrutura de um dataflow (SDMX-JSON structure message,
 * `?references=all`) para a forma compacta que o servidor cacheia em KV e usa
 * para montar chaves de consulta, metadados e o bloco de proveniência.
 *
 * Fatos confirmados no spike (Sessão 04):
 *  - `data_vintage` vem da annotation `LAST_UPDATE` do dataflow, formato
 *    `dd/MM/yyyy HH:mm:ss` → normalizado aqui para ISO (`yyyy-MM-dd`);
 *  - dimensões reais do dataflow canônico: REF_AREA × FREQ × MEASURE × SEX × AGE
 *    + TIME_PERIOD (time dimension, fora da chave);
 *  - cada dimensão referencia sua codelist via URN
 *    `...Codelist=ILO:CL_AREA(1.0)` — codelists são compartilhadas entre
 *    dataflows e por isso cacheadas por codelist, não por dataflow.
 */

interface SdmxAnnotation {
  id?: string;
  type?: string;
  title?: string;
  text?: string;
}

interface SdmxStructureMessage {
  data?: {
    dataflows?: Array<{
      id: string;
      version?: string;
      agencyID?: string;
      name?: string;
      annotations?: SdmxAnnotation[];
    }>;
    dataStructures?: Array<{
      dataStructureComponents?: {
        dimensionList?: {
          dimensions?: Array<{
            id: string;
            localRepresentation?: { enumeration?: string };
          }>;
          timeDimensions?: Array<{ id: string }>;
        };
      };
    }>;
    codelists?: Array<{
      id: string;
      version?: string;
      agencyID?: string;
      name?: string;
      codes?: Array<{ id: string; name?: string }>;
    }>;
  };
}

export interface CodelistRef {
  /** Id da codelist (ex.: CL_AREA). */
  id: string;
  agency: string;
  version: string;
}

export interface DataflowDimension {
  id: string;
  codelist: CodelistRef | null;
}

export interface Codelist {
  id: string;
  agency: string;
  version: string;
  name: string | null;
  codes: Array<{ id: string; name: string | null }>;
}

/** Forma compacta da estrutura de um dataflow — é isso que vai para o KV. */
export interface DataflowStructure {
  id: string;
  agency: string;
  version: string;
  name: string | null;
  /** Annotation LAST_UPDATE normalizada para ISO (yyyy-MM-dd); null se ausente. */
  dataVintage: string | null;
  /** Dimensões da chave SDMX, na ordem do DSD (TIME_PERIOD fica fora da chave). */
  dimensions: DataflowDimension[];
  timeDimension: string | null;
  /** Annotation DEFAULT do dataflow (recorte default sugerido pela OIT), se houver. */
  defaults: Record<string, string> | null;
}

const CODELIST_URN = /Codelist=([^:]+):([^(]+)\(([^)]+)\)/;

export function parseCodelistUrn(urn: string | undefined): CodelistRef | null {
  if (!urn) return null;
  const m = CODELIST_URN.exec(urn);
  if (!m) return null;
  return { agency: m[1] as string, id: m[2] as string, version: m[3] as string };
}

/** `dd/MM/yyyy[ HH:mm:ss]` → `yyyy-MM-dd`; null se o formato não casar. */
export function lastUpdateToIso(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(raw);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/** Annotation DEFAULT (`FREQ=A,SEX=SEX_T,...`) → registro chave→valor. */
export function parseDefaultAnnotation(raw: string | undefined | null): Record<string, string> | null {
  if (!raw) return null;
  const out: Record<string, string> = {};
  for (const part of raw.split(",")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return Object.keys(out).length ? out : null;
}

function annotationValue(annotations: SdmxAnnotation[] | undefined, type: string): string | null {
  const a = (annotations ?? []).find((x) => (x.type ?? x.id) === type);
  return a?.title ?? a?.text ?? null;
}

export function parseStructureMessage(msg: unknown): {
  structure: DataflowStructure;
  codelists: Codelist[];
} {
  const data = (msg as SdmxStructureMessage).data;
  const df = data?.dataflows?.[0];
  if (!df) throw new Error("structure message sem dataflow");

  const dimensionList = data?.dataStructures?.[0]?.dataStructureComponents?.dimensionList;
  const dimensions: DataflowDimension[] = (dimensionList?.dimensions ?? []).map((d) => ({
    id: d.id,
    codelist: parseCodelistUrn(d.localRepresentation?.enumeration),
  }));
  if (!dimensions.length) throw new Error(`dataflow ${df.id}: DSD sem dimensões`);

  const structure: DataflowStructure = {
    id: df.id,
    agency: df.agencyID ?? "ILO",
    version: df.version ?? "1.0",
    name: df.name ?? null,
    dataVintage: lastUpdateToIso(annotationValue(df.annotations, "LAST_UPDATE")),
    dimensions,
    timeDimension: dimensionList?.timeDimensions?.[0]?.id ?? null,
    defaults: parseDefaultAnnotation(annotationValue(df.annotations, "DEFAULT")),
  };

  return { structure, codelists: mapCodelists(data?.codelists) };
}

function mapCodelists(raw: NonNullable<SdmxStructureMessage["data"]>["codelists"]): Codelist[] {
  return (raw ?? []).map((cl) => ({
    id: cl.id,
    agency: cl.agencyID ?? "ILO",
    version: cl.version ?? "1.0",
    name: cl.name ?? null,
    codes: (cl.codes ?? []).map((c) => ({ id: c.id, name: c.name ?? null })),
  }));
}

/** Mensagem do endpoint /codelist/{agency}/{id}/{version} → codelists contidas. */
export function parseCodelistMessage(msg: unknown): Codelist[] {
  return mapCodelists((msg as SdmxStructureMessage).data?.codelists);
}
