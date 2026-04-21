import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Req } from '@nestjs/common';
import { ChallengesService } from './challenges.service';
import { CreateChallengeDto } from './dto/create-challenge.dto';
import { UpdateChallengeDto } from './dto/update-challenge.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('challenges')
export class ChallengesController {
  constructor(private readonly challengesService: ChallengesService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Body() dto: CreateChallengeDto, @Req() req) {
    return this.challengesService.create(dto, req.user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/join')
  join(@Param('id') challengeId: string, @Req() req) {
    return this.challengesService.joinChallenge(req.user.sub, challengeId);
  }
  @Get()
  findAll() {
    return this.challengesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.challengesService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateChallengeDto: UpdateChallengeDto) {
    return this.challengesService.update(id, updateChallengeDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.challengesService.remove(id);
  }
}
