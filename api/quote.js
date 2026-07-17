// GET /api/quote?symbols=AAPL,MSFT&type=stock
// GET /api/quote?symbols=EUR/USD&type=forex
// Hides the Twelve Data API key server-side. Twelve Data's /quote endpoint
// works the same way for equities and FX pairs (symbol format differs: "AAPL" vs "EUR/USD").

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const { symbols } = req.query;
  if (!symbols) {
    return res.status(400).json({ error: "Paramètre 'symbols' requis" });
  }

  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "TWELVE_DATA_API_KEY absente des variables d'environnement" });
  }

  try {
    const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbols)}&apikey=${apiKey}`;
    const upstream = await fetch(url);
    const data = await upstream.json();

    if (data.status === "error") {
      return res.status(502).json({ error: data.message || "Erreur Twelve Data" });
    }

    // Normalize to always return an object keyed by symbol, whether Twelve Data
    // gave us a flat single-quote object or a multi-symbol map.
    const isSingle = data.symbol !== undefined;
    const normalized = isSingle ? { [data.symbol]: data } : data;

    const out = {};
    for (const [sym, q] of Object.entries(normalized)) {
      if (!q || q.code) continue; // skip per-symbol errors
      out[sym] = {
        symbol: q.symbol,
        name: q.name,
        price: parseFloat(q.close),
        changePercent24h: parseFloat(q.percent_change)
      };
    }

    res.setHeader("Cache-Control", "s-maxage=20, stale-while-revalidate=60");
    return res.status(200).json(out);
  } catch (e) {
    return res.status(502).json({ error: "Impossible de contacter Twelve Data" });
  }
}
