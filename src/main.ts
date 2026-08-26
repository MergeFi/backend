import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe, LoggerService, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppConfig } from './config/configuration';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';

const INSECURE_DEFAULT_JWT_SECRET = 'insecure-dev-secret';

const LOG_LEVEL_MAP: Record<string, string[]> = {
  error: ['error'],
  warn: ['error', 'warn'],
  log: ['error', 'warn', 'log'],
  debug: ['error', 'warn', 'log', 'debug'],
  verbose: ['error', 'warn', 'log', 'debug', 'verbose'],
};

function resolveLogLevels(level: string): string[] {
  return LOG_LEVEL_MAP[level.toLowerCase()] ?? LOG_LEVEL_MAP.log;
}

async function bootstrap() {
  // rawBody: true preserves the raw request buffer on req.rawBody, which the
  // GitHub webhooks controller needs to verify the HMAC-SHA256 signature.
  const app = await NestFactory.create(AppModule, { rawBody: true });

  const configService = app.get(ConfigService<AppConfig, true>);

  const env = configService.get('env', { infer: true });
  const logLevel = configService.get('logLevel', { infer: true });
  app.useLogger(resolveLogLevels(logLevel));
  const jwtSecret = configService.get('jwt', { infer: true }).secret;
  if (env === 'production' && jwtSecret === INSECURE_DEFAULT_JWT_SECRET) {
    throw new Error(
      'Refusing to start in production with the default JWT_SECRET. Set a real JWT_SECRET env var.',
    );
  }

  app.use(helmet());
  app.enableCors({
    origin: configService.get('frontendUrl', { infer: true }),
    credentials: true,
  });
  app.setGlobalPrefix('api', { exclude: ['/'] });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new GlobalExceptionFilter());

  // The generated OpenAPI document hands anyone a complete, browsable map of
  // the API (routes, DTO shapes, validation constraints), so it is never
  // exposed in production — same spirit as the JWT-secret guard above.
  if (env !== 'production') {
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
  }

  const port = configService.get('port', { infer: true });
  await app.listen(port);

  console.log(
    env === 'production'
      ? `MergeFi backend listening on port ${port}`
      : `MergeFi backend listening on port ${port} — docs at /api/docs`,
  );
}
void bootstrap();
