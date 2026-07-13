import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { SignOptions } from 'jsonwebtoken';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto, RegisterDto, TokensDto } from './dto/auth.dto';
import { JwtPayload } from './jwt.strategy';

const SALT_ROUNDS = 12;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto): Promise<TokensDto> {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true },
    });
    if (existing) throw new ConflictException('Email already registered');

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        name: dto.name,
        passwordHash: await bcrypt.hash(dto.password, SALT_ROUNDS),
      },
      select: { id: true, email: true, role: true },
    });

    return this.issueTokens(user.id, user.email, user.role);
  }

  async login(dto: LoginDto): Promise<TokensDto> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    // Always compare against *something* so response time doesn't reveal
    // whether the email exists (timing side-channel).
    const hash =
      user?.passwordHash ??
      '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidin';
    const ok = await bcrypt.compare(dto.password, hash);

    if (!user || !ok) throw new UnauthorizedException('Invalid credentials');

    return this.issueTokens(user.id, user.email, user.role);
  }

  /**
   * Refresh-token rotation: the presented token is revoked and a new one issued.
   * Tokens are stored only as SHA-256 hashes, so a DB leak yields nothing usable.
   */
  async refresh(refreshToken: string): Promise<TokensDto> {
    try {
      // Signature + expiry must hold before we even look the token up.
      await this.jwt.verifyAsync<JwtPayload>(refreshToken, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const tokenHash = this.hash(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: { select: { id: true, email: true, role: true } } },
    });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      // Reuse of a revoked token means the token was stolen — nuke the family.
      if (stored?.revokedAt) {
        await this.prisma.refreshToken.updateMany({
          where: { userId: stored.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      throw new UnauthorizedException('Invalid refresh token');
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokens(
      stored.user.id,
      stored.user.email,
      stored.user.role,
    );
  }

  async logout(userId: string): Promise<{ revoked: number }> {
    const res = await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { revoked: res.count };
  }

  private async issueTokens(
    userId: string,
    email: string,
    role: JwtPayload['role'],
  ): Promise<TokensDto> {
    const payload: JwtPayload = { sub: userId, email, role };

    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.ttl('JWT_ACCESS_TTL'),
    });

    // Entropy in the payload so two refreshes in the same second differ.
    const refreshToken = await this.jwt.signAsync(
      { ...payload, jti: randomBytes(16).toString('hex') },
      {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.ttl('JWT_REFRESH_TTL'),
      },
    );

    const { exp } = this.jwt.decode<{ exp: number }>(refreshToken);

    await this.prisma.refreshToken.create({
      data: {
        tokenHash: this.hash(refreshToken),
        userId,
        expiresAt: new Date(exp * 1000),
      },
    });

    return { accessToken, refreshToken };
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** jsonwebtoken types expiresIn as a template-literal union ("15m"), not plain string. */
  private ttl(key: string): SignOptions['expiresIn'] {
    return this.config.getOrThrow<string>(key) as SignOptions['expiresIn'];
  }
}
