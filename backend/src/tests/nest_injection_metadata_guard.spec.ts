import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import * as ts from "typescript";

/**
 * #2492 guard. With `emitDecoratorMetadata`, TypeScript serializes a union
 * type (`Foo | null`, `Foo | undefined`, `A | B`) as `Object` in
 * `design:paramtypes`. Nest then has no token to resolve: a constructor
 * parameter typed `Foo | null = null` and marked `@Optional()` is silently
 * injected as undefined, so a provider that is wired in the module is never
 * received (the Stripe webhook ignored every credit-pack event this way).
 *
 * Source scan: in every class decorated with `@Injectable`, `@Controller`,
 * `@Resolver`, `@WebSocketGateway` or `@Catch` (outside `src/tests`), a
 * constructor parameter without an explicit `@Inject(...)` must not have a
 * union type annotation. Use a plain class type (`param?: Foo` is fine), or
 * `@Inject(TOKEN)` when the dependency is a token.
 */
const SRC_ROOT = join(__dirname, "..");
const DI_CLASS_DECORATORS = new Set(["Injectable", "Controller", "Resolver", "WebSocketGateway", "Catch"]);

export type InjectionViolation = { line: number; className: string; param: string; type: string };

function decoratorName(decorator: ts.Decorator): string | null {
  const expression = decorator.expression;
  const callee = ts.isCallExpression(expression) ? expression.expression : expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return null;
}

function unwrapParentheses(node: ts.TypeNode): ts.TypeNode {
  let current = node;
  while (ts.isParenthesizedTypeNode(current)) current = current.type;
  return current;
}

/** Constructor parameters of Nest-managed classes whose metadata would be `Object`. */
export function findUnionInjectionParams(fileName: string, text: string): InjectionViolation[] {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const violations: InjectionViolation[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      const decorators = ts.getDecorators(node) ?? [];
      if (decorators.some((decorator) => DI_CLASS_DECORATORS.has(decoratorName(decorator) ?? ""))) {
        for (const member of node.members) {
          if (!ts.isConstructorDeclaration(member)) continue;
          for (const param of member.parameters) {
            if (!param.type) continue;
            const hasInject = (ts.getDecorators(param) ?? []).some((decorator) => decoratorName(decorator) === "Inject");
            if (hasInject) continue;
            const type = unwrapParentheses(param.type);
            if (!ts.isUnionTypeNode(type)) continue;
            violations.push({
              line: source.getLineAndCharacterOfPosition(param.getStart(source)).line + 1,
              className: node.name?.text ?? "<anonymous>",
              param: param.name.getText(source),
              type: type.getText(source),
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return violations;
}

function productionSources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === "tests" || entry === "node_modules" || entry === "generated" ? [] : productionSources(full);
    }
    return full.endsWith(".ts") && !full.endsWith(".d.ts") ? [full] : [];
  });
}

describe("Nest injection metadata guard (#2492)", () => {
  describe("detector", () => {
    const detect = (code: string) => findUnionInjectionParams("sample.ts", code);

    it("flags a union-typed constructor parameter without @Inject, parenthesized or not", () => {
      const violations = detect(`
        @Injectable()
        export class A {
          constructor(
            private readonly ok: Dep,
            @Optional() private readonly nullable: Dep | null = null,
            private readonly maybe: Dep | undefined,
            private readonly wrapped: (Dep | null),
            @Optional() private readonly either: First | Second,
          ) {}
        }
      `);
      expect(violations.map((v) => [v.className, v.param])).toEqual([
        ["A", "nullable"],
        ["A", "maybe"],
        ["A", "wrapped"],
        ["A", "either"],
      ]);
      expect(violations[0].line).toBe(6);
    });

    it("accepts @Inject(...) tokens, optional parameters without a union, and non-Nest classes", () => {
      expect(
        detect(`
          @Controller("x")
          export class B {
            constructor(
              @Optional() @Inject(TOKEN) private readonly gateway: Gateway | null = null,
              @Optional() allowance?: Allowance,
              private readonly plain: Plain,
            ) {}
          }
          export class NotManaged {
            constructor(private readonly dep: Dep | null) {}
          }
        `),
      ).toEqual([]);
    });
  });

  it("no Nest-managed constructor parameter is typed as a union without @Inject", () => {
    const found = productionSources(SRC_ROOT).flatMap((file) =>
      findUnionInjectionParams(file, readFileSync(file, "utf8")).map(
        (v) => `${relative(SRC_ROOT, file)}:${v.line} ${v.className}.${v.param}: ${v.type}`,
      ),
    );
    expect(found).toEqual([]);
  });
});
