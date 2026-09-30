import { DelayedError, Worker } from "bullmq";
import { env } from "../config/env.js";

import { prisma } from "../infrastructure/database/prisma.js";
import { bullmqConnection } from "../queues/connection.js";
import { EMAIL_QUEUE_NAME } from "../queues/email.queue.js";
import { sendScheduledEmail } from "../modules/emails/email.service.js";
import { reserveSendSlot } from "../infrastructure/rate-limit/email-rate-limiter.js";

export const emailWorker = new Worker(
  EMAIL_QUEUE_NAME,
  async (job, token) => {
    console.log(`PROCESSING EMAIL JOB: ${job.id}`);

    const emailId = job.data?.emailId;

    if (typeof emailId !== "string") {
      throw new Error(`Invalid emailId in job ${job.id}`);
    }

    const email = await prisma.scheduledEmail.findUnique({
      where: {
        id: emailId,
      },
      include: {
        batch: true,
        sender: true,
      },
    });

    if (!email) {
      throw new Error(`Scheduled email ${emailId} was not found`);
    }

    if (email.status === "SENT" || email.status === "CANCELLED") {
      console.log(`EMAIL SKIPPED: ${email.id} is already ${email.status}`);
      return {
        status: email.status.toLowerCase(),
        emailId: email.id,
      };
    }

    const decision = await reserveSendSlot({
      workspaceId: email.workspaceId,
      senderId: email.senderId,
      jobId: job.id ?? email.id,
      hourlyLimit: email.batch.hourlyLimit,
      minDelayMs: email.batch.delayMs,
    });

    if (!decision.allowed) {
      const retryAt = Math.max(
        decision.retryAt,
        Date.now() + 100,
      );

      console.log(
        `RATE LIMITED: ${email.id} (${decision.reason}), retrying at ${new Date(retryAt).toISOString()}`,
      );

      await job.moveToDelayed(retryAt, token);

      throw new DelayedError();
    }

    console.log(`SEND SLOT RESERVED: ${email.id}`);

    const result = await sendScheduledEmail(email.id);

    console.log("EMAIL RESULT:", result);

    return result;
  },
  {
    connection: bullmqConnection,
    concurrency: env.WORKER_CONCURRENCY,
  },
);

emailWorker.on("completed", (job) => {
  console.log(`JOB COMPLETED: ${job.id}`);
});

emailWorker.on("failed", (job, error) => {
  console.error(`JOB FAILED: ${job?.id}`, error);
});

emailWorker.on("error", (error) => {
  console.error("WORKER ERROR:", error);
});
