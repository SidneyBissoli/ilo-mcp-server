import { describe, expect, it } from "vitest";
import { upstreamHeaders } from "../src/ilostat/sdmx.js";

describe("headers das chamadas upstream", () => {
  it("levam Accept negociado, Accept-Language explícito e User-Agent identificável", () => {
    const h = upstreamHeaders("application/vnd.sdmx.data+json");
    expect(h.Accept).toBe("application/vnd.sdmx.data+json");
    // O gateway da OIT responde 500 ("languageTag1") ao `Accept-Language: *` que o
    // fetch do Node envia por padrão — o header explícito é o que torna o runtime
    // stdio (e o seed) possível.
    expect(h["Accept-Language"]).toBe("en");
    expect(h["User-Agent"]).toMatch(/ilo-mcp-server \(https:\/\/ilo\.sidneybissoli\.com; .+@.+\)/);
  });
});
