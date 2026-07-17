// POST /api/subscribe
// body: { subscription: PushSubscriptionJSON, alerts: [{id, market, assetId, symbol, name, condition, threshold, triggered}] }
//
// Stores the full alert list under a key derived from the push subscription's
// endpoint, and keeps an index set so /api/send-alerts can enumerate everyone.
// Re-posting simply overwrites the previous list for that subscription (upsert).

import crypto from "crypto";
import { redisSet, redisSadd, redisDel, redisSrem } from "./_upstash.js";

function keyFor(endpoint) {
  const hash = crypto.createHash("sha256").update(endpoint).digest("hex").slice(0, 32);
  return `sub:${hash}`;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method === "DELETE") {
    const { subscription } = req.body || {};
    if (!subscription?.endpoint) return res.status(400).json({ error: "subscription requise" });
    const key = keyFor(subscription.endpoint);
    try {
      await redisDel(key);
      await redisSrem("sub:index", key);
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Méthode non supportée" });
  }

  const { subscription, alerts } = req.body || {};
  if (!subscription?.endpoint) {
    return res.status(400).json({ error: "subscription (avec endpoint) requise" });
  }

  const key = keyFor(subscription.endpoint);

  try {
    await redisSet(key, { subscription, alerts: alerts || [] });
    await redisSadd("sub:index", key);
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
