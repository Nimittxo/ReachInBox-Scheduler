import { Request, Response, NextFunction } from "express";

import {
  getSessionCookie,
  verifySessionToken,
} from "../modules/auth/auth.service.js";

export type AuthContext = {
  userId: string;
  workspaceId: string;
};

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const token = getSessionCookie(req);

  if (!token) {
    res.status(401).json({
      error: "Authentication required",
    });
    return;
  }

  try {
    req.auth = verifySessionToken(token);
    next();
  } catch {
    res.status(401).json({
      error: "Invalid or expired session",
    });
  }
}
