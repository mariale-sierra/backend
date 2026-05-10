import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({ summary: 'Verificar estado de la API' })
  @ApiResponse({ status: 200, description: 'API está funcionando correctamente' })
  getHello(): string {
    return this.appService.getHello();
  }
}
