import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { classifyError, errorText, paramNames } from "../src/call-shape.js";
import { withAnalytics, tagRequest } from "../src/analytics.js";
import { withUsage } from "../src/usage-wrap.js";
import type { RecordUsage } from "../src/usage-core.js";

/**
 * A FORMA da chamada (blobs 7 e 8), ligada aqui porque `ilo_get_data` falha em
 * 55% das chamadas e a telemetria dizia QUE falhou, não por quê.
 *
 * O teste que mais importa é a GUARDA: ela varre as mensagens de erro do
 * próprio `src/` e reprova se alguma cair em `outro`. Quando passei o
 * classificador por este repositório pela primeira vez, 5 das 7 não tinham
 * classe — as mensagens daqui são em inglês e o vocabulário tinha nascido das
 * mensagens em português dos servidores irmãos. Uma lista de literais copiados
 * aqui fossilizaria o dia da varredura; a guarda continua verdadeira sozinha.
 */

const CHAMADA = /new Ilostat(?:User|Upstream)Error\(([\s\S]{10,900}?)\n?\s*\)/g;
const LITERAL = /(["'`])((?:\\.|(?!\1)[\s\S])*)\1/g;
/** Mensagem que só repassa o texto de cima; o sinal chega em execução. */
const REPASSE = /:\s*X\.?$/;

function mensagensDeErro(): string[] {
  const achadas = new Set<string>();
  const ande = (dir: string): void => {
    for (const entrada of readdirSync(dir)) {
      const caminho = join(dir, entrada);
      if (statSync(caminho).isDirectory()) {
        ande(caminho);
        continue;
      }
      if (!entrada.endsWith(".ts") || entrada.includes(".test.")) continue;
      for (const chamada of readFileSync(caminho, "utf8").matchAll(CHAMADA)) {
        const partes = [...(chamada[1] ?? "").matchAll(LITERAL)].map((p) => p[2] ?? "");
        if (partes.length === 0) continue;
        const texto = partes.join("").replace(/\$\{[^}]*\}/g, "X").replace(/\s+/g, " ").trim();
        // Exige espaço: literais colados sem prosa não são mensagem.
        if (texto.length > 15 && /\s/.test(texto)) achadas.add(texto);
      }
    }
  };
  ande(new URL("../src", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
  return [...achadas];
}

describe("guarda: as mensagens deste servidor são classificáveis", () => {
  const mensagens = mensagensDeErro();

  it("a varredura encontra as mensagens (senão a guarda passaria vazia)", () => {
    expect(mensagens.length).toBeGreaterThan(5);
  });

  it("nenhuma mensagem própria cai em `outro`", () => {
    const orfas = mensagens.filter((m) => !REPASSE.test(m) && classifyError(m) === "outro");
    expect(orfas, `sem classe:\n${orfas.map((m) => `  - ${m}`).join("\n")}`).toEqual([]);
  });
});

describe("classifyError separa a bifurcação do conserto", () => {
  it("parâmetro que falta ou combinação proibida é contrato", () => {
    expect(classifyError("REF_AREA is required (up to 30 area codes)")).toBe("contrato");
    expect(classifyError("Empty query: pass one or more search terms.")).toBe("contrato");
    expect(classifyError("Query too broad: no dimension filter given.")).toBe("contrato");
    expect(classifyError("TIME_PERIOD is not part of the SDMX key.")).toBe("contrato");
    expect(classifyError("Dimension SEX has no enumerated codelist.")).toBe("contrato");
  });

  it("chamou certo com um valor que não resolve é nao_encontrado", () => {
    expect(classifyError('Dataflow "DF_INVENTADO" not found at ILOSTAT.')).toBe("nao_encontrado");
    expect(classifyError('Dimension "FOO" does not exist in dataflow DF_X.')).toBe("nao_encontrado");
  });

  it("`empty query` é contrato, `empty response` é nao_encontrado", () => {
    // A distinção custou uma correção: o radical `empty` solto mandava a
    // consulta vazia (parâmetro que falta) para a classe errada.
    expect(classifyError("Empty query: pass one or more search terms.")).toBe("contrato");
    expect(classifyError("ILOSTAT returned an empty response")).toBe("nao_encontrado");
  });

  it("a fonte falhou ou demorou é fonte", () => {
    expect(classifyError("Upstream (ILO) failure: timeout")).toBe("fonte");
    expect(classifyError("ILOSTAT returned 503")).toBe("fonte");
  });
});

describe("paramNames nunca deixa passar valor", () => {
  it("devolve os NOMES, em ordem", () => {
    const s = paramNames({ dataflow: "DF_X", ref_area: "BRA", start_period: "2015" });
    expect(s).toBe("dataflow,ref_area,start_period");
    expect(s).not.toContain("BRA");
    expect(s).not.toContain("2015");
  });

  it("aguenta chamada sem argumento, estranha ou com array", () => {
    expect(paramNames([])).toBe("");
    expect(paramNames([null])).toBe("");
    expect(paramNames(["texto"])).toBe("");
    expect(paramNames([["a", "b"]])).toBe("");
  });
});

describe("a forma ATRAVESSA de withUsage até o blob", () => {
  interface Ponto {
    indexes?: string[];
    blobs?: string[];
    doubles?: number[];
  }

  function fake() {
    const points: Ponto[] = [];
    return {
      points,
      dataset: { writeDataPoint: (p: Ponto) => points.push(p) } as unknown as AnalyticsEngineDataset,
    };
  }

  const tag = tagRequest(new Request("https://example.com/mcp"));

  /**
   * O teste de costura. Cada lado passa sozinho; o que perde o argumento é o
   * adaptador entre eles, e TypeScript aceita uma seta de aridade menor onde se
   * espera uma maior. No medical isso subiu para produção gravando vazio.
   */
  it("êxito: nomes gravados, classe vazia", async () => {
    const a = fake();
    const rec: RecordUsage = withAnalytics(() => {}, a.dataset, tag);
    const tool = withUsage("ilo_get_data", rec, async () => ({ ok: true }));
    await tool({ dataflow: "DF_X", ref_area: "BRA" });
    await Promise.resolve();
    expect(a.points[0]?.blobs?.[1]).toBe("ok");
    expect(a.points[0]?.blobs?.[6]).toBe("");
    expect(a.points[0]?.blobs?.[7]).toBe("dataflow,ref_area");
  });

  it("erro: a classe sai da mensagem e os nomes sobrevivem", async () => {
    const a = fake();
    const rec: RecordUsage = withAnalytics(() => {}, a.dataset, tag);
    const tool = withUsage("ilo_get_data", rec, async () => ({
      isError: true,
      content: [{ type: "text", text: 'Dataflow "DF_X" not found at ILOSTAT.' }],
    }));
    await tool({ dataflow: "DF_X" });
    await Promise.resolve();
    expect(a.points).toHaveLength(1);
    expect(a.points[0]?.blobs?.[1]).toBe("error");
    expect(a.points[0]?.blobs?.[6]).toBe("nao_encontrado");
    expect(a.points[0]?.blobs?.[7]).toBe("dataflow");
  });

  it("exceção relançada também vira classe", async () => {
    const a = fake();
    const rec: RecordUsage = withAnalytics(() => {}, a.dataset, tag);
    const tool = withUsage("ilo_get_data", rec, async () => {
      throw new Error("REF_AREA is required (up to 30 area codes)");
    });
    await expect(tool({ dataflow: "DF_X" })).rejects.toThrow();
    await Promise.resolve();
    expect(a.points[0]?.blobs?.[6]).toBe("contrato");
  });

  it("NENHUM blob carrega valor de parâmetro", async () => {
    const a = fake();
    const rec: RecordUsage = withAnalytics(() => {}, a.dataset, tag);
    const tool = withUsage("ilo_search_indicators", rec, async () => ({ ok: true }));
    await tool({ query: "unemployment in a small country", ref_area: "BRA" });
    await Promise.resolve();
    const blobs = (a.points[0]?.blobs ?? []).join("|");
    expect(blobs).not.toContain("unemployment in a small country");
    expect(blobs).not.toContain("BRA");
    expect(blobs).toContain("query,ref_area");
  });
});

describe("errorText lê o texto que o handler devolveu", () => {
  it("o erro daqui é texto puro em content[0]", () => {
    expect(errorText({ content: [{ type: "text", text: "failed" }], isError: true })).toBe("failed");
  });

  it("não quebra sem conteúdo", () => {
    expect(errorText({})).toBe("");
    expect(errorText(null)).toBe("");
    expect(errorText({ content: [] })).toBe("");
  });
});
