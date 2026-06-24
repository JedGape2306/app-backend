// ============================================================
// MÓDULO: Payments — Integración completa con Stripe
// ============================================================

import {
  Injectable, BadRequestException, Logger,
  Controller, Post, Param, Body, Headers, Req,
  HttpCode, HttpStatus, Module, RawBodyRequest,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { IsUUID, IsEnum, IsOptional } from 'class-validator';
import { Request } from 'express';
import Stripe from 'stripe';

import { query } from '../../config/database.config';
import { OrdersService, OrdersModule } from '../orders/orders.module';

export class CreatePaymentSessionDto {
  @IsUUID()
  orderId: string;

  @IsOptional()
  @IsEnum(['card', 'oxxo'])
  paymentMethod?: 'card' | 'oxxo';
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  private readonly stripe = new Stripe(
    process.env.STRIPE_SECRET_KEY ?? '',
    { apiVersion: '2023-10-16' },
  );

  constructor(private readonly ordersService: OrdersService) {}

  async createPaymentSession(dto: CreatePaymentSessionDto) {
    const order: any = await this.ordersService.getOrderById(dto.orderId);

    if (order.status !== 'pendiente_pago') {
      throw new BadRequestException(
        'Este pedido no está pendiente de pago. Estado actual: ' + order.status,
      );
    }

    const paymentMethod = dto.paymentMethod ?? 'card';
    const businessName  = process.env.BUSINESS_NAME ?? 'Pizzería';
    const frontendUrl   = process.env.FRONTEND_URL  ?? 'http://localhost:3001';

    const paymentMethodTypes: Stripe.Checkout.SessionCreateParams.PaymentMethodType[] =
      paymentMethod === 'oxxo' ? ['oxxo'] : ['card'];

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode:                 'payment',
      payment_method_types: paymentMethodTypes,
      customer_email:       order.customerEmail ?? undefined,

      line_items: [
        {
          price_data: {
            currency:     'mxn',
            unit_amount:  Math.round((order.total as number) * 100),
            product_data: {
              name:        `Pedido #${order.orderNumber} — ${businessName}`,
              description: `${order.items?.length ?? 0} producto(s) | ${order.orderType === 'delivery' ? 'Entrega a domicilio' : 'Recoger en sucursal'}`,
            },
          },
          quantity: 1,
        },
      ],

      metadata: {
        orderId:     order.id as string,
        orderNumber: String(order.orderNumber),
      },

      success_url: `${frontendUrl}/pedido/${order.id}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${frontendUrl}/pedido/${order.id}?payment=cancelled`,
    };

    if (paymentMethod === 'oxxo') {
      sessionParams.payment_method_options = {
        oxxo: { expires_after_days: 3 },
      };
    }

    const session = await this.stripe.checkout.sessions.create(sessionParams);

    await query(`
      INSERT INTO payments (
        order_id, gateway, stripe_session_id,
        status, amount, currency, payment_method
      ) VALUES ($1, 'stripe', $2, 'pendiente', $3, 'MXN', $4)
    `, [order.id, session.id, order.total, paymentMethod]);

    this.logger.log(
      `Sesión Stripe creada | Orden #${order.orderNumber} | Método: ${paymentMethod} | Total: $${order.total} MXN`,
    );

    return {
      orderId:       order.id,
      orderNumber:   order.orderNumber,
      total:         order.total,
      currency:      'MXN',
      paymentMethod,
      checkoutUrl:   session.url,
      sessionId:     session.id,
      expiresAt:     session.expires_at
        ? new Date(session.expires_at * 1000).toISOString()
        : null,
    };
  }

  async handleStripeWebhook(rawBody: Buffer, signature: string) {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? '';

    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch (err: any) {
      this.logger.error(`Webhook: firma inválida — ${err.message}`);
      throw new BadRequestException(`Firma de webhook inválida: ${err.message}`);
    }

    this.logger.log(`Webhook recibido: ${event.type}`);

    switch (event.type) {
      case 'checkout.session.completed': {
        await this.handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      }
      case 'payment_intent.succeeded': {
        await this.handlePaymentIntentSucceeded(event.data.object as Stripe.PaymentIntent);
        break;
      }
      case 'payment_intent.payment_failed': {
        await this.handlePaymentFailed(event.data.object as Stripe.PaymentIntent);
        break;
      }
      default:
        this.logger.log(`Evento ignorado: ${event.type}`);
    }

    return { received: true };
  }

  private async handleCheckoutCompleted(session: Stripe.Checkout.Session) {
    const orderId = session.metadata?.orderId;
    if (!orderId) {
      this.logger.warn('checkout.session.completed sin orderId en metadata');
      return;
    }

    const paymentMethod = session.payment_method_types?.[0] === 'oxxo'
      ? 'oxxo'
      : 'card';

    if (paymentMethod === 'oxxo' && session.payment_status !== 'paid') {
      this.logger.log(`OXXO voucher generado para orden ${orderId} — esperando pago en tienda`);
      return;
    }

    const paymentIntentId = typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id ?? session.id;

    await query(`
      UPDATE payments SET
        status                   = 'aprobado',
        stripe_payment_intent_id = $1,
        payment_method           = $2,
        raw_response             = $3::jsonb,
        paid_at                  = NOW(),
        updated_at               = NOW()
      WHERE stripe_session_id = $4
    `, [paymentIntentId, paymentMethod, JSON.stringify(session), session.id]);

    await this.ordersService.markAsPaid(orderId, paymentIntentId, paymentMethod);

    this.logger.log(
      `✅ Pago aprobado | Orden ${orderId} | Método: ${paymentMethod} | PI: ${paymentIntentId}`,
    );
  }

  private async handlePaymentIntentSucceeded(paymentIntent: Stripe.PaymentIntent) {
    const rows = await query(`
      SELECT p.*, o.status AS "orderStatus", p.order_id AS "orderId"
      FROM payments p
      JOIN orders o ON o.id = p.order_id
      WHERE p.stripe_payment_intent_id = $1
         OR p.stripe_session_id = $1
      LIMIT 1
    `, [paymentIntent.id]);

    const payment = rows[0];

    if (!payment || payment.orderStatus !== 'pendiente_pago') {
      return;
    }

    const paymentMethod = paymentIntent.payment_method_types?.[0] === 'oxxo'
      ? 'oxxo'
      : 'card';

    await query(`
      UPDATE payments SET
        status                   = 'aprobado',
        stripe_payment_intent_id = $1,
        payment_method           = $2,
        raw_response             = $3::jsonb,
        paid_at                  = NOW(),
        updated_at               = NOW()
      WHERE id = $4
    `, [paymentIntent.id, paymentMethod, JSON.stringify(paymentIntent), payment.id]);

    await this.ordersService.markAsPaid(
      payment.orderId,
      paymentIntent.id,
      paymentMethod,
    );

    this.logger.log(`✅ PaymentIntent succeeded | OXXO | PI: ${paymentIntent.id}`);
  }

  private async handlePaymentFailed(paymentIntent: Stripe.PaymentIntent) {
    const rows = await query(`
      SELECT id FROM payments
      WHERE stripe_payment_intent_id = $1
      LIMIT 1
    `, [paymentIntent.id]);

    const payment = rows[0];

    if (payment) {
      await query(`
        UPDATE payments SET
          status       = 'rechazado',
          raw_response = $1::jsonb,
          updated_at   = NOW()
        WHERE id = $2
      `, [JSON.stringify(paymentIntent), payment.id]);
    }

    const errorMsg = paymentIntent.last_payment_error?.message ?? 'Pago rechazado';
    this.logger.warn(`❌ Pago fallido | PI: ${paymentIntent.id} | ${errorMsg}`);
  }

  async simulatePayment(orderId: string) {
    if (process.env.NODE_ENV === 'production') {
      throw new BadRequestException('Endpoint no disponible en producción.');
    }

    const fakePaymentId = `sim_${Date.now()}`;

    await query(`
      INSERT INTO payments (order_id, gateway, stripe_session_id, status, amount, currency, payment_method)
      SELECT id, 'stripe_sim', $1, 'aprobado', total, 'MXN', 'card'
      FROM orders WHERE id = $2
    `, [fakePaymentId, orderId]);

    await this.ordersService.markAsPaid(orderId, fakePaymentId, 'card');

    this.logger.log(`[DEV] Pago simulado para orden ${orderId}`);
    return { success: true, message: 'Pago simulado exitosamente.', paymentId: fakePaymentId };
  }
}

@ApiTags('Pagos')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('create-session')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Crear sesión de pago Stripe' })
  async createSession(@Body() dto: CreatePaymentSessionDto) {
    return this.paymentsService.createPaymentSession(dto);
  }

  @Post('webhook/stripe')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Webhook de Stripe (no llamar manualmente)' })
  async stripeWebhook(
    @Req() req: RawBodyRequest<Request> & { rawBody?: Buffer },
    @Headers('stripe-signature') signature: string,
  ) {
    const rawBody = req.rawBody;

    if (!rawBody) {
      throw new BadRequestException(
        'rawBody no disponible. Verifica que RawBodyMiddleware esté configurada.',
      );
    }

    if (!signature) {
      throw new BadRequestException('Header stripe-signature requerido.');
    }

    return this.paymentsService.handleStripeWebhook(rawBody, signature);
  }

  @Post('simulate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[SOLO DEV] Simular pago exitoso' })
  async simulate(@Body('orderId') orderId: string) {
    return this.paymentsService.simulatePayment(orderId);
  }
}

@Module({
  imports:     [OrdersModule],
  controllers: [PaymentsController],
  providers:   [PaymentsService],
})
export class PaymentsModule {}