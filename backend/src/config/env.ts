import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  PORT: z.coerce
    .number()
    .int()
    .positive()
    .default(4000),

  WORKER_CONCURRENCY: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(5),

  DATABASE_URL: z.string().min(1),

  REDIS_HOST: z.string().min(1).default("localhost"),

  REDIS_PORT: z.coerce
    .number()
    .int()
    .positive()
    .default(6379),

  ELASTICSEARCH_URL: z.string().url(),

  ETHEREAL_HOST: z.string().min(1),

  ETHEREAL_PORT: z.coerce
    .number()
    .int()
    .positive()
    .default(587),

  ETHEREAL_USER: z.string().min(1),

  ETHEREAL_PASSWORD: z.string().min(1),

  ETHEREAL_FROM: z.string().min(1),

  GOOGLE_CLIENT_ID: z.string().min(1),

  GOOGLE_CLIENT_SECRET: z.string().min(1),

  GOOGLE_CALLBACK_URL: z.string().url(),

  AUTH_JWT_SECRET: z.string().min(32),

  FRONTEND_URL: z.string().url(),
});

export const env = envSchema.parse(process.env);
