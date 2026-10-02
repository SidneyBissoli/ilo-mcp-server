import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Ver tests/stub-cloudflare-workers.ts: sem isto, importar o entrypoint
      // (que puxa o Durable Object) falha na resolução, em Node. `.href` de
      // propósito: o `URL` global das workers-types não é o de node:url.
      "cloudflare:workers": fileURLToPath(new URL("./tests/stub-cloudflare-workers.ts", import.meta.url).href),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
