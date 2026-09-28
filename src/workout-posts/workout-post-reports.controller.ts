import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { WorkoutPostReportsService } from './workout-post-reports.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { AdminGuard } from '../auth/guards/admin.guard';
import {
  CreateReportDto,
  PendingReportsQueryDto,
  ResolveReportDto,
} from './dto/report.dto';

@ApiTags('Workout Post Reports')
@ApiBearerAuth()
@Controller('reports')
export class WorkoutPostReportsController {
  constructor(private readonly reportsService: WorkoutPostReportsService) {}

  @Post()
  @ApiOperation({
    summary: 'Reportar un post o comentario',
    description:
      'El usuario autenticado reporta un workout post (targetType=post, UUID) o un comentario (targetType=comment, id numérico). Chats y spaces no se pueden reportar.',
  })
  @ApiOkResponse({ description: '{ id, status: "pending", message }' })
  @ApiBadRequestResponse({
    description: 'targetId inválido, motivo inválido o contenido propio',
  })
  @ApiNotFoundResponse({ description: 'Contenido no encontrado u oculto' })
  @ApiConflictResponse({ description: 'Ya reportaste este contenido' })
  create(@Body() dto: CreateReportDto, @CurrentUser() user: AuthenticatedUser) {
    return this.reportsService.create(user.sub, dto);
  }

  @Get('pending')
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: 'Listar reportes pendientes (admin)',
    description:
      'Reportes pendientes, más antiguos primero, con vista previa del contenido y strikes del autor. Solo administradores.',
  })
  @ApiOkResponse({ description: '{ reports, nextAfter }' })
  @ApiForbiddenResponse({ description: 'Solo administradores' })
  listPending(@Query() query: PendingReportsQueryDto) {
    return this.reportsService.listPending({
      after: query.after,
      limit: query.limit,
    });
  }

  @Patch(':id/resolve')
  @UseGuards(AdminGuard)
  @ApiParam({ name: 'id', description: 'ID del reporte' })
  @ApiOperation({
    summary: 'Resolver un reporte (admin)',
    description:
      "action='dismiss' descarta; action='hide' oculta el contenido (y con penalize=true registra un strike al autor). Atómico; un reporte ya resuelto responde 409.",
  })
  @ApiOkResponse({ description: 'Resultado de la resolución' })
  @ApiForbiddenResponse({ description: 'Solo administradores' })
  @ApiNotFoundResponse({ description: 'Reporte no encontrado' })
  @ApiConflictResponse({ description: 'Reporte ya resuelto' })
  resolve(
    @Param('id', new ParseIntPipe()) id: number,
    @Body() dto: ResolveReportDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reportsService.resolve(id, user.sub, dto);
  }
}
