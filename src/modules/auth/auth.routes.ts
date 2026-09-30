import { Request, Response, Router } from "express";

import {
  authenticateGoogleCode,
  clearSessionCookie,
  consumeGoogleState,
  createGoogleAuthorizationUrl,
  createSessionToken,
  getAuthenticatedUser,
  setSessionCookie,
  storeGoogleState,
} from "./auth.service.js";
import { requireAuth } from "../../middleware/auth.middleware.js";
import { env } from "../../config/env.js";

export const authRouter = Router();

authRouter.get("/google", async (_req: Request, res: Response) => {
  try {
    const { state, url } = createGoogleAuthorizationUrl();

    await storeGoogleState(state);

    res.redirect(url);
  } catch (error) {
    console.error("Failed to start Google OAuth:", error);

    res.status(500).json({
      error: "Failed to start Google authentication",
    });
  }
});

authRouter.get(
  "/google/callback",
  async (req: Request, res: Response) => {
    const error = typeof req.query.error === "string"
      ? req.query.error
      : null;

    if (error) {
      console.error("Google OAuth returned an error:", error);
      res.redirect(
        `${env.FRONTEND_URL}/?authError=google_denied`,
      );
      return;
    }

    const code =
      typeof req.query.code === "string"
        ? req.query.code
        : null;

    const state =
      typeof req.query.state === "string"
        ? req.query.state
        : null;

    if (!code || !state) {
      res.status(400).json({
        error: "Missing OAuth callback parameters",
      });
      return;
    }

    try {
      const validState = await consumeGoogleState(state);

      if (!validState) {
        res.status(400).json({
          error: "Invalid or expired OAuth state",
        });
        return;
      }

      const { user, workspace } =
        await authenticateGoogleCode(code);

      const token = createSessionToken(
        user.id,
        workspace.id,
      );

      setSessionCookie(res, token);

      res.redirect(env.FRONTEND_URL);
    } catch (error) {
      console.error("Google OAuth callback failed:", error);

      res.redirect(
        `${env.FRONTEND_URL}/?authError=google_failed`,
      );
    }
  },
);

authRouter.get("/me", requireAuth, async (req, res) => {
  try {
    const auth = req.auth;

    if (!auth) {
      res.status(401).json({
        error: "Authentication required",
      });
      return;
    }

    const user = await getAuthenticatedUser(auth.userId);

    if (!user) {
      res.status(401).json({
        error: "User no longer exists",
      });
      return;
    }

    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      activeWorkspaceId: auth.workspaceId,
      workspaces: user.memberships.map((membership) => ({
        id: membership.workspace.id,
        name: membership.workspace.name,
        role: membership.role,
      })),
    });
  } catch (error) {
    console.error("Failed to load authenticated user:", error);

    res.status(500).json({
      error: "Failed to load authenticated user",
    });
  }
});

authRouter.post("/logout", (_req, res) => {
  clearSessionCookie(res);

  res.json({
    status: "logged-out",
  });
});
