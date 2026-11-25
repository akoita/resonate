/**
 * Check a configuration before rollout (#2660):
 *
 *   npm run config:check -- --env production
 *
 * With `--env production` the production rules apply whatever the current
 * deployment tier; without it they apply only in a production-tier
 * deployment, as at boot. Lists every problem and exits 1 when there is one.
 */
import { isProductionEnvironment } from "../config/product_surfaces";
import { formatConfigViolations, productionConfigViolations } from "../config/production_guards";

export function runConfigCheck(argv: string[], env: NodeJS.ProcessEnv): { code: number; output: string } {
  const index = argv.indexOf("--env");
  const target = index >= 0 ? (argv[index + 1] ?? "").toLowerCase() : "";
  const production = target === "production" || target === "prod" || (!target && isProductionEnvironment(env));
  if (!production) {
    return { code: 0, output: "Not a production check: development defaults are allowed here." };
  }
  const violations = productionConfigViolations(env);
  if (violations.length === 0) {
    return { code: 0, output: "Production configuration check passed." };
  }
  return {
    code: 1,
    output: `Production configuration check failed (${violations.length}):\n${formatConfigViolations(violations)}`,
  };
}

if (require.main === module) {
  const result = runConfigCheck(process.argv.slice(2), process.env);
  (result.code === 0 ? console.log : console.error)(result.output);
  process.exit(result.code);
}
