import crypto from "node:crypto";
import { WebClient } from "@slack/web-api";

import { env } from "../../config/env.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import { redis } from "../../infrastructure/redis/redis.js";

const STATE_PREFIX = "oauth:slack:state:";
const STATE_TTL_SECONDS = 600;

type SlackOAuthResponse = {
  ok: boolean;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  bot_user_id?: string;
  team?: {
    id?: string;
    name?: string;
  };
  error?: string;
};

export async function createSlackAuthorizationUrl(
  userId: string,
  workspaceId: string,
) {
  const state = crypto.randomBytes(32).toString("hex");

  await redis.set(
    `${STATE_PREFIX}${state}`,
    JSON.stringify({ userId, workspaceId }),
    "EX",
    STATE_TTL_SECONDS,
  );

  const params = new URLSearchParams({
    client_id: env.SLACK_CLIENT_ID,
    redirect_uri: env.SLACK_REDIRECT_URI,
    scope: "chat:write,channels:read",
    state,
  });

  return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
}

export async function consumeSlackState(state: string) {
  const key = `${STATE_PREFIX}${state}`;
  const value = await redis.get(key);

  if (!value) {
    throw new Error("Invalid or expired Slack OAuth state");
  }

  await redis.del(key);

  return JSON.parse(value) as {
    userId: string;
    workspaceId: string;
  };
}

export async function exchangeSlackCode(code: string) {
  const response = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: env.SLACK_CLIENT_ID,
      client_secret: env.SLACK_CLIENT_SECRET,
      code,
      redirect_uri: env.SLACK_REDIRECT_URI,
    }),
  });

  const data = (await response.json()) as SlackOAuthResponse;

  if (!data.ok || !data.access_token || !data.refresh_token) {
    throw new Error(data.error ?? "Slack OAuth failed");
  }

  return data;
}

export async function saveSlackConnection(
  workspaceId: string,
  oauth: SlackOAuthResponse,
) {
  if (
    !oauth.access_token ||
    !oauth.refresh_token ||
    !oauth.expires_in ||
    !oauth.team?.id
  ) {
    throw new Error("Incomplete Slack OAuth response");
  }

  const accessTokenExpiresAt = new Date(
    Date.now() + oauth.expires_in * 1000,
  );

  return prisma.slackConnection.upsert({
    where: { workspaceId },
    create: {
      workspaceId,
      slackTeamId: oauth.team.id,
      slackTeamName: oauth.team.name,
      botUserId: oauth.bot_user_id,
      accessToken: oauth.access_token,
      refreshToken: oauth.refresh_token,
      accessTokenExpiresAt,
    },
    update: {
      slackTeamId: oauth.team.id,
      slackTeamName: oauth.team.name,
      botUserId: oauth.bot_user_id,
      accessToken: oauth.access_token,
      refreshToken: oauth.refresh_token,
      accessTokenExpiresAt,
    },
  });
}

export async function getSlackClient(workspaceId: string) {
  const connection = await prisma.slackConnection.findUnique({
    where: { workspaceId },
  });

  if (!connection) {
    throw new Error("Slack is not connected");
  }

  return {
    client: new WebClient(connection.accessToken),
    connection,
  };
}

export async function sendSlackMessage(
  workspaceId: string,
  channelId: string,
  text: string,
) {
  const { client } = await getSlackClient(workspaceId);

  return client.chat.postMessage({
    channel: channelId,
    text,
  });
}

export async function listSlackChannels(workspaceId: string) {
  const { client } = await getSlackClient(workspaceId);

  const result = await client.conversations.list({
    types: "public_channel",
    exclude_archived: true,
    limit: 100,
  });

  return (
    result.channels?.map((channel) => ({
      id: channel.id,
      name: channel.name,
    })) ?? []
  );
}
