import { Request, Response, Router } from "express";
import { z } from "zod";

import {
  searchEmails,
} from "../../infrastructure/elasticsearch/email.index.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import { requireAuth } from "../../middleware/auth.middleware.js";

const searchSchema = z.object({
  q: z.string().trim().max(200).default(""),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const emailRouter = Router();

emailRouter.get(
  "/",
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const workspaceId = req.auth.workspaceId;

      const emails = await prisma.scheduledEmail.findMany({
        where: {
          workspaceId,
        },
        orderBy: {
          createdAt: "desc",
        },
        take: 1000,
        select: {
          id: true,
          workspaceId: true,
          recipientEmail: true,
          recipientName: true,
          subject: true,
          scheduledAt: true,
          status: true,
          sentAt: true,
          failedAt: true,
          createdAt: true,
        },
      });

      res.json(emails);
    } catch (error) {
      console.error("Failed to load emails:", error);

      res.status(500).json({
        error: "Failed to load emails",
      });
    }
  },
);

emailRouter.get(
  "/search",
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const input = searchSchema.parse(req.query);
      const workspaceId = req.auth.workspaceId;

      const emails = await searchEmails(
        input.q,
        workspaceId,
        input.limit,
      );

      res.json(emails);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: "Invalid search parameters",
          details: error.issues,
        });
        return;
      }

      console.error("Email search failed:", error);

      res.status(500).json({
        error: "Email search failed",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  },
);
