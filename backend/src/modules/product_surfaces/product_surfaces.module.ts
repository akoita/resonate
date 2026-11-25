import { Module } from "@nestjs/common";
import { ProductSurfacesController } from "./product_surfaces.controller";

@Module({
  controllers: [ProductSurfacesController],
})
export class ProductSurfacesModule {}
