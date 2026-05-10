import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';


async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const publicApiUrl = process.env.PUBLIC_API_URL ?? 'http://20.63.84.1:3000';
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
