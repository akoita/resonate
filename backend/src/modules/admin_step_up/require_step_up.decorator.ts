import { SetMetadata } from "@nestjs/common";

export const REQUIRE_STEP_UP_KEY = "requireAdminStepUp";

/**
 * Marks a destructive admin route (#2173). The global `AdminStepUpGuard` then
 * refuses the request with `403 { code: "step_up_required" | "step_up_expired" |
 * "step_up_invalid" }` unless it carries a fresh step-up proof in the
 * `X-Admin-Step-Up` header for the signed-in person.
 *
 * Applied to a handler, or to a whole controller. The guard is global on
 * purpose: a route that carries this decorator cannot forget to wire it.
 */
export const RequireStepUp = () => SetMetadata(REQUIRE_STEP_UP_KEY, true);
