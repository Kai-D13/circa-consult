(function () {
  "use strict";
  const TABLE_SELECTOR = "#table-order-items-offline";
  const PANEL_ID = "circa-consult-panel";
  const PRODUCT_NAME_SELECTORS = ["td:nth-child(2) p.font-semibold", "td:nth-child(2) [class*='font-semibold']"];
  const FALLBACK_SCAN_MS = 3_000;
  const MESSAGE_TIMEOUT_MS = 25_000;
  const MAX_UI_RETRIES = 2;
  const DEV_POS_ORIGIN = "https://pos.dev.circa-v2.buymed.tech";
  let dataset = null;
  let tableObserver = null;
  let observedTable = null;
  let scanTimer = null;
  let layoutTimer = null;
  let retryTimer = null;
  let cartRevision = 0;
  let requestSequence = 0;
  let lastScanKey = "";
  let dismissedProductSignature = "";
  let minimized = false;
  let retryState = { signature: "", attempts: 0 };
  let scanInFlight = false;
  let queuedScan = false;

  function sendMessage(message, timeoutMs = MESSAGE_TIMEOUT_MS) {
    return new Promise(resolve => {
      let settled = false;
      const finish = response => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(response);
      };
      const timer = setTimeout(() => finish({ ok: false, code: "MESSAGE_TIMEOUT", error: "Extension không nhận được phản hồi kiểm tra tồn kho đúng hạn." }), timeoutMs);
      try {
        chrome.runtime.sendMessage(message, response => {
          if (chrome.runtime.lastError) finish({ ok: false, code: "MESSAGE_ERROR", error: chrome.runtime.lastError.message });
          else finish(response || { ok: false, code: "EMPTY_RESPONSE", error: "Extension không trả response." });
        });
      } catch (error) {
        finish({ ok: false, code: "MESSAGE_ERROR", error: error.message });
      }
    });
  }
  function readJsonStorage(key) {
    try { return JSON.parse(localStorage.getItem(key) || "null"); } catch (_) { return null; }
  }
  function readSessionToken() {
    const raw = document.cookie.split("; ").find(item => item.startsWith("session_token="));
    if (!raw) return null;
    const value = raw.split("=").slice(1).join("=");
    try { return decodeURIComponent(value); } catch (_) { return value; }
  }
  function parseProductLabel(text) { return CIRCA_CORE.parseProductLabel(text); }
  function productFromRow(row) {
    for (const selector of PRODUCT_NAME_SELECTORS) {
      const product = parseProductLabel(row.querySelector(selector)?.textContent);
      if (product) return product;
    }
    for (const line of String(row.innerText || "").split(/\r?\n/)) {
      const product = parseProductLabel(line);
      if (product) return product;
    }
    return null;
  }
  function extractCartProducts(table) {
    const products = [];
    table?.querySelectorAll("tbody tr").forEach((row, index) => {
      const product = productFromRow(row);
      if (!product) return;
      const displayedPosition = Number.parseInt(row.querySelector("td:first-child")?.textContent?.trim() || "", 10);
      products.push({
        ...product,
        cartPosition: Number.isInteger(displayedPosition) && displayedPosition > 0 ? displayedPosition : index + 1,
      });
    });
    return products;
  }
  function rulesForCart(products) {
    const cartIds = new Set(products.map(item => item.productId));
    const sourceProducts = new Map(products.map(item => [item.productId, item]));
    const seenSuggested = new Set();
    return (dataset?.rules || [])
      .filter(rule => cartIds.has(Number(rule.source_product_id)))
      .filter(rule => !cartIds.has(Number(rule.suggested_product_id)))
      .map(rule => {
        const source = sourceProducts.get(Number(rule.source_product_id));
        return {
          ...rule,
          __cartSourceName: source?.productName || rule.source_product_name,
          __cartPosition: source?.cartPosition || Number.MAX_SAFE_INTEGER,
        };
      })
      .sort((a, b) => a.__cartPosition - b.__cartPosition || Number(a.priority || 100) - Number(b.priority || 100))
      .filter(rule => {
        const id = Number(rule.suggested_product_id);
        if (seenSuggested.has(id)) return false;
        seenSuggested.add(id);
        return true;
      });
  }
  function escapeHtml(value) {
    const node = document.createElement("div");
    node.textContent = value == null ? "" : value;
    return node.innerHTML;
  }
  function formatPrice(value) { return Number(value).toLocaleString("vi-VN") + " đ"; }
  function productSignature(products) {
    return products.map(item => item.productId).sort((a, b) => a - b).join(",");
  }
  function findCartPlacement() {
    const table = document.querySelector(TABLE_SELECTOR);
    if (!table) return null;
    const host = table.closest("form") || table.parentElement;
    return host ? { host, table } : null;
  }
  function placePanel(panel) {
    const placement = findCartPlacement();
    if (placement) {
      document.querySelectorAll(".ccp-cart-host").forEach(host => {
        if (host !== placement.host) host.classList.remove("ccp-cart-host");
      });
      placement.host.classList.add("ccp-cart-host");
      panel.classList.remove("ccp-floating");
      if (panel.parentElement !== placement.host) placement.host.appendChild(panel);
      return;
    }
    panel.classList.add("ccp-floating");
    if (panel.parentElement !== document.body) document.body.appendChild(panel);
  }
  function getPanel() {
    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
      panel = document.createElement("aside");
      panel.id = PANEL_ID;
    }
    placePanel(panel);
    return panel;
  }
  function removePanel() {
    document.getElementById(PANEL_ID)?.remove();
    document.querySelectorAll(".ccp-cart-host").forEach(host => host.classList.remove("ccp-cart-host"));
  }
  function bindPanel(panel, signature) {
    panel.querySelector(".ccp-close")?.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      dismissedProductSignature = signature;
      removePanel();
    });
    panel.querySelector(".ccp-minimize")?.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      minimized = !minimized;
      panel.classList.toggle("ccp-minimized", minimized);
      panel.querySelector(".ccp-minimize").textContent = minimized ? "+" : "−";
    });
  }
  function renderShell(signature, body, stateClass = "") {
    const panel = getPanel();
    panel.className = `${minimized ? "ccp-minimized " : ""}${stateClass}`.trim();
    panel.innerHTML = `<div class="ccp-header"><span>💊 Gợi ý tư vấn bán kèm</span><div><button type="button" class="ccp-minimize" title="Thu gọn">${minimized ? "+" : "−"}</button><button type="button" class="ccp-close" title="Đóng">×</button></div></div><div class="ccp-body">${body}</div>`;
    bindPanel(panel, signature);
    placePanel(panel);
  }
  function renderLoading(signature, count) {
    renderShell(signature, `<div class="ccp-loading"><span class="ccp-spinner"></span>Đang kiểm tra tồn kho ${count} sản phẩm…</div>`, "ccp-state-loading");
  }
  function suggestionCard(rule, stock) {
    const note = String(rule.consultation_note || "").trim();
    const noteHtml = note ? `<div class="ccp-note"><span>Gợi ý tư vấn</span>${escapeHtml(note)}</div>` : "";
    return `<li><div class="ccp-suggestion-name">${escapeHtml(rule.suggested_product_name)}</div>${noteHtml}<div class="ccp-meta"><span class="ccp-stock">Tổng tồn: ${stock.availableQuantity}</span><span class="ccp-unit">Đơn vị: ${escapeHtml(stock.unitName || "—")}</span><span class="ccp-price">Giá: ${formatPrice(stock.finalPrice)}</span></div></li>`;
  }
  function renderSuggestions(signature, rules, stockResult) {
    const availableRules = rules.filter(rule => stockResult.products?.[Number(rule.suggested_product_id)]?.available);
    if (!availableRules.length) {
      renderShell(signature, `<div class="ccp-empty-stock">Hiện không có sản phẩm gợi ý còn tồn kho tại POS này.</div>`, "ccp-state-empty");
      return;
    }
    const grouped = new Map();
    availableRules.forEach(rule => {
      const key = `${rule.__cartPosition}:${rule.source_product_id}:${rule.__cartSourceName}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(rule);
    });
    const html = [...grouped.values()].map(group => {
      const source = group[0];
      return `<section class="ccp-group"><div class="ccp-group-title"><span class="ccp-source-index">${source.__cartPosition}</span><span>Khi bán: ${escapeHtml(source.__cartSourceName)}</span></div><ul>${group.map(rule => suggestionCard(rule, stockResult.products?.[Number(rule.suggested_product_id)])).join("")}</ul></section>`;
    }).join("");
    renderShell(signature, html, "ccp-state-ready");
  }
  function renderWarning(signature, message) {
    renderShell(signature, `<div class="ccp-warning">${escapeHtml(message)}</div>`, "ccp-state-warning");
  }
  function scheduleRetry(signature) {
    if (retryState.signature !== signature) retryState = { signature, attempts: 0 };
    if (retryState.attempts >= MAX_UI_RETRIES) return;
    retryState.attempts += 1;
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => scanCart(true).catch(() => {}), 1500 * retryState.attempts);
  }
  async function executeScan(force = false) {
    const revision = cartRevision;
    const products = extractCartProducts(document.querySelector(TABLE_SELECTOR));
    const signature = productSignature(products);
    const scanKey = `${location.pathname}|${signature}|${cartRevision}`;
    if (!force && scanKey === lastScanKey) return;
    lastScanKey = scanKey;
    const sequence = ++requestSequence;
    if (signature !== dismissedProductSignature) dismissedProductSignature = "";
    if (!products.length) { removePanel(); return; }
    if (!dataset) {
      const stored = await sendMessage({ type: "GET_DATASET" });
      dataset = stored.consultationDataset || null;
    }
    if (!dataset) {
      renderWarning(signature, "Đang chờ đồng bộ dữ liệu tư vấn. Extension sẽ tự thử lại.");
      scheduleRetry(signature);
      return;
    }
    const rules = rulesForCart(products);
    if (!rules.length || dismissedProductSignature === signature) { removePanel(); return; }
    const posConfig = readJsonStorage("pos_config");
    const entity = readJsonStorage("entity");
    const selectedStore = localStorage.getItem("storesClicked");
    const allowsSingleLocationFallback = location.origin === DEV_POS_ORIGIN;
    if (!posConfig?.pos_id || (!posConfig?.auto_put_location && !allowsSingleLocationFallback) || (entity?.id && entity.id !== posConfig.pos_id) || (selectedStore && selectedStore !== posConfig.pos_id)) {
      renderWarning(signature, "Chưa xác định được đúng cửa hàng bán hàng. Extension sẽ tự thử lại.");
      scheduleRetry(signature);
      return;
    }
    renderLoading(signature, rules.length);
    const stockResult = await sendMessage({ type: "CHECK_STOCK", payload: {
      productIds: rules.map(rule => Number(rule.suggested_product_id)),
      sessionToken: readSessionToken(), posId: posConfig.pos_id, salesLocationId: posConfig.auto_put_location, posOrigin: location.origin,
    }});
    if (sequence !== requestSequence || revision !== cartRevision) return;
    if (!stockResult?.ok) {
      const retryable = !["UNAUTHORIZED", "NO_SESSION"].includes(stockResult?.code);
      renderWarning(signature, `${stockResult?.error || "Không kiểm tra được tồn kho."}${retryable ? " Extension sẽ tự thử lại." : ""}`);
      if (retryable) scheduleRetry(signature);
      return;
    }
    retryState = { signature, attempts: 0 };
    renderSuggestions(signature, rules, stockResult);
  }
  async function scanCart(force = false) {
    if (scanInFlight) {
      queuedScan = true;
      return;
    }
    scanInFlight = true;
    try {
      await executeScan(force);
    } finally {
      scanInFlight = false;
      if (queuedScan) {
        queuedScan = false;
        setTimeout(() => scanCart(true).catch(error => renderWarning("", `Extension gặp lỗi: ${error.message}`)), 0);
      }
    }
  }
  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => scanCart().catch(error => renderWarning("", `Extension gặp lỗi: ${error.message}`)), 180);
  }
  function attachCartObserver() {
    const table = document.querySelector(TABLE_SELECTOR);
    if (!table || table === observedTable) return;
    tableObserver?.disconnect();
    observedTable = table;
    tableObserver = new MutationObserver(() => {
      cartRevision += 1;
      scheduleScan();
    });
    tableObserver.observe(table, { childList: true, subtree: true, characterData: true });
    cartRevision += 1;
    lastScanKey = "";
    scheduleScan();
  }
  function ensureLayout() {
    attachCartObserver();
    const panel = document.getElementById(PANEL_ID);
    if (panel) placePanel(panel);
  }
  function scheduleLayout() {
    clearTimeout(layoutTimer);
    layoutTimer = setTimeout(ensureLayout, 100);
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.consultationDataset) {
      dataset = changes.consultationDataset.newValue || null;
      lastScanKey = "";
      scanCart(true).catch(() => {});
    }
  });
  sendMessage({ type: "GET_DATASET" }).then(result => {
    dataset = result.consultationDataset || null;
    ensureLayout();
    sendMessage({ type: "SYNC_DATASET" }).then(sync => {
      if (sync?.ok) dataset = sync.dataset;
      lastScanKey = "";
      scanCart(true).catch(() => {});
    });
  });
  new MutationObserver(scheduleLayout).observe(document.documentElement, { childList: true, subtree: true });
  setInterval(ensureLayout, 1000);
  setInterval(() => {
    if (observedTable && !scanInFlight) scanCart(false).catch(() => {});
  }, FALLBACK_SCAN_MS);
})();
