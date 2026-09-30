import { emailQueue } from "../../queues/email.queue.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import {
  indexScheduledEmails,
} from "../../infrastructure/elasticsearch/email.index.js";

export async function dispatchOutboxEvent(outboxEventId: string) {
  const event = await prisma.outboxEvent.findUnique({
    where: {
      id: outboxEventId,
    },
  });

  if (!event || event.processedAt) {
    return;
  }

  if (event.eventType !== "EMAIL_BATCH_CREATED") {
    throw new Error(`Unsupported outbox event type: ${event.eventType}`);
  }

  const payload = event.payload;

  if (
    typeof payload !== "object" ||
    payload === null ||
    !("batchId" in payload) ||
    typeof payload.batchId !== "string"
  ) {
    throw new Error(`Invalid payload for outbox event ${event.id}`);
  }

  const emails = await prisma.scheduledEmail.findMany({
    where: {
      batchId: payload.batchId,
      status: "SCHEDULED",
    },
    orderBy: {
      scheduledAt: "asc",
    },
  });

  try {
    for (const email of emails) {
      const delay = Math.max(
        0,
        email.scheduledAt.getTime() - Date.now(),
      );

      await emailQueue.add(
        "send-email",
        {
          emailId: email.id,
        },
        {
          jobId: email.id,
          delay,
        },
      );

      await prisma.scheduledEmail.update({
        where: {
          id: email.id,
        },
        data: {
          status: "QUEUED",
          queueJobId: email.id,
        },
      });
    }

    if (emails.length) {
      try {
        await indexScheduledEmails(emails.map((email) => email.id));
      } catch (searchError) {
        console.error(
          "Elasticsearch indexing failed during queue dispatch. Email delivery will continue:",
          searchError,
        );
      }
    }

    await prisma.outboxEvent.update({
      where: {
        id: event.id,
      },
      data: {
        processedAt: new Date(),
        lastError: null,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);

    await prisma.outboxEvent.update({
      where: {
        id: event.id,
      },
      data: {
        attempts: {
          increment: 1,
        },
        lastError: message,
      },
    });

    throw error;
  }
}

export async function dispatchPendingOutboxEvents() {
  const events = await prisma.outboxEvent.findMany({
    where: {
      processedAt: null,
    },
    orderBy: {
      createdAt: "asc",
    },
    take: 100,
  });

  for (const event of events) {
    try {
      await dispatchOutboxEvent(event.id);
      console.log(`OUTBOX EVENT PROCESSED: ${event.id}`);
    } catch (error) {
      console.error(
        `OUTBOX EVENT FAILED: ${event.id}`,
        error,
      );
    }
  }
}
