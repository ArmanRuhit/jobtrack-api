import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  app.use(helmet());
  app.enableCors({ origin: true, credentials: true });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip properties with no DTO decorator
      forbidNonWhitelisted: true, // ...and reject the request if any were sent
      transform: true, // turn plain JSON into DTO class instances
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  const swagger = new DocumentBuilder()
    .setTitle('JobTrack API')
    .setDescription(
      'Track job applications: companies, applications, a status state machine, ' +
        'JWT auth with refresh-token rotation, and background reminders.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swagger), {
    jsonDocumentUrl: 'docs/json',
  });

  app.enableShutdownHooks();

  const port = config.getOrThrow<number>('PORT');
  await app.listen(port, '0.0.0.0');

  new Logger('Bootstrap').log(
    `JobTrack API listening on :${port} — docs at /docs`,
  );
}

void bootstrap();
