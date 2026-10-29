import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

// BigInt (id журнала) в JSON — строкой
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // сколько прокси перед API (в Docker: caddy → nginx = 2). Реальный IP клиента — из X-Forwarded-For,
  // ему доверяем ровно на столько звеньев, чтобы пользователь не мог подставить чужой адрес.
  app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 1));
  app.disable('x-powered-by');
  app.use(cookieParser());
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();

  // документация API — только по явному разрешению (при разработке)
  const docs = process.env.API_DOCS === 'true' || process.env.NODE_ENV !== 'production';
  if (docs) {
    const doc = new DocumentBuilder().setTitle('МВС СТ API').setVersion('0.1').addCookieAuth('mvs_sid').build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, doc));
  }

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  console.log(`API: http://localhost:${port}/api${docs ? '  (документация: /api/docs)' : ''}`);
}
bootstrap();
