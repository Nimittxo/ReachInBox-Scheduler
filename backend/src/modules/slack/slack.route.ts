import { Request, Response, Router } from "express";

import { requireAuth } from "../../middleware/auth.middleware.js";
import {
  consumeSlackState,
  createSlackAuthorizationUrl,
  exchangeSlackCode,
  listSlackChannels,
  saveSlackConnection,
} from "./slack.service.js";

export const slackRouter = Router();

slackRouter.get(
  "/connect",
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const auth = req.auth;

      if (!auth) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      const url = await createSlackAuthorizationUrl(
        auth.userId,
        auth.workspaceId,
      );

      res.redirect(url);
    } catch (error) {
      console.error("Slack connect failed:", error);
      res.status(500).json({ error: "Failed to connect Slack" });
    }
  },
);

slackRouter.get(
  "/callback",
  async (req: Request, res: Response) => {
    try {
      const code =
        typeof req.query.code === "string"
          ? req.query.code
          : null;

      const state =
        typeof req.query.state === "string"
          ? req.query.state
          : null;

      if (!code || !state) {
        res.status(400).send("Missing Slack OAuth parameters");
        return;
      }

      const session = await consumeSlackState(state);
      const oauth = await exchangeSlackCode(code);

      await saveSlackConnection(
        session.workspaceId,
        oauth,
      );

      res.redirect(
        `${process.env.FRONTEND_URL ?? "http://localhost:3000"}?slack=connected`,
      );
    } catch (error) {
      console.error("Slack callback failed:", error);

      res.redirect(
        `${process.env.FRONTEND_URL ?? "http://localhost:3000"}?slack=error`,
      );
    }
  },
);

slackRouter.get(
  "/channels",
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const auth = req.auth;

      if (!auth) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      const channels = await listSlackChannels(auth.workspaceId);

      res.json(channels);
    } catch (error) {
      console.error("Slack channels failed:", error);

      res.status(500).json({
        error: "Failed to load Slack channels",
      });
    }
  },
);