(() => {
  "use strict";

  const API_BASE = "https://api.coingecko.com/api/v3";
  const STORAGE_KEY = "pulse.holdings.v1";
  const REFRESH_MS = 45000;

  const el = (id) => document.getElementById(id);

  const holdingsListEl = el("holdingsList");
  const emptyStateEl = el("emptyState");
  const totalValueEl = el("totalValue");
  const totalPLEl = el("totalPL");
  const lastUpdatedEl = el("lastUpdated");
  const statusDotEl = el("statusDot");
  const tickerTrackEl = el("tickerTrack");
  const toastEl = el("toast");

  const sheetOverlay = el("sheetOverlay");
  const searchInput = el("searchInput");
  const searchResultsEl = el("searchResults");
  const selectedBlock = el("selectedAssetBlock");
  const selectedNameEl = el("selectedName");
  const amountInput = el("amountInput");
  const buyPriceInput = el("buyPriceInput");

  let holdings = loadHoldings();
  let priceCache = {}; // id -> { price, change24h, symbol, name }
  let pendingSelection = null;
  let searchDebounce = null;

  // ---------- Storage ----------
  function loadHoldings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveHoldings() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(holdings));
  }

  // ---------- Toast ----------
  let toastTimer = null;
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2600);
  }

  // ---------- Formatting ----------
  function fmtUSD(n) {
    if (n === null || n === undefined || isNaN(n)) return "—";
    const abs = Math.abs(n);
    const digits = abs > 0 && abs < 1 ? 4 : 2;
    return "$" + n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  function fmtPct(n) {
    if (n === null || n === undefined || isNaN(n)) return "—";
    const sign = n > 0 ? "+" : "";
    return `${sign}${n.toFixed(2)}%`;
  }

  // ---------- Ticker tape ----------
  async function loadTicker() {
    try {
      const res = await fetch(`${API_BASE}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=12&page=1&price_change_percentage=24h`);
      if (!res.ok) throw new Error("ticker fetch failed");
      const data = await res.json();
      setOnline(true);
      const html = data.map(c => {
        const chg = c.price_change_percentage_24h;
        const cls = chg >= 0 ? "up" : "down";
        const arrow = chg >= 0 ? "▲" : "▼";
        return `<span class="ticker-item"><b>${c.symbol.toUpperCase()}</b>${fmtUSD(c.current_price)} <span class="${cls}">${arrow} ${fmtPct(chg)}</span></span>`;
      }).join("");
      // duplicate content for seamless loop
      tickerTrackEl.innerHTML = html + html;
    } catch (e) {
      setOnline(false);
    }
  }

  function setOnline(isOnline) {
    statusDotEl.classList.toggle("offline", !isOnline);
    statusDotEl.title = isOnline ? "Connecté" : "Hors ligne — dernières données affichées";
  }

  // ---------- Portfolio prices ----------
  async function refreshPrices() {
    if (holdings.length === 0) {
      render();
      return;
    }
    const ids = [...new Set(holdings.map(h => h.id))].join(",");
    try {
      const res = await fetch(`${API_BASE}/coins/markets?vs_currency=usd&ids=${encodeURIComponent(ids)}`);
      if (!res.ok) throw new Error("prices fetch failed");
      const data = await res.json();
      setOnline(true);
      data.forEach(c => {
        priceCache[c.id] = {
          price: c.current_price,
          change24h: c.price_change_percentage_24h,
          symbol: c.symbol,
          name: c.name,
          image: c.image
        };
      });
      lastUpdatedEl.textContent = "Mis à jour à " + new Date().toLocaleTimeString("fr-FR");
    } catch (e) {
      setOnline(false);
      lastUpdatedEl.textContent = "Hors ligne — dernières valeurs connues";
    }
    render();
  }

  // ---------- Render ----------
  function render() {
    emptyStateEl.hidden = holdings.length !== 0;
    holdingsListEl.innerHTML = "";

    let totalValue = 0;
    let totalCost = 0;

    holdings.forEach(h => {
      const info = priceCache[h.id];
      const price = info ? info.price : null;
      const value = price !== null ? price * h.amount : null;
      const cost = (h.buyPrice || 0) * h.amount;

      if (value !== null) totalValue += value;
      if (h.buyPrice) totalCost += cost;

      const change24h = info ? info.change24h : null;
      const changeCls = change24h >= 0 ? "up" : "down";

      const li = document.createElement("li");
      li.className = "holding-item";
      li.innerHTML = `
        <div class="holding-left">
          <span class="holding-symbol">${(info?.symbol || h.symbol || "").toUpperCase()}</span>
          <span class="holding-amount">${h.amount} · ${info?.name || h.name || ""}</span>
        </div>
        <div class="holding-right">
          <span class="holding-value">${value !== null ? fmtUSD(value) : "—"}</span>
          <span class="holding-change ${changeCls}">${change24h !== null && change24h !== undefined ? fmtPct(change24h) + " (24h)" : "—"}</span>
          <button class="holding-remove" data-id="${h.id}">retirer</button>
        </div>
      `;
      holdingsListEl.appendChild(li);
    });

    totalValueEl.textContent = fmtUSD(totalValue);

    if (totalCost > 0) {
      const plAmount = totalValue - totalCost;
      const plPct = (plAmount / totalCost) * 100;
      totalPLEl.className = "summary-pl " + (plAmount >= 0 ? "up" : "down");
      totalPLEl.innerHTML = `<span class="pl-amount">${plAmount >= 0 ? "+" : ""}${fmtUSD(plAmount)}</span> <span class="pl-percent">(${fmtPct(plPct)})</span>`;
    } else {
      totalPLEl.className = "summary-pl";
      totalPLEl.innerHTML = `<span class="pl-amount">—</span>`;
    }

    holdingsListEl.querySelectorAll(".holding-remove").forEach(btn => {
      btn.addEventListener("click", () => removeHolding(btn.dataset.id));
    });
  }

  function removeHolding(id) {
    holdings = holdings.filter(h => h.id !== id);
    saveHoldings();
    render();
    showToast("Actif retiré du portefeuille");
  }

  // ---------- Search / add sheet ----------
  function openSheet() {
    sheetOverlay.hidden = false;
    searchInput.value = "";
    searchResultsEl.innerHTML = "";
    selectedBlock.hidden = true;
    pendingSelection = null;
    amountInput.value = "";
    buyPriceInput.value = "";
    setTimeout(() => searchInput.focus(), 50);
  }

  function closeSheet() {
    sheetOverlay.hidden = true;
  }

  async function doSearch(query) {
    if (!query || query.length < 2) {
      searchResultsEl.innerHTML = "";
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/search?query=${encodeURIComponent(query)}`);
      const data = await res.json();
      const coins = (data.coins || []).slice(0, 8);
      searchResultsEl.innerHTML = coins.map(c => `
        <li data-id="${c.id}" data-symbol="${c.symbol}" data-name="${c.name}" data-thumb="${c.thumb}" tabindex="0">
          <img src="${c.thumb}" alt="" loading="lazy">
          <div>
            <div class="res-name">${c.name}</div>
            <div class="res-symbol">${c.symbol}</div>
          </div>
        </li>
      `).join("") || `<li style="color:var(--text-dim); border:none;">Aucun résultat</li>`;

      searchResultsEl.querySelectorAll("li[data-id]").forEach(li => {
        li.addEventListener("click", () => selectCoin(li.dataset));
      });
    } catch (e) {
      searchResultsEl.innerHTML = `<li style="color:var(--text-dim); border:none;">Recherche indisponible hors ligne</li>`;
    }
  }

  function selectCoin(data) {
    pendingSelection = data;
    selectedNameEl.textContent = `${data.name} (${data.symbol.toUpperCase()})`;
    selectedBlock.hidden = false;
    searchResultsEl.innerHTML = "";
    searchInput.value = "";
  }

  async function confirmAdd() {
    if (!pendingSelection) return;
    const amount = parseFloat(amountInput.value);
    if (!amount || amount <= 0) {
      showToast("Indique une quantité valide");
      return;
    }
    let buyPrice = parseFloat(buyPriceInput.value);

    if (!buyPrice) {
      // use current price as buy price if not provided
      try {
        const res = await fetch(`${API_BASE}/coins/markets?vs_currency=usd&ids=${pendingSelection.id}`);
        const data = await res.json();
        buyPrice = data[0]?.current_price || 0;
      } catch {
        buyPrice = 0;
      }
    }

    const existing = holdings.find(h => h.id === pendingSelection.id);
    if (existing) {
      existing.amount += amount;
    } else {
      holdings.push({
        id: pendingSelection.id,
        symbol: pendingSelection.symbol,
        name: pendingSelection.name,
        amount,
        buyPrice
      });
    }
    saveHoldings();
    closeSheet();
    showToast("Actif ajouté");
    refreshPrices();
  }

  // ---------- Events ----------
  el("addAssetBtn").addEventListener("click", openSheet);
  el("emptyAddBtn").addEventListener("click", openSheet);
  el("cancelAddBtn").addEventListener("click", closeSheet);
  el("changeSelectionBtn").addEventListener("click", () => {
    selectedBlock.hidden = true;
    pendingSelection = null;
  });
  el("confirmAddBtn").addEventListener("click", confirmAdd);
  sheetOverlay.addEventListener("click", (e) => {
    if (e.target === sheetOverlay) closeSheet();
  });
  searchInput.addEventListener("input", (e) => {
    clearTimeout(searchDebounce);
    const q = e.target.value.trim();
    searchDebounce = setTimeout(() => doSearch(q), 350);
  });

  // ---------- Install prompt ----------
  let deferredPrompt = null;
  const installBtn = el("installBtn");
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    installBtn.hidden = false;
  });
  installBtn.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    installBtn.hidden = true;
  });
  window.addEventListener("appinstalled", () => { installBtn.hidden = true; });

  // ---------- Service worker ----------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("service-worker.js").catch(() => {});
    });
  }

  // ---------- Init ----------
  render();
  loadTicker();
  refreshPrices();
  setInterval(loadTicker, REFRESH_MS);
  setInterval(refreshPrices, REFRESH_MS);
  window.addEventListener("online", () => { loadTicker(); refreshPrices(); });
  window.addEventListener("offline", () => setOnline(false));
})();
