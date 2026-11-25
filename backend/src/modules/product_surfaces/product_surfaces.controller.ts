import { Controller, Get } from "@nestjs/common";
import { resolveProductSurfaces, type ProductSurfaceState } from "../../config/product_surfaces";

/**
 * Public read of the product surface switches (#2658). The web app hides the
 * entry points of every surface reported `false`. The values are not secret:
 * each one only says whether a feature is offered on this deployment.
 */
@Controller("config")
export class ProductSurfacesController {
  @Get("surfaces")
  surfaces(): { surfaces: ProductSurfaceState } {
    return { surfaces: resolveProductSurfaces() };
  }
}
