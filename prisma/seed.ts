import { PrismaPg } from '@prisma/adapter-pg';
import { z } from 'zod';
import { PrismaClient } from '../generated/prisma/client';

const seedEnv = z
  .object({
    DATABASE_URL: z.string().min(1),
    ADMIN_NAME: z.string().trim().min(2).max(100),
    ADMIN_EMAIL: z
      .email()
      .trim()
      .transform((value) => value.toLowerCase()),
    ADMIN_PASSWORD: z
      .string()
      .min(16)
      .max(128)
      .regex(/[a-z]/)
      .regex(/[A-Z]/)
      .regex(/[0-9]/)
      .regex(/[^A-Za-z0-9]/),
  })
  .parse(process.env);

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: seedEnv.DATABASE_URL }),
});

try {
  const passwordHash = await Bun.password.hash(seedEnv.ADMIN_PASSWORD, {
    algorithm: 'argon2id',
    memoryCost: 65_536,
    timeCost: 3,
  });

  const admin = await prisma.user.upsert({
    where: { email: seedEnv.ADMIN_EMAIL },
    update: {
      name: seedEnv.ADMIN_NAME,
      passwordHash,
      role: 'ADMIN',
      status: 'ACTIVE',
      deletedAt: null,
    },
    create: {
      name: seedEnv.ADMIN_NAME,
      email: seedEnv.ADMIN_EMAIL,
      passwordHash,
      role: 'ADMIN',
    },
    select: { id: true, email: true, role: true },
  });

  console.log(
    `Seeded ${(admin.role as string).toLowerCase()} user ${admin.email} (${admin.id})`,
  );
} finally {
  await prisma.$disconnect();
}
