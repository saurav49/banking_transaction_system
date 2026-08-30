import { z } from 'zod';

export const loginSchema = z
  .object({
    email: z
      .email()
      .trim()
      .max(254)
      .transform((value) => value.toLowerCase()),
    password: z.string().min(1).max(128),
  })
  .strict();

export const refreshTokenSchema = z
  .object({
    refreshToken: z.string().min(32).max(256),
  })
  .strict();
