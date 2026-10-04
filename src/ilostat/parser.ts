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
 * structure.attributes.{dataSet,series,observation}.
 *
 * Atributos de SÉRIE e de DATASET (04/10/2026). É onde a OIT publica a unidade
 * e a escala — UNIT_MEASURE_TYPE, UNIT_MEASURE e UNIT_MULT —, e até aqui o
 * parser só lia os de observação: `ilo_get_data` devolvia 101884.813 sem dizer
 * que eram MILHARES de pessoas. Medido em sdmx.ilo.org (JSON 1.0 e 2.0, mesma
 * forma): os três vêm em `attributes.series` com `relationship.dimensions =
 * ["MEASURE"]` e UM valor na estrutura, mas o índice de cada série vem `null`.
 * A CSV da mesma consulta traz `UNIT_MULT=3` em todas as linhas — então o valor
 * existe, a serialização JSON é que não o aponta. Daí a regra de
 * `resolveGroupAttributes`: índice presente vale; índice null só se resolve
 * quando o valor é DETERMINADO pela própria mensagem (um valor só, e cada
 * dimensão da relação com um código só); fora disso fica de fora, sem chute.
 * No nível de observação, índice null continua significando "não informado".
 */

export interface SdmxComponentValue {
  id: string;
  name?: string;
}

export interface SdmxComponent {
  id: string;
  name?: string;
  values: SdmxComponentValue[];
  /** SDMX-JSON 2.0: a que o atributo se prende (ex.: { dimensions: ["MEASURE"] }). */
  relationship?: { dimensions?: string[] } & Record<string, unknown>;
}

interface SdmxDataStructure {
  name?: string;
  dimensions?: {
    series?: SdmxComponent[];
    observation?: SdmxComponent[];
  };
  attributes?: {
    dataSet?: SdmxComponent[];
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
  attributes?: (number | null)[];
  series?: Record<string, SdmxSeries>;
}

interface SdmxSeries {
  attributes?: (number | null)[];
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
  /**
   * Atributos da origem, verbatim: os de observação (ex.: OBS_STATUS) e os de
   * série/dataset que valem para ela (ex.: UNIT_MEASURE, UNIT_MULT). O de
   * observação vence em caso de mesmo id. `null` quando nenhum veio.
   */
  attributes: Record<string, ObservationAttribute> | null;
}

export interface ParsedSdmxData {
  rows: ObservationRow[];
  dimensionIds: string[];
  name: string | null;
}

/** Valor de atributo com informação, ou null (sem id e sem rótulo não informa nada). */
function attributeValue(attr: SdmxComponent | undefined, idx: unknown): ObservationAttribute | null {
  if (!attr || idx === null || idx === undefined) return null;
  const av = attr.values[Number(idx)];
  if (!av) return null;
  const id = av.id ?? null;
  const name = av.name ?? null;
  return id === null && name === null ? null : { id, name };
}

/**
 * Atributos de série ou de dataset. Índice presente → o valor apontado. Índice
 * null → só o valor que a mensagem DETERMINA: o atributo tem um valor só na
 * estrutura e declara uma relação com dimensões, cada uma com um código só
 * nesta mensagem (então não há outra série a que ele pudesse valer outro
 * valor). Sem `relationship` não se infere nada. Ver o cabeçalho do arquivo.
 */
export function resolveGroupAttributes(
  defs: SdmxComponent[],
  indices: (number | null)[] | undefined,
  allDims: SdmxComponent[],
): Record<string, ObservationAttribute> {
  const out: Record<string, ObservationAttribute> = {};
  defs.forEach((attr, i) => {
    const idx = indices?.[i];
    let v = attributeValue(attr, idx);
    if (v === null && (idx === null || idx === undefined) && attr.values.length === 1) {
      const rel = attr.relationship?.dimensions;
      const determinado =
        Array.isArray(rel) &&
        rel.length > 0 &&
        rel.every((id) => allDims.find((d) => d.id === id)?.values.length === 1);
      if (determinado) v = attributeValue(attr, 0);
    }
    if (v) out[attr.id] = v;
  });
  return out;
}

export function parseSdmxData(msg: unknown): ParsedSdmxData {
  const m = msg as SdmxDataMessage;
  const root: SdmxDataRoot = m.data ?? (m as SdmxDataRoot);
  const structure = root.structure ?? root.structures?.[0];
  if (!structure) throw new Error("SDMX-JSON sem bloco structure");
  const seriesDims = structure.dimensions?.series ?? [];
  const obsDims = structure.dimensions?.observation ?? [];
  const allDims = [...seriesDims, ...obsDims];
  const dsAttrs = structure.attributes?.dataSet ?? [];
  const seriesAttrs = structure.attributes?.series ?? [];
  const obsAttrs = structure.attributes?.observation ?? [];
  const rows: ObservationRow[] = [];

  for (const ds of root.dataSets ?? []) {
    const dsLevel = resolveGroupAttributes(dsAttrs, ds.attributes, allDims);
    for (const [key, s] of Object.entries(ds.series ?? {})) {
      const dims: Record<string, string | null> = {};
      key.split(":").forEach((v, i) => {
        const d = seriesDims[i];
        if (d) dims[d.id] = d.values[Number(v)]?.id ?? null;
      });
      const inherited = { ...dsLevel, ...resolveGroupAttributes(seriesAttrs, s.attributes, allDims) };
      const hasInherited = Object.keys(inherited).length > 0;
      for (const [obsKey, obsVal] of Object.entries(s.observations ?? {})) {
        const rowDims: Record<string, string | null> = { ...dims };
        obsKey.split(":").forEach((v, i) => {
          const d = obsDims[i];
          if (d) rowDims[d.id] = d.values[Number(v)]?.id ?? null;
        });

        let value: number | null = null;
        let attributes: Record<string, ObservationAttribute> | null = hasInherited ? { ...inherited } : null;
        if (Array.isArray(obsVal)) {
          value = typeof obsVal[0] === "number" ? obsVal[0] : null;
          // Índices a partir da posição 1 apontam para structure.attributes.observation.
          // Aqui índice null é "não informado" — sem a inferência dos de série.
          for (let i = 0; i < obsAttrs.length; i++) {
            const attr = obsAttrs[i];
            // Valor sem id e sem rótulo (ex.: SOURCE interno da OIT) não informa nada.
            const v = attributeValue(attr, obsVal[i + 1]);
            if (!attr || !v) continue;
            attributes ??= {};
            attributes[attr.id] = v;
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
