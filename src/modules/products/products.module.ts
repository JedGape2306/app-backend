import { Injectable, Module } from '@nestjs/common';
import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { query } from '../../config/database.config';

@Injectable()
export class ProductsService {

  async getFullMenu() {
    const categories = await query(`
      SELECT id, name, description, image_url as "imageUrl", sort_order as "sortOrder"
      FROM categories
      WHERE is_active = TRUE
      ORDER BY sort_order ASC, name ASC
    `);

    if (categories.length === 0) return [];

    const categoryIds = categories.map((c) => c.id);

    const products = await query(`
      SELECT
        p.id,
        p.category_id as "categoryId",
        p.name,
        p.description,
        p.image_url as "imageUrl",
        p.sort_order as "sortOrder",
        COALESCE(
          json_agg(
            json_build_object(
              'id',        pv.id,
              'name',      pv.name,
              'sizeCm',    pv.size_cm,
              'price',     pv.price::float,
              'sortOrder', pv.sort_order
            ) ORDER BY pv.sort_order ASC
          ) FILTER (WHERE pv.id IS NOT NULL AND pv.is_active = TRUE),
          '[]'
        ) AS variants
      FROM products p
      LEFT JOIN product_variants pv ON pv.product_id = p.id
      WHERE p.is_active = TRUE
        AND p.category_id = ANY($1)
      GROUP BY p.id
      ORDER BY p.sort_order ASC, p.name ASC
    `, [categoryIds]);

    const byCategory: Record<string, any[]> = {};
    for (const p of products) {
      if (!byCategory[p.categoryId]) byCategory[p.categoryId] = [];
      byCategory[p.categoryId].push(p);
    }

    return categories.map((cat) => ({
      ...cat,
      products: byCategory[cat.id] || [],
    }));
  }

  async getIngredients() {
    return query(`
      SELECT id, name, price::float
      FROM ingredients
      WHERE is_active = TRUE
      ORDER BY name ASC
    `);
  }

  async validateVariant(variantId: string) {
    const rows = await query(`
      SELECT
        pv.id,
        pv.price::float  AS price,
        pv.name          AS "variantName",
        p.id             AS "productId",
        p.name           AS "productName"
      FROM product_variants pv
      JOIN products p ON p.id = pv.product_id
      WHERE pv.id = $1
        AND pv.is_active = TRUE
        AND p.is_active  = TRUE
    `, [variantId]);
    return rows[0] ?? null;
  }

  async validateIngredients(
    ingredientIds: string[],
  ): Promise<Map<string, { price: number; name: string }>> {
    if (ingredientIds.length === 0) return new Map();

    const rows = await query(`
      SELECT id, name, price::float
      FROM ingredients
      WHERE id = ANY($1)
        AND is_active = TRUE
    `, [ingredientIds]);

    return new Map(
      rows.map((r) => [r.id as string, { price: r.price as number, name: r.name as string }]),
    );
  }
}

@ApiTags('Menú')
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get('menu')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Menú completo por categorías (público)' })
  async getFullMenu() {
    const data = await this.productsService.getFullMenu();
    return { success: true, data };
  }

  @Get('ingredients')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ingredientes extras disponibles (público)' })
  async getIngredients() {
    const data = await this.productsService.getIngredients();
    return { success: true, data };
  }
}

@Module({
  controllers: [ProductsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}