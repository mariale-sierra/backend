import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';


async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const publicApiUrl = process.env.PUBLIC_API_URL ?? 'http://20.63.84.1:3000';

  app.use(helmet());

  // The mobile client (Expo/React Native) is not a browser and isn't subject
  // to CORS at all — this only matters for browser-based callers (Swagger UI,
  // a future web client). CORS_ORIGINS is a comma-separated allow-list; with
  // nothing configured we reflect the request origin (permissive but
  // explicit) rather than disabling the check entirely.
  const corsOrigins = process.env.CORS_ORIGINS?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({
    origin: corsOrigins && corsOrigins.length > 0 ? corsOrigins : true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'PUT', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
  const config = new DocumentBuilder()
    .setTitle('Havit - Fitness API')
    .setDescription('API completa para la aplicación de fitness Havit. Incluye endpoints para autenticación, usuarios, rutinas, ejercicios, desafíos y tracking de entrenamientos.')
    .setVersion('1.0')
    .addServer(publicApiUrl)
    .addTag('Auth', 'Endpoints de autenticación y login')
    .addTag('Users', 'Endpoints para gestionar usuarios y perfiles')
    .addTag('Challenges', 'Endpoints para gestionar desafíos')
    .addTag('Exercises', 'Endpoints para gestionar ejercicios')
    .addTag('Routine', 'Endpoints para gestionar rutinas')
    .addTag('Metrics', 'Endpoints para gestionar métricas')
    .addTag('Workout Logs', 'Endpoints para registrar entrenamientos')
    .addBearerAuth() 
    .build();
    
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api-docs', app, document);
  app.useGlobalPipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }),

  
)
  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
  
}
bootstrap();
