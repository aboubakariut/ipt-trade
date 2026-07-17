// Minimal Upstash Redis REST client — no SDK dependency, just fetch.
// Requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN env vars.

const BASE = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

function assertConfigured() {
  if (!BASE || !TOKEN) {
    throw new Error("UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN absentes des variables d'environnement");
  }
}

async function command(parts) {
  assertConfigured();
  const url = `${BASE}/${parts.map(encodeURIComponent).join("/")}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${TOKEN}` }
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.result;
}

export async function redisSet(key, value) {
  return command(["set", key, JSON.stringify(value)]);
}

export async function redisGet(key) {
  const result = await command(["get", key]);
  return result ? JSON.parse(result) : null;
}

export async function redisDel(key) {
  return command(["del", key]);
}

export async function redisSadd(setKey, member) {
  return command(["sadd", setKey, member]);
}

export async function redisSrem(setKey, member) {
  return command(["srem", setKey, member]);
}

export async function redisSmembers(setKey) {
  const result = await command(["smembers", setKey]);
  return result || [];
}
