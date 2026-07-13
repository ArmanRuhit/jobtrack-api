import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import { Request } from 'express';
import { Role } from '../../generated/prisma/enums';

export const IS_PUBLIC_KEY = 'isPublic';
export const ROLES_KEY = 'roles';

/** Opt a route out of the globally-applied JwtAuthGuard. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Restrict a route to the given roles (enforced by RolesGuard). */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
}

/** Pulls the authenticated principal off the request — @AuthenticationPrincipal's cousin. */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthUser | undefined, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const user = req.user;
    if (!user) return undefined;
    return data ? user[data] : user;
  },
);
