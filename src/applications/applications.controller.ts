import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators';
import type { AuthUser } from '../common/decorators';
import type { Application } from '../generated/prisma/client';
import { ApplicationsService } from './applications.service';
import type { PaginatedApplications } from './applications.service';
import {
  CreateApplicationDto,
  QueryApplicationsDto,
  UpdateApplicationDto,
  UpdateStatusDto,
} from './dto/application.dto';

@ApiTags('applications')
@ApiBearerAuth()
@Controller('applications')
export class ApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}

  @Post()
  @ApiOperation({ summary: 'Track a new job application' })
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateApplicationDto,
  ): Promise<Application> {
    return this.applications.create(user, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List your applications (paginated, filterable)' })
  findAll(
    @CurrentUser() user: AuthUser,
    @Query() query: QueryApplicationsDto,
  ): Promise<PaginatedApplications> {
    return this.applications.findAll(user, query);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Pipeline counts grouped by status' })
  stats(@CurrentUser() user: AuthUser) {
    return this.applications.stats(user);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Application> {
    return this.applications.findOne(user, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateApplicationDto,
  ): Promise<Application> {
    return this.applications.update(user, id, dto);
  }

  @Patch(':id/status')
  @ApiOperation({
    summary: 'Advance the application through its state machine',
  })
  updateStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStatusDto,
  ): Promise<Application> {
    return this.applications.updateStatus(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.applications.remove(user, id);
  }
}
