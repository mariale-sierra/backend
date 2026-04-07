import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Req } from '@nestjs/common';
import { ChallengesService } from './challenges.service';
import { CreateChallengeDto } from './dto/create-challenge.dto';
import { UpdateChallengeDto } from './dto/update-challenge.dto';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';

@Controller('challenges')
export class ChallengesController {
  constructor(private readonly challengesService: ChallengesService) {}

  @Post()
  @UseGuards(SupabaseAuthGuard)
  create(@Body() dto: CreateChallengeDto, @Req() req) {
    return this.challengesService.create(dto, req.user.id);
  }

  @Get()
  findAll() {
    return this.challengesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.challengesService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateChallengeDto: UpdateChallengeDto) {
    return this.challengesService.update(+id, updateChallengeDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.challengesService.remove(+id);
  }
}
