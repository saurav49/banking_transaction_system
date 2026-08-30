import { z } from 'zod';

const strongPassword = z
  .string()
  .min(12, 'Password must contain at least 12 characters')
  .max(128)
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/[0-9]/, 'Password must contain a number')
  .regex(/[^A-Za-z0-9]/, 'Password must contain a special character');

export const createUserSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    email: z
      .email()
      .trim()
      .max(254)
      .transform((value) => value.toLowerCase()),
    password: strongPassword,
  })
  .strict();

export type CreateUserInput = z.infer<typeof createUserSchema>;
