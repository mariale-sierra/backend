import { Controller, Get, Header } from '@nestjs/common';
import { AppService } from './app.service';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Public } from './auth/decorators/public.decorator';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Public()
  @Get()
  @Header('Content-Type', 'application/json; charset=utf-8')
  @ApiOperation({ summary: 'Verificar estado de la API' })
  @ApiResponse({
    status: 200,
    description: 'API está funcionando correctamente',
  })
  getHello() {
    return this.appService.getHello();
  }
}
