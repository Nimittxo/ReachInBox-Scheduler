import { elasticsearch } from "../../infrastructure/elasticsearch/client.js";
import { prisma } from "../../infrastructure/database/prisma.js";

export const EMAIL_INDEX = "reachbox-emails";

export async function ensureEmailIndex() {
  const exists = await elasticsearch.indices.exists({
    index: EMAIL_INDEX,
  });

  if (exists) {
    return;
  }

  await elasticsearch.indices.create({
    index: EMAIL_INDEX,
    mappings: {
      properties: {
        id: { type: "keyword" },
        workspaceId: { type: "keyword" },
        batchId: { type: "keyword" },
        senderId: { type: "keyword" },

        recipientEmail: {
          type: "keyword",
        },

        recipientName: {
          type: "text",
          fields: {
            keyword: {
              type: "keyword",
            },
          },
        },

        subject: {
          type: "text",
          fields: {
            keyword: {
              type: "keyword",
            },
          },
        },

        body: {
          type: "text",
        },

        status: {
          type: "keyword",
        },

        scheduledAt: {
          type: "date",
        },

        sentAt: {
          type: "date",
        },

        failedAt: {
          type: "date",
        },

        createdAt: {
          type: "date",
        },

        updatedAt: {
          type: "date",
        },
      },
    },
  });

  console.log(`Elasticsearch index created: ${EMAIL_INDEX}`);
}

export async function indexScheduledEmail(emailId: string) {
  const email = await prisma.scheduledEmail.findUnique({
    where: {
      id: emailId,
    },
  });

  if (!email) {
    return;
  }

  await ensureEmailIndex();

  await elasticsearch.index({
    index: EMAIL_INDEX,
    id: email.id,
    document: {
      id: email.id,
      workspaceId: email.workspaceId,
      batchId: email.batchId,
      senderId: email.senderId,
      recipientEmail: email.recipientEmail,
      recipientName: email.recipientName,
      subject: email.subject,
      body: email.body,
      status: email.status,
      scheduledAt: email.scheduledAt,
      sentAt: email.sentAt,
      failedAt: email.failedAt,
      createdAt: email.createdAt,
      updatedAt: email.updatedAt,
    },
    refresh: "wait_for",
  });
}

export async function indexScheduledEmails(emailIds: string[]) {
  if (!emailIds.length) {
    return;
  }

  await ensureEmailIndex();

  const emails = await prisma.scheduledEmail.findMany({
    where: {
      id: {
        in: emailIds,
      },
    },
  });

  if (!emails.length) {
    return;
  }

  const operations = emails.flatMap((email) => [
    {
      index: {
        _index: EMAIL_INDEX,
        _id: email.id,
      },
    },
    {
      id: email.id,
      workspaceId: email.workspaceId,
      batchId: email.batchId,
      senderId: email.senderId,
      recipientEmail: email.recipientEmail,
      recipientName: email.recipientName,
      subject: email.subject,
      body: email.body,
      status: email.status,
      scheduledAt: email.scheduledAt,
      sentAt: email.sentAt,
      failedAt: email.failedAt,
      createdAt: email.createdAt,
      updatedAt: email.updatedAt,
    },
  ]);

  await elasticsearch.bulk({
    operations,
    refresh: "wait_for",
  });
}

export async function reindexAllEmails() {
  await ensureEmailIndex();

  const emails = await prisma.scheduledEmail.findMany({
    orderBy: {
      createdAt: "asc",
    },
    take: 10000,
  });

  if (!emails.length) {
    console.log("Elasticsearch reindex: no emails found.");
    return;
  }

  const operations = emails.flatMap((email) => [
    {
      index: {
        _index: EMAIL_INDEX,
        _id: email.id,
      },
    },
    {
      id: email.id,
      workspaceId: email.workspaceId,
      batchId: email.batchId,
      senderId: email.senderId,
      recipientEmail: email.recipientEmail,
      recipientName: email.recipientName,
      subject: email.subject,
      body: email.body,
      status: email.status,
      scheduledAt: email.scheduledAt,
      sentAt: email.sentAt,
      failedAt: email.failedAt,
      createdAt: email.createdAt,
      updatedAt: email.updatedAt,
    },
  ]);

  const result = await elasticsearch.bulk({
    operations,
    refresh: "wait_for",
  });

  if (result.errors) {
    console.error("Elasticsearch reindex completed with errors.");
  } else {
    console.log(
      `Elasticsearch reindex completed: ${emails.length} emails.`,
    );
  }
}

export async function searchEmails(
  query: string,
  workspaceId?: string,
  limit = 50,
) {
  await ensureEmailIndex();

  const must = query.trim()
    ? [
        {
          multi_match: {
            query: query.trim(),
            fields: [
              "recipientEmail",
              "recipientName",
              "subject^3",
              "body",
              "status",
            ],
            fuzziness: "AUTO",
          },
        },
      ]
    : [
        {
          match_all: {},
        },
      ];

  const filters = workspaceId
    ? [
        {
          term: {
            workspaceId,
          },
        },
      ]
    : [];

  const response = await elasticsearch.search<{
    id: string;
    workspaceId: string;
    batchId: string;
    senderId: string;
    recipientEmail: string;
    recipientName: string | null;
    subject: string;
    body: string;
    status: string;
    scheduledAt: string;
    sentAt: string | null;
    failedAt: string | null;
    createdAt: string;
    updatedAt: string;
  }>({
    index: EMAIL_INDEX,
    size: Math.min(Math.max(limit, 1), 100),
    query: {
      bool: {
        must,
        filter: filters,
      },
    },
    sort: [
      {
        createdAt: {
          order: "desc",
        },
      },
    ],
  });

  return response.hits.hits.map((hit) => hit._source);
}
