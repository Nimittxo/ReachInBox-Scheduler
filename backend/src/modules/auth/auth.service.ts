import crypto from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";

import { env } from "../../config/env.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import { redis } from "../../infrastructure/redis/redis.js";

const GOOGLE_STATE_PREFIX = "oauth:google:state:";
const GOOGLE_STATE_TTL_SECONDS = 10 * 60;
const SESSION_COOKIE = "reachbox_session";
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

const googleClient = new OAuth2Client(
  env.GOOGLE_CLIENT_ID,
  env.GOOGLE_CLIENT_SECRET,
  env.GOOGLE_CALLBACK_URL,
);

export function createGoogleAuthorizationUrl() {
  const state = crypto.randomBytes(32).toString("hex");

  return {
    state,
    url: googleClient.generateAuthUrl({
      access_type: "online",
      scope: ["openid", "email", "profile"],
      include_granted_scopes: true,
      state,
      prompt: "select_account",
    }),
  };
}

export async function storeGoogleState(state: string) {
  await redis.set(
    `${GOOGLE_STATE_PREFIX}${state}`,
    "1",
    "EX",
    GOOGLE_STATE_TTL_SECONDS,
    "NX",
  );
}

export async function consumeGoogleState(state: string) {
  const key = `${GOOGLE_STATE_PREFIX}${state}`;
  const value = await redis.get(key);

  if (!value) {
    return false;
  }

  await redis.del(key);
  return true;
}

export async function authenticateGoogleCode(code: string) {
  const { tokens } = await googleClient.getToken(code);

  if (!tokens.id_token) {
    throw new Error("Google did not return an ID token");
  }

  const ticket = await googleClient.verifyIdToken({
    idToken: tokens.id_token,
    audience: env.GOOGLE_CLIENT_ID,
  });

  const payload = ticket.getPayload();

  if (!payload) {
    throw new Error("Google ID token payload is missing");
  }

  if (!payload.sub) {
    throw new Error("Google account ID is missing");
  }

  const email = payload.email;

  if (!email) {
    throw new Error("Google email is missing");
  }

  if (payload.email_verified !== true) {
    throw new Error("Google email is not verified");
  }

  const displayName =
    payload.name?.trim() || email;

  const user = await prisma.$transaction(async (tx) => {
    let existing = await tx.user.findUnique({
      where: {
        googleId: payload.sub,
      },
    });

    if (!existing) {
      existing = await tx.user.findUnique({
        where: {
          email,
        },
      });
    }

    if (existing) {
      return tx.user.update({
        where: {
          id: existing.id,
        },
        data: {
          googleId: payload.sub,
          email,
          name: payload.name?.trim() || existing.name,
          avatarUrl: payload.picture ?? existing.avatarUrl,
        },
      });
    }

    return tx.user.create({
      data: {
        googleId: payload.sub,
        email,
        name: displayName,
        avatarUrl: payload.picture ?? null,
      },
    });
  });

  let membership = await prisma.workspaceMember.findFirst({
    where: {
      userId: user.id,
    },
    orderBy: {
      createdAt: "asc",
    },
    include: {
      workspace: true,
    },
  });

  if (!membership) {
    const workspace = await prisma.workspace.create({
      data: {
        name: `${user.name}'s Workspace`,
        memberships: {
          create: {
            userId: user.id,
            role: "OWNER",
          },
        },
      },
    });

    membership = await prisma.workspaceMember.findUniqueOrThrow({
      where: {
        workspaceId_userId: {
          workspaceId: workspace.id,
          userId: user.id,
        },
      },
      include: {
        workspace: true,
      },
    });
  }

  return {
    user,
    workspace: membership.workspace,
  };
}

export function createSessionToken(userId: string, workspaceId: string) {
  return jwt.sign(
    {
      sub: userId,
      workspaceId,
    },
    env.AUTH_JWT_SECRET,
    {
      expiresIn: "7d",
      issuer: "reachbox-backend",
      audience: "reachbox-frontend",
    },
  );
}

export function verifySessionToken(token: string) {
  const payload = jwt.verify(token, env.AUTH_JWT_SECRET, {
    issuer: "reachbox-backend",
    audience: "reachbox-frontend",
  });

  if (
    typeof payload === "string" ||
    typeof payload.sub !== "string" ||
    typeof payload.workspaceId !== "string"
  ) {
    throw new Error("Invalid session payload");
  }

  return {
    userId: payload.sub,
    workspaceId: payload.workspaceId,
  };
}

export function setSessionCookie(res: {
  setHeader(name: string, value: string): void;
}, token: string) {
  const secure = env.NODE_ENV === "production" ? "; Secure" : "";

  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure}`,
  );
}

export function clearSessionCookie(res: {
  setHeader(name: string, value: string): void;
}) {
  const secure = env.NODE_ENV === "production" ? "; Secure" : "";

  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}`,
  );
}

export function getSessionCookie(req: {
  headers: {
    cookie?: string;
  };
}) {
  const cookieHeader = req.headers.cookie;

  if (!cookieHeader) {
    return null;
  }

  const cookies = cookieHeader.split(";");

  for (const cookie of cookies) {
    const separator = cookie.indexOf("=");

    if (separator === -1) {
      continue;
    }

    const name = cookie.slice(0, separator).trim();

    if (name !== SESSION_COOKIE) {
      continue;
    }

    return decodeURIComponent(cookie.slice(separator + 1).trim());
  }

  return null;
}

export async function getAuthenticatedUser(userId: string) {
  return prisma.user.findUnique({
    where: {
      id: userId,
    },
    select: {
      id: true,
      email: true,
      name: true,
      avatarUrl: true,
      memberships: {
        orderBy: {
          createdAt: "asc",
        },
        select: {
          workspaceId: true,
          role: true,
          workspace: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
  });
}
