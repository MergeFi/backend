import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { Logger, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import configuration, { AppConfig } from './config/configuration';
import { assertRequiredConfig } from './config/validate-required-config';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { resolveLogLevels, startupMessage } from './config/log-levels';
import { swaggerBasicAuth } from './common/swagger/swagger-basic-auth';

export async function bootstrap() {
  // Fail fast and loudly if *any* required-in-production secret is missing —
  // not just JWT_SECRET. An empty GITHUB_WEBHOOK_SECRET, TREASURY_SECRET,
  // ESCROW_CONTRACT_ID, GITHUB_CLIENT_SECRET or a default DATABASE_URL all
  // otherwise let the app boot "healthy" while silently misbehaving (#153).
  //
  // This must run before NestFactory.create (#551): creating the app already
  // connects TypeORM (falling back to postgres:postgres@localhost), builds the
  // Octokit client and starts the schedulers, so a misconfigured production
  // pod used to hang or die on a DB error that hid this list. Validate the
  // same `configuration()` the ConfigModule loads: importing AppModule above
  // already ran ConfigModule.forRoot, which merges `.env` into process.env
  // synchronously, so the raw env is complete here.
  assertRequiredConfig(configuration());

  // rawBody: true preserves the raw request buffer on req.rawBody, which the
  // GitHub webhooks controller needs to verify the HMAC-SHA256 signature.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });

  const configService = app.get(ConfigService<AppConfig, true>);
  app
    .getHttpAdapter()
    .getInstance()
    .set('trust proxy', configService.get('trustProxy', { infer: true }));

  const env = configService.get('env', { infer: true });
  const logLevel = configService.get('logLevel', { infer: true });
  app.useLogger(resolveLogLevels(logLevel || 'log'));

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
      // Explicit, not dependent on the class-validator version: without it a
      // handler whose parameter has no validation metadata receives the raw
      // body unchecked (#808).
      forbidUnknownValues: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.useGlobalFilters(new GlobalExceptionFilter());

  // The OpenAPI document is a complete, browsable map of the API. In production
  // it is served only when SWAGGER_BASIC_AUTH ("user:password") is set, and then
  // only behind HTTP Basic auth, so the production API still has a contract for
  // consumers and contract tests (#809). Without the variable it stays hidden.
  // The credentials are never logged.
  const docsCredentials = process.env.SWAGGER_BASIC_AUTH?.trim();
  if (env !== 'production' || docsCredentials) {
    if (env === 'production' && docsCredentials) {
      app.use(
        ['/api/docs', '/api/docs-json', '/api/docs-yaml'],
        swaggerBasicAuth(docsCredentials),
      );
    }
    const swaggerConfig = new DocumentBuilder()
      .setTitle('MergeFi API')
      .setDescription(
        'Where Open Source Meets Finance — GitHub bounty escrow orchestration on Stellar/Soroban.',
      )
      .setVersion('0.1.0')
      // The JWT strategy accepts a bearer header or the access_token cookie
      // set by the GitHub callback (#809). Both are advertised so a generated
      // client can express either.
      .addBearerAuth()
      .addCookieAuth('access_token')
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = configService.get('port', { infer: true });
  await app.listen(port);

  // Go through Nest's Logger (not raw stdout) so the banner honours
  // LOG_LEVEL and any logger/transport installed via app.useLogger (#362).
  new Logger('Bootstrap').log(startupMessage(env, port));
}
// Only boot when run as the entry point (`node dist/main`, `nest start`), so
// tests can import bootstrap() without starting the app.
if (require.main === module) {
  void bootstrap();
}
