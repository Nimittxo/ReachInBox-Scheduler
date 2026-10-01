import express from "express";
import cors from "cors";

import { prisma } from "./infrastructure/database/prisma.js";
import { env } from "./config/env.js";
import { redis } from "./infrastructure/redis/redis.js";
import { elasticsearch } from "./infrastructure/elasticsearch/client.js";
import { batchRouter } from "./modules/batches/batch.routes.js";
import { emailRouter } from "./modules/emails/email.routes.js";
import { bullBoardRouter } from "./infrastructure/queues/bull-board.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { slackRouter } from "./modules/slack/slack.route.js";
export const app = express();

app.use(cors({ origin: env.FRONTEND_URL, credentials: true }));
app.use(express.json());
app.use("/api/slack", slackRouter);
app.get("/", (_req, res) => {
  res.json({
    service: "reachbox-backend",
    status: "running",
  });
});

app.get("/health", async (_req, res) => {
  const checks = {
    database: false,
    redis: false,
    elasticsearch: false,
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = true;
  } catch {}

  try {
    checks.redis = (await redis.ping()) === "PONG";
  } catch {}

  try {
    checks.elasticsearch = (await elasticsearch.ping()) === true;
  } catch {}

  const healthy = Object.values(checks).every(Boolean);

  res.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "degraded",
    service: "reachbox-backend",
    dependencies: checks,
  });
});

app.use("/api/auth", authRouter);
app.use("/api/batches", batchRouter);
app.use("/api/emails", emailRouter);
app.use("/admin/queues", bullBoardRouter);
