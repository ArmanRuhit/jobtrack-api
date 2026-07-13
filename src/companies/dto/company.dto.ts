import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsOptional, IsString, IsUrl, MinLength } from 'class-validator';

export class CreateCompanyDto {
  @ApiProperty({ example: 'RemoteIntegrity' })
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiPropertyOptional({ example: 'https://remoteintegrity.com' })
  @IsOptional()
  @IsUrl()
  website?: string;

  @ApiPropertyOptional({ example: 'Software' })
  @IsOptional()
  @IsString()
  industry?: string;
}

export class UpdateCompanyDto extends PartialType(CreateCompanyDto) {}
