import { CanActivate, UseGuards } from "@nestjs/common";
import { assertSurfaceEnabled, type ProductSurface } from "../../config/product_surfaces";

/**
 * Refuses a route while its product surface is switched off (#2658). The
 * switch is read on every request; a switched-off surface answers
 * `403 { code: "surface_disabled", surface }`.
 */
export class ProductSurfaceGuard implements CanActivate {
  constructor(readonly surface: ProductSurface) {}

  canActivate(): boolean {
    assertSurfaceEnabled(this.surface);
    return true;
  }
}

/** Gate a controller or a route behind one product surface switch. */
export function RequireSurface(surface: ProductSurface) {
  return UseGuards(new ProductSurfaceGuard(surface));
}
