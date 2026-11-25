// Production build guard (#2660). Loaded by next.config.js, so CommonJS.
//
// A production build (NEXT_PUBLIC_ENV=production or prod) must not ship mock
// authentication, which lets a browser act without a real session.

function isProductionBuild(env) {
  const label = String(env.NEXT_PUBLIC_ENV ?? "").trim().toLowerCase();
  return label === "production" || label === "prod";
}

function productionBuildViolations(env) {
  if (!isProductionBuild(env)) return [];
  const violations = [];
  if (String(env.NEXT_PUBLIC_MOCK_AUTH ?? "").trim().toLowerCase() === "true") {
    violations.push("NEXT_PUBLIC_MOCK_AUTH is true; a production build must use real sign-in.");
  }
  return violations;
}

function assertProductionBuild(env) {
  const violations = productionBuildViolations(env);
  if (violations.length > 0) {
    throw new Error(`Refusing to build for production:\n- ${violations.join("\n- ")}`);
  }
}

module.exports = { isProductionBuild, productionBuildViolations, assertProductionBuild };
