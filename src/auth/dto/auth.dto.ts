import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'arman@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'Ruhit Arman' })
  @IsString()
  @MinLength(2)
  name!: string;

  @ApiProperty({ example: 'S3curePassw0rd!', minLength: 8 })
  @IsString()
  @MinLength(8)
  password!: string;
}

export class LoginDto {
  @ApiProperty({ example: 'arman@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'S3curePassw0rd!' })
  @IsString()
  password!: string;
}

export class RefreshDto {
  @ApiProperty()
  @IsString()
  refreshToken!: string;
}

export class TokensDto {
  @ApiProperty()
  accessToken!: string;

  @ApiProperty()
  refreshToken!: string;
}
