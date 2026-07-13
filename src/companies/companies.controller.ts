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
import { Roles } from '../common/decorators';
import type { Company } from '../generated/prisma/client';
import { Role } from '../generated/prisma/enums';
import { CompaniesService } from './companies.service';
import { CreateCompanyDto, UpdateCompanyDto } from './dto/company.dto';

@ApiTags('companies')
@ApiBearerAuth()
@Controller('companies')
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a company' })
  create(@Body() dto: CreateCompanyDto): Promise<Company> {
    return this.companiesService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List companies, optionally filtered by name' })
  findAll(@Query('search') search?: string): Promise<Company[]> {
    return this.companiesService.findAll(search);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<Company> {
    return this.companiesService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCompanyDto,
  ): Promise<Company> {
    return this.companiesService.update(id, dto);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a company (admin only)' })
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.companiesService.remove(id);
  }
}
