import { NestFactory }    from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app    = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');

  app.setGlobalPrefix(process.env.API_PREFIX ?? 'api/v1');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist:            true,
      forbidNonWhitelisted: false,
      transform:            true,
      transformOptions:     { enableImplicitConversion: true },
    }),
  );

  const origins = process.env.CORS_ORIGINS?.split(',') ?? ['http://localhost:3001'];
  app.enableCors({ origin: origins, credentials: true });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('🍕 Pizzería API')
    .setDescription('Sistema de pedidos para pizzería con Stripe')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  const port = parseInt(process.env.PORT ?? '3000');
  await app.listen(port);

  logger.log(`Servidor corriendo en  → http://localhost:${port}/api/v1`);
  logger.log(`Swagger (API docs)     → http://localhost:${port}/docs`);
  logger.log(`WebSocket Dashboard    → ws://localhost:${port}/dashboard`);
}

bootstrap();