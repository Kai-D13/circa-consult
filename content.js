(function () {
  "use strict";
  const TABLE_SELECTOR = "#table-order-items-offline";
  const PANEL_ID = "circa-consult-panel";
  const PRODUCT_NAME_SELECTORS = ["td:nth-child(2) p.font-semibold", "td:nth-child(2) [class*='font-semibold']"];
  const FALLBACK_SCAN_MS = 10_000;
  const MAX_UI_RETRIES = 2;
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

  function sendMessage(message) {
    return new Promise(resolve => chrome.runtime.sendMessage(message, response => {
      if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
      else resolve(response || { ok: false, error: "Extension không trả response." });
    }));
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
  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim().toLocaleLowerCase("vi-VN");
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
    table?.querySelectorAll("tbody tr").forEach(row => {
      const product = productFromRow(row);
      if (product) products.push(product);
    });
    return products;
  }
  function rulesForCart(products) {
    const cartIds = new Set(products.map(item => item.productId));
    const sourceNames = new Map(products.map(item => [item.productId, item.productName]));
    const seenSuggested = new Set();
    return (dataset?.rules || [])
      .filter(rule => cartIds.has(Number(rule.source_product_id)))
      .filter(rule => !cartIds.has(Number(rule.suggested_product_id)))
      .sort((a, b) => Number(a.priority || 100) - Number(b.priority || 100))
      .filter(rule => {
        const id = Number(rule.suggested_product_id);
        if (seenSuggested.has(id)) return false;
        seenSuggested.add(id);
        return true;
      })
      .map(rule => ({ ...rule, __cartSourceName: sourceNames.get(Number(rule.source_product_id)) || rule.source_product_name }));
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
  function findSidebarPlacement() {
    const buttons = Array.from(document.querySelectorAll("button"));
    const payment = buttons.find(button => normalizeText(button.textContent) === "thanh toán");
    if (!payment) return null;
    const footer = payment.closest("div");
    if (!footer) return null;
    const hasCancel = Array.from(footer.querySelectorAll("button")).some(button => normalizeText(button.textContent) === "hủy");
    const form = hasCancel ? footer.closest("form") : null;
    return form ? { form, footer } : null;
  }
  function placePanel(panel) {
    const placement = findSidebarPlacement();
    if (placement) {
      document.querySelectorAll("form.ccp-sidebar-host").forEach(form => {
        if (form !== placement.form) form.classList.remove("ccp-sidebar-host");
      });
      placement.form.classList.add("ccp-sidebar-host");
      panel.classList.remove("ccp-floating");
      if (panel.parentElement !== placement.form || panel.nextElementSibling !== placement.footer) {
        placement.form.insertBefore(panel, placement.footer);
      }
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
    document.querySelectorAll("form.ccp-sidebar-host").forEach(form => form.classList.remove("ccp-sidebar-host"));
  }
  function bindPanel(panel, signature) {
    panel.querySelector(".ccp-close")?.addEventListener("click", () => {
      dismissedProductSignature = signature;
      removePanel();
    });
    panel.querySelector(".ccp-minimize")?.addEventListener("click", () => {
      minimized = !minimized;
      panel.classList.toggle("ccp-minimized", minimized);
      panel.querySelector(".ccp-minimize").textContent = minimized ? "+" : "−";
    });
  }
  function renderShell(signature, body, stateClass = "") {
    const panel = getPanel();
    panel.className = `${minimized ? "ccp-minimized " : ""}${stateClass}`.trim();
    panel.innerHTML = `<div class="ccp-header"><span>💊 Gợi ý tư vấn bán kèm</span><div><button class="ccp-minimize" title="Thu gọn">${minimized ? "+" : "−"}</button><button class="ccp-close" title="Đóng">×</button></div></div><div class="ccp-body">${body}</div>`;
    bindPanel(panel, signature);
    placePanel(panel);
  }
  function renderLoading(signature, count) {
    renderShell(signature, `<div class="ccp-loading"><span class="ccp-spinner"></span>Đang kiểm tra tồn kho ${count} sản phẩm…</div>`, "ccp-state-loading");
  }
  function statusLabel(stock) {
    if (stock?.reason === "OUT_OF_STOCK") return "Hết tồn tại POS này";
    if (stock?.reason === "NO_PRICE") return "Chưa có giá bán hợp lệ";
    if (stock?.reason === "NOT_FOUND") return "Không tìm thấy thông tin sản phẩm";
    return "Chưa xác nhận được tồn kho";
  }
  function suggestionCard(rule, stock) {
    const note = String(rule.consultation_note || "").trim();
    const noteHtml = note ? `<div class="ccp-note"><span>Gợi ý tư vấn</span>${escapeHtml(note)}</div>` : "";
    if (!stock?.available) {
      return `<li class="ccp-unavailable"><div class="ccp-suggestion-name">${escapeHtml(rule.suggested_product_name)}</div>${noteHtml}<div class="ccp-meta"><span class="ccp-status-unavailable">${escapeHtml(statusLabel(stock))}</span></div></li>`;
    }
    return `<li><div class="ccp-suggestion-name">${escapeHtml(rule.suggested_product_name)}</div>${noteHtml}<div class="ccp-meta"><span class="ccp-stock">Tổng tồn: ${stock.availableQuantity}</span><span class="ccp-unit">Đơn vị: ${escapeHtml(stock.unitName || "—")}</span><span class="ccp-price">Giá: ${formatPrice(stock.finalPrice)}</span></div></li>`;
  }
  function renderSuggestions(signature, rules, stockResult) {
    const unavailableCount = rules.filter(rule => !stockResult.products?.[Number(rule.suggested_product_id)]?.available).length;
    const banner = unavailableCount === rules.length
      ? `<div class="ccp-empty-stock">Các sản phẩm gợi ý hiện đã hết tồn hoặc chưa sẵn sàng bán tại POS này.</div>`
      : unavailableCount > 0 ? `<div class="ccp-partial-stock">${unavailableCount} sản phẩm gợi ý hiện chưa sẵn sàng bán tại POS này.</div>` : "";
    const grouped = new Map();
    rules.forEach(rule => {
      const key = `${rule.source_product_id}:${rule.__cartSourceName}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(rule);
    });
    const html = banner + [...grouped.entries()].map(([key, group]) => {
      const sourceName = key.slice(key.indexOf(":") + 1);
      return `<section class="ccp-group"><div class="ccp-group-title">Khi bán: ${escapeHtml(sourceName)}</div><ul>${group.map(rule => suggestionCard(rule, stockResult.products?.[Number(rule.suggested_product_id)])).join("")}</ul></section>`;
    }).join("");
    renderShell(signature, html, unavailableCount === rules.length ? "ccp-state-empty" : "ccp-state-ready");
  }
  function renderWarning(signature, message) {
    renderShell(signature, `<div class="ccp-warning">${escapeHtml(message)}</div>`, "ccp-state-warning");
  }
  function scheduleRetry(signature) {
    if (retryState.signature !== signature) retryState = { signature, attempts: 0 };
    if (retryState.attempts >= MAX_UI_RETRIES) return;
    retryState.attempts += 1;
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => scanCart(true), 1500 * retryState.attempts);
  }
  async function scanCart(force = false) {
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
    if (!posConfig?.pos_id || !posConfig?.auto_put_location || (entity?.id && entity.id !== posConfig.pos_id) || (selectedStore && selectedStore !== posConfig.pos_id)) {
      renderWarning(signature, "Chưa xác định được đúng cửa hàng bán hàng. Extension sẽ tự thử lại.");
      scheduleRetry(signature);
      return;
    }
    renderLoading(signature, rules.length);
    const stockResult = await sendMessage({ type: "CHECK_STOCK", payload: {
      productIds: rules.map(rule => Number(rule.suggested_product_id)),
      sessionToken: readSessionToken(), posId: posConfig.pos_id, salesLocationId: posConfig.auto_put_location,
    }});
    if (sequence !== requestSequence || scanKey !== lastScanKey) return;
    if (!stockResult?.ok) {
      const retryable = !["UNAUTHORIZED", "NO_SESSION"].includes(stockResult?.code);
      renderWarning(signature, `${stockResult?.error || "Không kiểm tra được tồn kho."}${retryable ? " Extension sẽ tự thử lại." : ""}`);
      if (retryable) scheduleRetry(signature);
      return;
    }
    retryState = { signature, attempts: 0 };
    renderSuggestions(signature, rules, stockResult);
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
    if (observedTable) scanCart(true).catch(() => {});
  }, FALLBACK_SCAN_MS);
})();
