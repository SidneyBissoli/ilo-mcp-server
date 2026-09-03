/**
 * Peças compartilhadas pelas tools: o parâmetro de modo de proveniência
 * (decisão por-servidor do contrato v1.0 — exposto na descrição da tool, nunca
 * no texto ao leitor) e o trecho de outputSchema do envelope.
 */

import { z } from "zod";

export const PROVENANCE_MODE_SCHEMA = z
  .enum(["concise", "detailed"])
  .optional()
  .describe(
    "Provenance verbosity: 'concise' (default — source, url, vintage, retrieval date, citation, " +
      "license) or 'detailed' (full canonical block with dataset, dimension key and notices)",
  );

/** Campos do envelope de proveniência presentes em toda resposta (contrato v1.0). */
export function provenanceOutputShape() {
  return {
    provenance: z.unknown(),
    attribution: z.array(z.string()),
  };
}
