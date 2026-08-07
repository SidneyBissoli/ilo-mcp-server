/**
 * Parser SDMX-JSON (data message) → estrutura tabular.
 *
 * Portado do spike da Sessão 04 (validado em produção contra sdmx.ilo.org) e
 * estendido com atributos de observação (ex.: OBS_STATUS — "break in series"),
 * que o contrato de proveniência manda reproduzir quando a origem os fornece.
 *
 * Formato coberto (Accept: application/vnd.sdmx.data+json):
 * dataSets[].series["i:j:k"].observations["t"] = [valor, ...índices de atributo],
 * com o mapa de índices em structure.dimensions.{series,observation} e
 * structure.attributes.observation.
 */

interface SdmxComponentValue {
  id: string;
  name?: string;
}

interface SdmxComponent {
  id: string;
  name?: string;
  values: SdmxComponentValue[];
}

interface SdmxDataStructure {
  name?: string;
  dimensions?: {
    series?: SdmxComponent[];
    observation?: SdmxComponent[];
  };
  attributes?: {
    series?: SdmxComponent[];
    observation?: SdmxComponent[];
  };
}

interface SdmxDataMessage {
  data?: SdmxDataRoot;
  structure?: SdmxDataStructure;
  dataSets?: SdmxDataSet[];
  structures?: SdmxDataStructure[];
}

interface SdmxDataRoot {
  structure?: SdmxDataStructure;
  structures?: SdmxDataStructure[];
  dataSets?: SdmxDataSet[];
}

interface SdmxDataSet {
  series?: Record<string, SdmxSeries>;
}

interface SdmxSeries {
  observations?: Record<string, unknown>;
}

/** Valor de atributo reproduzido verbatim: código + rótulo da origem. */
export interface ObservationAttribute {
  id: string | null;
  name: string | null;
}

export interface ObservationRow {
  /** Dimensões (id do código por dimensão) + valor numérico da observação. */
  dimensions: Record<string, string | null>;
  value: number | null;
  /** Atributos de observação da origem (ex.: OBS_STATUS), quando presentes. */
  attributes: Record<string, ObservationAttribute> | null;
}

export interface ParsedSdmxData {
  rows: ObservationRow[];
  dimensionIds: string[];
  name: string | null;
}

export function parseSdmxData(msg: unknown): ParsedSdmxData {
  const m = msg as SdmxDataMessage;
  const root: SdmxDataRoot = m.data ?? (m as SdmxDataRoot);
  const structure = root.structure ?? root.structures?.[0];
  if (!structure) throw new Error("SDMX-JSON sem bloco structure");
  const seriesDims = structure.dimensions?.series ?? [];
  const obsDims = structure.dimensions?.observation ?? [];
  const obsAttrs = structure.attributes?.observation ?? [];
  const rows: ObservationRow[] = [];

  for (const ds of root.dataSets ?? []) {
    for (const [key, s] of Object.entries(ds.series ?? {})) {
      const dims: Record<string, string | null> = {};
      key.split(":").forEach((v, i) => {
        const d = seriesDims[i];
        if (d) dims[d.id] = d.values[Number(v)]?.id ?? null;
      });
      for (const [obsKey, obsVal] of Object.entries(s.observations ?? {})) {
        const rowDims: Record<string, string | null> = { ...dims };
        obsKey.split(":").forEach((v, i) => {
          const d = obsDims[i];
          if (d) rowDims[d.id] = d.values[Number(v)]?.id ?? null;
        });

        let value: number | null = null;
        let attributes: Record<string, ObservationAttribute> | null = null;
        if (Array.isArray(obsVal)) {
          value = typeof obsVal[0] === "number" ? obsVal[0] : null;
          // Índices a partir da posição 1 apontam para structure.attributes.observation.
          for (let i = 0; i < obsAttrs.length; i++) {
            const idx = obsVal[i + 1];
            if (idx === null || idx === undefined) continue;
            const attr = obsAttrs[i];
            const av = attr?.values[Number(idx)];
            if (!attr || !av) continue;
            const id = av.id ?? null;
            const name = av.name ?? null;
            // Valor sem id e sem rótulo (ex.: SOURCE interno da OIT) não informa nada.
            if (id === null && name === null) continue;
            attributes ??= {};
            attributes[attr.id] = { id, name };
          }
        } else if (typeof obsVal === "number") {
          value = obsVal;
        }
        rows.push({ dimensions: rowDims, value, attributes });
      }
    }
  }

  return {
    rows,
    dimensionIds: [...seriesDims.map((d) => d.id), ...obsDims.map((d) => d.id)],
    name: structure.name ?? null,
  };
}
