import nodemailer from "nodemailer";

import { prisma } from "../../infrastructure/database/prisma.js";
import { smtpTransporter } from "../../infrastructure/smtp/transporter.js";
import {
  indexScheduledEmail,
} from "../../infrastructure/elasticsearch/email.index.js";

async function syncSearchIndex(emailId: string) {
  try {
    await indexScheduledEmail(emailId);
  } catch (error) {
    console.error(
      `Elasticsearch sync failed for email ${emailId}. PostgreSQL remains authoritative:`,
      error,
    );
  }
}

export async function sendScheduledEmail(emailId: string) {
  const email = await prisma.scheduledEmail.findUnique({
    where: { id: emailId },
    include: { sender: true },
  });

  if (!email) {
    throw new Error(`Scheduled email ${emailId} was not found`);
  }

  if (email.status === "SENT") {
    return {
      status: "already-sent" as const,
      emailId: email.id,
    };
  }

  if (email.status === "CANCELLED") {
    return {
      status: "cancelled" as const,
      emailId: email.id,
    };
  }

  const claimed = await prisma.scheduledEmail.updateMany({
    where: {
      id: email.id,
      status: {
        in: ["SCHEDULED", "QUEUED", "FAILED"],
      },
    },
    data: {
      status: "PROCESSING",
      attempts: {
        increment: 1,
      },
      lastError: null,
    },
  });

  if (claimed.count === 0) {
    const current = await prisma.scheduledEmail.findUnique({
      where: {
        id: email.id,
      },
    });

    if (
      current?.status === "SENT" ||
      current?.status === "PROCESSING"
    ) {
      return {
        status: "already-processing" as const,
        emailId: email.id,
      };
    }

    throw new Error(
      `Email ${email.id} could not be claimed for processing`,
    );
  }

  await syncSearchIndex(email.id);

  try {
    const result = await smtpTransporter.sendMail({
      from: {
        name: email.sender.displayName ?? "ReachBox",
        address: email.sender.email,
      },
      to: {
        name: email.recipientName ?? undefined,
        address: email.recipientEmail,
      },
      subject: email.subject,
      text: email.body,
    });

    const previewUrl =
      nodemailer.getTestMessageUrl(result) ?? null;

    await prisma.scheduledEmail.update({
      where: {
        id: email.id,
      },
      data: {
        status: "SENT",
        sentAt: new Date(),
        lastError: null,
      },
    });

    await syncSearchIndex(email.id);

    return {
      status: "sent" as const,
      emailId: email.id,
      messageId: result.messageId,
      previewUrl,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);

    await prisma.scheduledEmail.update({
      where: {
        id: email.id,
      },
      data: {
        status: "FAILED",
        failedAt: new Date(),
        lastError: message,
      },
    });

    await syncSearchIndex(email.id);

    throw error;
  }
}
