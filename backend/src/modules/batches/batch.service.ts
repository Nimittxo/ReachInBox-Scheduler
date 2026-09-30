import { prisma } from "../../infrastructure/database/prisma.js";
import type { CreateBatchInput } from "./batch.schema.js";

export async function createBatch(input: CreateBatchInput) {
  return prisma.$transaction(async (tx) => {
    const batch = await tx.emailBatch.create({
      data: {
        workspaceId: input.workspaceId,
        createdById: input.createdById,
        name: input.name,
        subject: input.subject,
        body: input.body,
        startAt: input.startAt,
        delayMs: input.delayMs,
        hourlyLimit: input.hourlyLimit,
        status: "PENDING",
      },
    });

    const emails = input.recipients.map((recipient, index) => {
      const scheduledAt = new Date(
        input.startAt.getTime() + index * input.delayMs,
      );

      return {
        workspaceId: input.workspaceId,
        batchId: batch.id,
        createdById: input.createdById,
        senderId: input.senderId,
        recipientEmail: recipient.email,
        recipientName: recipient.name,
        subject: input.subject,
        body: input.body,
        scheduledAt,
        status: "SCHEDULED" as const,
        idempotencyKey: `${batch.id}:${recipient.email.toLowerCase()}`,
      };
    });

    await tx.scheduledEmail.createMany({
      data: emails,
    });

    await tx.outboxEvent.create({
      data: {
        eventType: "EMAIL_BATCH_CREATED",
        aggregateId: batch.id,
        payload: {
          batchId: batch.id,
        },
      },
    });

    return batch;
  });
}
