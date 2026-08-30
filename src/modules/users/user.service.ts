import type { AuthenticatedUser } from '../auth/token.service';
import { AuthorizationError } from '../../shared/errors/app-error';
import type { CreateUserInput } from './user.schemas';
import type { PublicUser, UserRepository } from './user.repository';

export class UserService {
  constructor(private readonly repository: UserRepository) {}

  async createUser(actor: AuthenticatedUser, input: CreateUserInput): Promise<PublicUser> {
    if (actor.role !== 'ADMIN') {
      throw new AuthorizationError();
    }

    const passwordHash = await Bun.password.hash(input.password, {
      algorithm: 'argon2id',
      memoryCost: 65_536,
      timeCost: 3,
    });

    return this.repository.create({
      name: input.name,
      email: input.email,
      passwordHash,
    });
  }
}
