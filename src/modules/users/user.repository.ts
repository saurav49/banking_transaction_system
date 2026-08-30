import { Prisma } from '../../../generated/prisma/client';
import type { PrismaClient, User } from '../../../generated/prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import { ConflictError } from '../../shared/errors/app-error';

export type PublicUser = Omit<User, 'passwordHash' | 'deletedAt'>;

export interface UserRepository {
  create(input: { name: string; email: string; passwordHash: string }): Promise<PublicUser>;
}

export class PrismaUserRepository implements UserRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  async create(input: {
    name: string;
    email: string;
    passwordHash: string;
  }): Promise<PublicUser> {
    try {
      return await this.db.user.create({
        data: input,
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          status: true,
          createdAt: true,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError('A user with this email already exists');
      }
      throw error;
    }
  }
}
