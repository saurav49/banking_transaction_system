import { z } from 'zod';

export const accountParamsSchema = z.object({ userId: z.uuid() });
