/**
 * Peças compartilhadas pelas tools: o parâmetro de modo de proveniência
 * (decisão por-servidor do contrato v1.1 — exposto na descrição da tool, nunca
 * no texto ao leitor) e o trecho de outputSchema do envelope.
 */

import { ConciseBlockSchema, DetailedBlockSchema } from "@sbissoli/mcp-provenance";
import { z } from "zod";

export const PROVENANCE_MODE_SCHEMA = z
  .enum(["concise", "detailed"])
  .optional()
  .describe(
    "Provenance verbosity: 'concise' (default — source, url, vintage, retrieval date, citation, " +
      "license) or 'detailed' (full canonical block with dataset, dimension key and notices)",
  );

/**
 * Campos do envelope de proveniência presentes em toda resposta (contrato v1.1).
 *
 * A forma do bloco é a que o pacote PUBLICA (`ConciseBlockSchema` /
 * `DetailedBlockSchema`, em zod — o SDK converte), não uma transcrição: até a
 * 1.0.0 era `z.unknown()`, e a superfície anunciava `"provenance": {}` — um
 * agente não tinha como saber que `retrieved_at` ou `retrieval` existiam sem
 * chamar. A união cobre os dois modos de `provenance_mode`, que é decisão
 * por chamada. Chave nova no contrato chega aqui com o pacote que a emite
 * (foi um bloco transcrito à mão que derrubou toda chamada do bcb e do ibge
 * na subida para a v1.1 — o ilo nunca transcreveu, e continua não transcrevendo).
 * Descrições só no topo e em inglês (o texto do pacote é pt-BR; o ilo fala en).
 */
export function provenanceOutputShape() {
  return {
    provenance: z
      .union([ConciseBlockSchema, DetailedBlockSchema])
      .describe(
        "Provenance block (contract v1.1). concise (default): source, source_url, data_vintage, " +
          "retrieved_at, retrieval, citation, license; detailed: the full canonical block (dataset, " +
          "dimension_key, notices, served_from_cache, ...). retrieval is the origin diagnostic of " +
          "this call — requests made to ILOSTAT, attempts including retries, anomalies overcome " +
          "(timeout, network, rate_limited, http_5xx, http_4xx, malformed_body) and unstable " +
          "(true when anything had to be retried: treat the figures as obtained with difficulty); " +
          "null when nothing was fetched from ILOSTAT (catalogue or cached answer)",
      ),
    attribution: z.array(z.string()),
  };
}
