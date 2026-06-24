// ============================================================
// MÓDULO: Orders — Núcleo del sistema de pedidos
// ============================================================

import {
  IsString, IsEmail, IsEnum, IsOptional, IsNumber,
  IsArray, ValidateNested, IsUUID, IsInt, Min,
  MaxLength, IsNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateOrderItemExtraDto {
  @IsUUID('all')
  ingredientId: string;

  @IsInt()
  @Min(1)
  quantity: number = 1;
}

export class CreateOrderItemDto {
  @IsUUID('all')
  variantId: string;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  notes?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemExtraDto)
  extras?: CreateOrderItemExtraDto[];
}

export class CreateOrderDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  customerName: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  customerPhone: string;

  @IsOptional()
  @IsEmail()
  customerEmail?: string;

  @IsEnum(['delivery', 'pickup'])
  orderType: 'delivery' | 'pickup';

  @IsOptional()
  @IsString()
  @MaxLength(255)
  addressStreet?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  addressNeighborhood?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  addressCity?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  addressZipCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  addressReferences?: string;

  @IsOptional()
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @IsNumber()
  longitude?: number;

  @IsOptional()
  @IsUUID('all')
  branchId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items: CreateOrderItemDto[];
}

export class UpdateOrderStatusDto {
  @IsEnum(['pagado', 'en_preparacion', 'listo', 'en_camino', 'entregado', 'cancelado'])
  status: string;

  @IsOptional()
  @IsUUID('all')
  deliveryPersonId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

// ─────────────────────────────────────────────
// SERVICE
// ─────────────────────────────────────────────

import {
  Injectable, BadRequestException, NotFoundException, Module,
} from '@nestjs/common';
import { query } from '../../config/database.config';
import { ProductsService, ProductsModule } from '../products/products.module';
import { OrdersGateway } from './orders.gateway';

interface VariantRow {
  id: string;
  price: number;
  variantName: string;
  productId: string;
  productName: string;
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly productsService: ProductsService,
    private readonly ordersGateway: OrdersGateway,
  ) {}

  async createOrder(dto: CreateOrderDto) {
    if (dto.orderType === 'delivery' && !dto.addressStreet) {
      throw new BadRequestException(
        'Se requiere dirección para pedidos de entrega a domicilio.',
      );
    }

    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('El pedido debe tener al menos un producto.');
    }

    const variantIds = dto.items.map((i) => i.variantId);
    const ingredientIds = [
      ...new Set(dto.items.flatMap((i) => i.extras?.map((e) => e.ingredientId) ?? [])),
    ];

    const variantRows: VariantRow[] = await query(`
      SELECT
        pv.id,
        pv.price::float  AS price,
        pv.name          AS "variantName",
        p.id             AS "productId",
        p.name           AS "productName"
      FROM product_variants pv
      JOIN products p ON p.id = pv.product_id
      WHERE pv.id = ANY($1)
        AND pv.is_active = TRUE
        AND p.is_active  = TRUE
    `, [variantIds]);

    const variantMap = new Map(variantRows.map((r) => [r.id, r]));

    for (const item of dto.items) {
      if (!variantMap.has(item.variantId)) {
        throw new BadRequestException(
          `Producto no disponible (variant: ${item.variantId})`,
        );
      }
    }

    const ingredientMap = await this.productsService.validateIngredients(ingredientIds);

    let subtotal = 0;
    const itemsData: any[] = [];

    for (const item of dto.items) {
      const variant = variantMap.get(item.variantId)!;
      let itemSubtotal = variant.price * item.quantity;
      const extras: any[] = [];

      for (const extra of item.extras ?? []) {
        const ingredient = ingredientMap.get(extra.ingredientId);
        if (!ingredient) {
          throw new BadRequestException(
            `Ingrediente no encontrado (id: ${extra.ingredientId})`,
          );
        }
        itemSubtotal += ingredient.price * extra.quantity;
        extras.push({
          ingredientId:   extra.ingredientId,
          ingredientName: ingredient.name,
          unitPrice:      ingredient.price,
          quantity:       extra.quantity,
        });
      }

      subtotal += itemSubtotal;
      itemsData.push({
        productId:   variant.productId,
        variantId:   item.variantId,
        productName: variant.productName,
        variantName: variant.variantName,
        unitPrice:   variant.price,
        quantity:    item.quantity,
        subtotal:    itemSubtotal,
        notes:       item.notes,
        extras,
      });
    }

    const deliveryFee =
      dto.orderType === 'delivery'
        ? parseFloat(process.env.DELIVERY_FEE_DEFAULT ?? '35')
        : 0;
    const total = subtotal + deliveryFee;

