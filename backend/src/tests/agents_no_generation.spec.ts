/**
 * ADR-TE-4 guard: the agents module must never reach AI generation.
 *
 * Generation from an agent would put fully AI content on a human-artist
 * promotional surface (ADR-BM-5.3) and bill it outside a credit-metered
 * product (ADR-BM-3). GenerationService stays for Remix Studio only.
 *
 * Source-level check (no DB, no containers): walks every non-test file under
 * src/modules/agents and asserts none of them import or call generation.
 */

import * as fs from "fs";
import * as path from "path";
import { EmbeddingService } from "../modules/embeddings/embedding.service";
import { EmbeddingStore } from "../modules/embeddings/embedding.store";
import { ToolRegistry } from "../modules/agents/tools/tool_registry";
import { getToolDeclarations } from "../modules/agents/tools/tool_declarations";

const AGENTS_DIR = path.resolve(__dirname, "../modules/agents");

function listSourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(full);
    return entry.name.endsWith(".ts") ? [full] : [];
  });
}

const FORBIDDEN: Array<{ label: string; pattern: RegExp }> = [
  { label: "import of generation.service", pattern: /generation[./]service/ },
  { label: "import of GenerationModule", pattern: /GenerationModule|generation\.module/ },
  { label: "GenerationService reference", pattern: /\bGenerationService\b/ },
  { label: "createGeneration call", pattern: /\bcreateGeneration(ForCaller)?\b/ },
  { label: "generateComplementaryStem call", pattern: /\bgenerateComplementaryStem\b/ },
  { label: "Lyria client", pattern: /\bLyria(Client|RealtimeService)\b/ },
  { label: "retired event emission", pattern: /agent\.generation_triggered/ },
  { label: "generation tool name", pattern: /["'`]generation[._](create|complementary)["'`]/ },
];

describe("agents module never generates audio (ADR-TE-4)", () => {
  const files = listSourceFiles(AGENTS_DIR);

  it("finds agents module sources to scan", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(FORBIDDEN)("no agents source has a $label", ({ pattern }) => {
    const offenders = files.filter((file) => pattern.test(fs.readFileSync(file, "utf8")));
    expect(offenders.map((file) => path.relative(AGENTS_DIR, file))).toEqual([]);
  });

  it("ToolRegistry exposes no generation tools", () => {
    const registry = new ToolRegistry(new EmbeddingService(), new EmbeddingStore());
    const names = [...(registry as unknown as { tools: Map<string, unknown> }).tools.keys()];

    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((name) => name.toLowerCase().startsWith("generation"))).toEqual([]);
    expect(() => registry.get("generation.create")).toThrow("Tool not found");
    expect(() => registry.get("generation.complementary")).toThrow("Tool not found");
  });

  it("LLM tool declarations expose no generation tools", () => {
    const declared = getToolDeclarations().map((d) => d.name);
    expect(declared.filter((name) => name.toLowerCase().includes("generat"))).toEqual([]);
  });
});
