import { Request, Response, Router } from "express";
import { ZodError } from "zod";

import { createBatch } from "./batch.service.js";
import { createBatchSchema } from "./batch.schema.js";
import { dispatchPendingOutboxEvents } from "./outbox.dispatcher.js";

export const batchRouter = Router();

batchRouter.post("/", async (req: Request, res: Response) => {
  try {
    const input = createBatchSchema.parse(req.body);

    const batch = await createBatch(input);

    try {
      await dispatchPendingOutboxEvents();
    } catch (error) {
      console.error(
        `Batch ${batch.id} was created but queue dispatch failed:`,
        error,
      );
    }

    res.status(201).json({
      id: batch.id,
      status: batch.status,
      createdAt: batch.createdAt,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      res.status(400).json({
        error: "Invalid request",
        details: error.issues,
      });
      return;
    }

    console.error("Failed to create batch:", error);

    res.status(500).json({
      error: "Failed to create batch",
    });
  }
});