    const [newOrder] = await query(`
      INSERT INTO orders (
        customer_name, customer_phone, customer_email,
        address_street, address_neighborhood, address_city,
        address_zip_code, address_references, latitude, longitude,
        order_type, status, subtotal, delivery_fee, total,
        branch_id, notes
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pendiente_pago', $12, $13, $14, $15, $16
      )
      RETURNING *,
        subtotal::float, delivery_fee::float, total::float
    `, [
      dto.customerName, dto.customerPhone, dto.customerEmail ?? null,
      dto.addressStreet ?? null, dto.addressNeighborhood ?? null,
      dto.addressCity ?? null, dto.addressZipCode ?? null,
      dto.addressReferences ?? null,
      dto.latitude ?? null, dto.longitude ?? null,
      dto.orderType, subtotal, deliveryFee, total,
      dto.branchId ?? null, dto.notes ?? null,
    ]);

    for (const item of itemsData) {
      const [newItem] = await query(`
        INSERT INTO order_items (
          order_id, product_id, variant_id,
          product_name, variant_name,
          unit_price, quantity, subtotal, notes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id
      `, [
        newOrder.id, item.productId, item.variantId,
        item.productName, item.variantName,
        item.unitPrice, item.quantity, item.subtotal,
        item.notes ?? null,
      ]);

      for (const extra of item.extras) {
        await query(`
          INSERT INTO order_item_extras (
            order_item_id, ingredient_id, ingredient_name, unit_price, quantity
          ) VALUES ($1, $2, $3, $4, $5)
        `, [newItem.id, extra.ingredientId, extra.ingredientName, extra.unitPrice, extra.quantity]);
      }
    }

    await query(`
      INSERT INTO order_status_history (order_id, new_status, changed_by)
      VALUES ($1, 'pendiente_pago', 'system')
    `, [newOrder.id]);

