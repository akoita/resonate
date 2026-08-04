import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SIDEBAR_FILE = fileURLToPath(new URL("./Sidebar.tsx", import.meta.url));

type SidebarLink = {
  line: number;
  hasPrefetchDisabled: boolean;
};

function readSidebarLinks(): SidebarLink[] {
  const sourceText = readFileSync(SIDEBAR_FILE, "utf8");
  const sourceFile = ts.createSourceFile(
    SIDEBAR_FILE,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const links: SidebarLink[] = [];

  function visit(node: ts.Node) {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText(sourceFile) === "Link"
    ) {
      const prefetch = node.attributes.properties.find(
        (attribute): attribute is ts.JsxAttribute =>
          ts.isJsxAttribute(attribute) && attribute.name.getText(sourceFile) === "prefetch",
      );
      links.push({
        line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
        hasPrefetchDisabled:
          !!prefetch &&
          !!prefetch.initializer &&
          ts.isJsxExpression(prefetch.initializer) &&
          prefetch.initializer.expression?.kind === ts.SyntaxKind.FalseKeyword,
      });
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return links;
}

describe("Sidebar route prefetching", () => {
  it("explicitly disables prefetch on every persistent Sidebar Link", () => {
    // The Home trace measured 64 RSC prefetch requests from this always-mounted
    // navigation. Contextual links elsewhere should retain Next's default behavior.
    const links = readSidebarLinks();
    expect(links.length).toBeGreaterThan(0);

    const missingLines = links
      .filter((link) => !link.hasPrefetchDisabled)
      .map((link) => link.line);
    expect(
      missingLines,
      `Sidebar <Link> tags missing explicit prefetch={false} at lines: ${missingLines.join(", ")}`,
    ).toEqual([]);
  });
});
