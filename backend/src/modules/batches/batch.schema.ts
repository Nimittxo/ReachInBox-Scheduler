import { z } from "zod";

const recipientSchema = z.object({
  email: z.string().email(),
  name: z.string().trim().min(1).max(200).optional(),
});

export const createBatchSchema = z.object({
  workspaceId: z.string().uuid(),
  createdById: z.string().uuid(),
  senderId: z.string().uuid(),

  name: z.string().trim().min(1).max(200).optional(),

  subject: z.string().trim().min(1).max(998),
  body: z.string().min(1),

  startAt: z.coerce.date(),

  delayMs: z
    .number()
    .int()
    .min(0)
    .max(24 * 60 * 60 * 1000),

  hourlyLimit: z
    .number()
    .int()
    .min(1)
    .max(100_000),

  recipients: z
    .array(recipientSchema)
    .min(1)
    .max(100_000),
});

export type CreateBatchInput = z.infer<typeof createBatchSchema>;