    return newOrder;
  }

  async getOrderById(orderId: string) {
    const [order] = await query(`
      SELECT
        o.*,
        o.subtotal::float,
        o.delivery_fee::float AS "deliveryFee",
        o.total::float,
        o.discount::float,
        o.customer_email AS "customerEmail",
        o.order_type AS "orderType",
        o.order_number AS "orderNumber",
        o.branch_id AS "branchId",
        dp.name AS "deliveryPersonName",
        b.name  AS "branchName"
      FROM orders o
      LEFT JOIN delivery_persons dp ON dp.id = o.delivery_person_id
      LEFT JOIN branches b          ON b.id  = o.branch_id
      WHERE o.id = $1
    `, [orderId]);

    if (!order) throw new NotFoundException('Pedido no encontrado.');

    const items = await query(`
      SELECT
        oi.*,
        oi.unit_price::float AS "unitPrice",
        oi.subtotal::float,
        COALESCE(
          json_agg(
            json_build_object(
              'ingredientId',   oie.ingredient_id,
              'ingredientName', oie.ingredient_name,
              'unitPrice',      oie.unit_price::float,
              'quantity',       oie.quantity
            )
          ) FILTER (WHERE oie.id IS NOT NULL),
          '[]'
        ) AS extras
      FROM order_items oi
      LEFT JOIN order_item_extras oie ON oie.order_item_id = oi.id
      WHERE oi.order_id = $1
      GROUP BY oi.id
    `, [orderId]);

    return { ...order, items };
  }

  async listOrders(filters: {
    status?: string;
    branchId?: string;
    date?: string;
    page?: number;
    limit?: number;
  }) {
    const page  = filters.page  ?? 1;
    const limit = Math.min(filters.limit ?? 20, 100);
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const params: any[] = [];

    if (filters.status) {
      params.push(filters.status);
      conditions.push(`o.status = $${params.length}`);
    }
    if (filters.branchId) {
      params.push(filters.branchId);
      conditions.push(`o.branch_id = $${params.length}`);
    }
    if (filters.date) {
      params.push(filters.date);
      conditions.push(`DATE(o.created_at AT TIME ZONE 'America/Mexico_City') = $${params.length}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const limitParam = params.length + 1;
    const offsetParam = params.length + 2;

    const orders = await query(`
      SELECT
        o.id, o.order_number AS "orderNumber", o.customer_name AS "customerName",
        o.customer_phone AS "customerPhone",
        o.order_type AS "orderType", o.status,
        o.subtotal::float, o.delivery_fee::float AS "deliveryFee", o.total::float,
        o.address_street AS "addressStreet", o.address_neighborhood AS "addressNeighborhood",
        o.notes, o.created_at AS "createdAt",
        dp.name AS "deliveryPersonName",
        COUNT(oi.id)::int AS "itemsCount"
      FROM orders o
      LEFT JOIN delivery_persons dp ON dp.id = o.delivery_person_id
      LEFT JOIN order_items oi      ON oi.order_id = o.id
      ${where}
      GROUP BY o.id, dp.name
      ORDER BY o.created_at DESC
      LIMIT $${limitParam} OFFSET $${offsetParam}
    `, [...params, limit, offset]);

    const [{ count }] = await query(
      `SELECT COUNT(*)::int FROM orders o ${where}`,
      params,
    );

    return {
      data: orders,
      pagination: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil(count / limit),
      },
    };
  }

  async updateOrderStatus(orderId: string, dto: UpdateOrderStatusDto) {
    const [current] = await query(`SELECT id, status FROM orders WHERE id = $1`, [orderId]);
    if (!current) throw new NotFoundException('Pedido no encontrado.');

    const [updated] = await query(`
      UPDATE orders SET
        status             = $1,
        delivery_person_id = $2,
        delivered_at       = $3,
        updated_at         = NOW()
      WHERE id = $4
      RETURNING *, order_number AS "orderNumber"
    `, [
      dto.status,
      dto.deliveryPersonId ?? null,
      dto.status === 'entregado' ? new Date() : null,
      orderId,
    ]);

    this.ordersGateway.emitOrderStatusUpdate({
      orderId,
      orderNumber: updated.orderNumber,
      newStatus:   dto.status,
      updatedAt:   new Date().toISOString(),
    });

    return updated;
  }

  async markAsPaid(orderId: string, paymentId: string, paymentMethod: string) {
    const [updated] = await query(`
      UPDATE orders SET
        status         = 'pagado',
        payment_id     = $1,
        payment_method = $2,
        updated_at     = NOW()
      WHERE id     = $3
        AND status = 'pendiente_pago'
      RETURNING *
    `, [paymentId, paymentMethod, orderId]);

    if (!updated) {
      throw new BadRequestException('Pedido no encontrado o ya fue procesado.');
    }

    const fullOrder = await this.getOrderById(orderId);
    this.ordersGateway.emitNewOrder(fullOrder as Record<string, unknown>);

    return updated;
  }

  async getOrderHistory(orderId: string) {
    return query(`
      SELECT * FROM order_status_history
      WHERE order_id = $1
      ORDER BY created_at ASC
    `, [orderId]);
  }
}

// ─────────────────────────────────────────────
// CONTROLLER
// ─────────────────────────────────────────────

import {
  Controller, Get, Post, Patch, Body, Param,
  Query, HttpCode, HttpStatus, ParseUUIDPipe, ValidationPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('Pedidos')
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear pedido (público, guest checkout)' })
  async createOrder(@Body(ValidationPipe) dto: CreateOrderDto) {
    const order = await this.ordersService.createOrder(dto);
    return {
      success: true,
      message: 'Pedido creado. Procede al pago.',
      data: {
        orderId:     order.id,
        orderNumber: order.order_number,
        total:       parseFloat(order.total),
      },
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Ver detalle de un pedido (público)' })
  async getOrder(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.ordersService.getOrderById(id);
    return { success: true, data };
  }

  @Get(':id/history')
  @ApiOperation({ summary: 'Historial de estados de un pedido' })
  async getHistory(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.ordersService.getOrderHistory(id);
    return { success: true, data };
  }

  @Get()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Listar pedidos — Dashboard (requiere JWT)' })
  async listOrders(
    @Query('status')   status?: string,
    @Query('branchId') branchId?: string,
    @Query('date')     date?: string,
    @Query('page')     page?: string,
    @Query('limit')    limit?: string,
  ) {
    const result = await this.ordersService.listOrders({
      status,
      branchId,
      date,
      page:  page  ? parseInt(page)  : 1,
      limit: limit ? parseInt(limit) : 20,
    });
    return { success: true, ...result };
  }

  @Patch(':id/status')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Actualizar estado del pedido — Dashboard' })
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(ValidationPipe) dto: UpdateOrderStatusDto,
  ) {
    const order = await this.ordersService.updateOrderStatus(id, dto);
    return {
      success: true,
      message: `Estado actualizado a: ${dto.status}`,
      data: order,
    };
  }
}

// ─────────────────────────────────────────────
// MODULE
// ─────────────────────────────────────────────

@Module({
  imports:     [ProductsModule],
  controllers: [OrdersController],
  providers:   [OrdersService, OrdersGateway],
  exports:     [OrdersService],
})
export class OrdersModule {}