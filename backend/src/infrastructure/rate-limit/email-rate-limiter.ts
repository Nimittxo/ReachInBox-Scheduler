import { redis } from "../redis/redis.js";

type RateLimitDecision =
  | {
      allowed: true;
      nextAllowedAt: number;
    }
  | {
      allowed: false;
      retryAt: number;
      reason: "hourly-limit" | "minimum-delay";
    };

const RATE_LIMIT_SCRIPT = `
local now = tonumber(ARGV[1])
local hourlyLimit = tonumber(ARGV[2])
local minDelayMs = tonumber(ARGV[3])
local jobId = ARGV[4]

local hourKey = KEYS[1]
local lastSendKey = KEYS[2]

local windowStart = now - 3600000

redis.call("ZREMRANGEBYSCORE", hourKey, "-inf", windowStart)

local currentCount = redis.call("ZCARD", hourKey)

if currentCount >= hourlyLimit then
  local oldest = redis.call("ZRANGE", hourKey, 0, 0, "WITHSCORES")

  if #oldest >= 2 then
    local retryAt = tonumber(oldest[2]) + 3600000
    return {0, retryAt, 1}
  end

  return {0, now + 60000, 1}
end

local lastSend = redis.call("GET", lastSendKey)

if lastSend then
  local nextAllowedAt = tonumber(lastSend) + minDelayMs

  if nextAllowedAt > now then
    return {0, nextAllowedAt, 2}
  end
end

redis.call("ZADD", hourKey, now, jobId)
redis.call("EXPIRE", hourKey, 3700)

if minDelayMs > 0 then
  redis.call("SET", lastSendKey, tostring(now), "PX", math.max(minDelayMs + 60000, 120000))
else
  redis.call("SET", lastSendKey, tostring(now), "PX", 120000)
end

return {1, now, 0}
`;

export async function reserveSendSlot(params: {
  workspaceId: string;
  senderId: string;
  jobId: string;
  hourlyLimit: number;
  minDelayMs: number;
}): Promise<RateLimitDecision> {
  const hourKey =
    `reachbox:rate:${params.workspaceId}:${params.senderId}:hour`;

  const lastSendKey =
    `reachbox:rate:${params.workspaceId}:${params.senderId}:last-send`;

  const result = (await redis.eval(
    RATE_LIMIT_SCRIPT,
    2,
    hourKey,
    lastSendKey,
    Date.now(),
    params.hourlyLimit,
    params.minDelayMs,
    params.jobId,
  )) as [number, number, number];

  const [allowed, timestamp, reasonCode] = result;

  if (allowed === 1) {
    return {
      allowed: true,
      nextAllowedAt: timestamp,
    };
  }

  return {
    allowed: false,
    retryAt: timestamp,
    reason: reasonCode === 1 ? "hourly-limit" : "minimum-delay",
  };
}
