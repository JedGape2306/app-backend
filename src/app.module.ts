import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { ProductsModule } from './modules/products/products.module';
import { OrdersModule }   from './modules/orders/orders.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { RawBodyMiddleware } from './common/middleware/raw-body.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    ProductsModule,
    OrdersModule,
    PaymentsModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RawBodyMiddleware).forRoutes({
      path:   'payments/webhook/stripe',
      method: RequestMethod.POST,
    });
  }
}