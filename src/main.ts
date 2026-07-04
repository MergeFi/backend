import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AppConfig } from './config/configuration';

async function bootstrap() {
  // rawBody: true preserves the raw request buffer on req.rawBody, which the
  // GitHub webhooks controller needs to verify the HMAC-SHA256 signature.
  const app = await NestFactory.create(AppModule, { rawBody: true });

  const configService = app.get(ConfigService<AppConfig, true>);

  app.enableCors({
    origin: configService.get('frontendUrl', { infer: true }),
    credentials: true,
  });
  app.setGlobalPrefix('api', { exclude: ['/'] });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('MergeFi API')
    .setDescription(
      'Where Open Source Meets Finance — GitHub bounty escrow orchestration on Stellar/Soroban.',
    )
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  const port = configService.get('port', { infer: true });
  await app.listen(port);

  console.log(`MergeFi backend listening on port ${port} — docs at /api/docs`);
}
void bootstrap();
