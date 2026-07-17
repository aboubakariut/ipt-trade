// GET /api/symbol-search?query=apple
// Proxies Twelve Data's symbol_search so the API key never reaches the browser.

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const { query } = req.query;
  if (!query || query.length < 2) {
    return res.status(200).json({ results: [] });
  }

  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "TWELVE_DATA_API_KEY absente des variables d'environnement" });
  }

  try {
    const url = `https://api.twelvedata.com/symbol_search?symbol=${encodeURIComponent(query)}&apikey=${apiKey}`;
    const upstream = await fetch(url);
    const data = await upstream.json();

    const results = (data.data || [])
      .filter(d => d.instrument_type === "Common Stock" || d.instrument_type === "ETF")
      .slice(0, 8)
      .map(d => ({
        symbol: d.symbol,
        name: d.instrument_name,
        exchange: d.exchange,
        currency: d.currency
      }));

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json({ results });
  } catch (e) {
    return res.status(502).json({ error: "Impossible de contacter Twelve Data" });
  }
}
