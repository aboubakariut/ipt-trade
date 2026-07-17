// GET or POST /api/send-alerts
// Triggered on a schedule (Vercel Cron and/or an external scheduler like cron-job.org).
// Walks every stored subscription, checks each of its price alerts against current
// market prices, and pushes a notification for any alert that just crossed its
// threshold. Expired push subscriptions are cleaned up automatically.

import webpush from "web-push";
import { redisGet, redisSet, redisDel, redisSmembers, redisSrem } from "./_upstash.js";

function checkAuth(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // no secret configured — allow (not recommended, see DEPLOY.md)
  const header = req.headers["authorization"];
  const queryToken = req.query?.secret;
  return header === `Bearer ${secret}` || queryToken === secret;
}

async function fetchCryptoPrices(ids) {
  if (ids.length === 0) return {};
  const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids.join(",")}`;
  const r = await fetch(url);
  const data = await r.json();
  const out = {};
  for (const c of data) out[c.id] = c.current_price;
  return out;
}

async function fetchTwelveDataPrices(symbols) {
  if (symbols.length === 0) return {};
  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) return {};
  const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbols.join(","))}&apikey=${apiKey}`;
  const r = await fetch(url);
  const data = await r.json();
  const isSingle = data.symbol !== undefined;
  const normalized = isSingle ? { [data.symbol]: data } : data;
  const out = {};
  for (const [sym, q] of Object.entries(normalized)) {
    if (!q || q.code) continue;
    out[sym] = parseFloat(q.close);
  }
  return out;
}

function conditionMet(price, condition, threshold) {
  if (price === undefined || price === null || isNaN(price)) return false;
  return condition === "above" ? price >= threshold : price <= threshold;
}

export default async function handler(req, res) {
  if (!checkAuth(req)) {
    return res.status(401).json({ error: "Non autorisé" });
  }

  const vapidPublic = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  const vapidContact = process.env.VAPID_CONTACT || "mailto:contact@example.com";

  if (!vapidPublic || !vapidPrivate) {
    return res.status(500).json({ error: "Clés VAPID absentes des variables d'environnement" });
  }
  webpush.setVapidDetails(vapidContact, vapidPublic, vapidPrivate);

  let subKeys = [];
  let allEntries = [];
  try {
    subKeys = await redisSmembers("sub:index");
    allEntries = await Promise.all(subKeys.map(k => redisGet(k)));
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  // Collect every symbol/id we need to price, grouped by market.
  const cryptoIds = new Set();
  const tdSymbols = new Set(); // stocks + forex both go through Twelve Data

  allEntries.forEach(entry => {
    if (!entry) return;
    (entry.alerts || []).forEach(a => {
      if (a.triggered) return;
      if (a.market === "crypto") cryptoIds.add(a.assetId);
      else tdSymbols.add(a.assetId);
    });
  });

  const [cryptoPrices, tdPrices] = await Promise.all([
    fetchCryptoPrices([...cryptoIds]),
    fetchTwelveDataPrices([...tdSymbols])
  ]);

  const priceFor = (a) => a.market === "crypto" ? cryptoPrices[a.assetId] : tdPrices[a.assetId];

  let sent = 0;
  let cleaned = 0;

  for (let i = 0; i < subKeys.length; i++) {
    const key = subKeys[i];
    const entry = allEntries[i];
    if (!entry) continue;

    const { subscription, alerts = [] } = entry;
    let changed = false;
    let subscriptionDead = false;

    for (const alert of alerts) {
      if (alert.triggered) continue;
      const price = priceFor(alert);
      if (conditionMet(price, alert.condition, alert.threshold)) {
        const dir = alert.condition === "above" ? "dépassé" : "descendu sous";
        const payload = JSON.stringify({
          title: `${alert.symbol.toUpperCase()} a ${dir} ${alert.threshold}`,
          body: `Prix actuel : $${price}`,
          tag: alert.id
        });
        try {
          await webpush.sendNotification(subscription, payload);
          sent++;
          alert.triggered = true;
          changed = true;
        } catch (err) {
          if (err.statusCode === 404 || err.statusCode === 410) {
            subscriptionDead = true;
          }
        }
      }
    }

    if (subscriptionDead) {
      await redisDel(key);
      await redisSrem("sub:index", key);
      cleaned++;
    } else if (changed) {
      await redisSet(key, { subscription, alerts });
    }
  }

  return res.status(200).json({ checked: subKeys.length, notificationsSent: sent, subscriptionsCleaned: cleaned });
}
