(function () {
  "use strict";
  const TABLE_SELECTOR = "#table-order-items-offline";
  const PANEL_ID = "circa-consult-panel";
  const PRODUCT_NAME_SELECTOR = "td:nth-child(2) p.font-semibold";
  let dataset = null;
  let tableObserver = null;
  let observedTable = null;
  let scanTimer = null;
  let requestSequence = 0;
  let lastCartSignature = "";
  let dismissedSignature = "";
  let minimized = false;

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
  function parseProductLabel(text) {
    return CIRCA_CORE.parseProductLabel(text);
  }
  function extractCartProducts(table) {
    const products = [];
    table?.querySelectorAll("tbody tr").forEach(row => {
      const product = parseProductLabel(row.querySelector(PRODUCT_NAME_SELECTOR)?.textContent);
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
        rule.__cartSourceName = sourceNames.get(Number(rule.source_product_id)) || rule.source_product_name;
        return true;
      });
  }
  function escapeHtml(value) {
    const node = document.createElement("div"); node.textContent = value == null ? "" : value; return node.innerHTML;
  }
  function formatPrice(value) { return Number(value).toLocaleString("vi-VN") + " đ"; }
  function getPanel() {
    let panel = document.getElementById(PANEL_ID);
    if (!panel) { panel = document.createElement("aside"); panel.id = PANEL_ID; document.body.appendChild(panel); }
    return panel;
  }
  function removePanel() { document.getElementById(PANEL_ID)?.remove(); }
  function bindPanel(panel, signature) {
    panel.querySelector(".ccp-close")?.addEventListener("click", () => { dismissedSignature = signature; panel.remove(); });
    panel.querySelector(".ccp-minimize")?.addEventListener("click", () => {
      minimized = !minimized;
      panel.classList.toggle("ccp-minimized", minimized);
      panel.querySelector(".ccp-minimize").textContent = minimized ? "+" : "−";
    });
  }
  function renderShell(signature, body) {
    const panel = getPanel();
    panel.className = minimized ? "ccp-minimized" : "";
    panel.innerHTML = `<div class="ccp-header"><span>💊 Gợi ý tư vấn bán kèm</span><div><button class="ccp-minimize" title="Thu gọn">${minimized ? "+" : "−"}</button><button class="ccp-close" title="Đóng">×</button></div></div><div class="ccp-body">${body}</div>`;
    bindPanel(panel, signature);
  }
  function renderLoading(signature, count) {
    renderShell(signature, `<div class="ccp-loading">Đang kiểm tra tồn kho ${count} sản phẩm…</div>`);
  }
  function renderSuggestions(signature, rules, stockResult) {
    const available = rules.filter(rule => stockResult.products?.[Number(rule.suggested_product_id)]?.available);
    if (!available.length) { removePanel(); return; }
    const grouped = new Map();
    available.forEach(rule => {
      const key = `${rule.source_product_id}:${rule.__cartSourceName}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(rule);
    });
    const html = [...grouped.entries()].map(([key, group]) => {
      const sourceName = key.slice(key.indexOf(":") + 1);
      return `<section class="ccp-group"><div class="ccp-group-title">Khi bán: ${escapeHtml(sourceName)}</div><ul>${group.map(rule => {
        const stock = stockResult.products[Number(rule.suggested_product_id)];
        return `<li><div class="ccp-suggestion-name">${escapeHtml(rule.suggested_product_name)}</div><div class="ccp-note">${escapeHtml(rule.consultation_note)}</div><div class="ccp-meta"><span class="ccp-stock">Còn ${stock.availableQuantity}</span>${stock.finalPrice ? `<span>${formatPrice(stock.finalPrice)}</span>` : ""}</div></li>`;
      }).join("")}</ul></section>`;
    }).join("");
    renderShell(signature, html);
  }
  function renderApiWarning(signature, message) {
    renderShell(signature, `<div class="ccp-warning">${escapeHtml(message)} Không hiển thị các gợi ý chưa xác nhận được tồn kho.</div>`);
  }
  async function scanCart() {
    const products = extractCartProducts(document.querySelector(TABLE_SELECTOR));
    const signature = products.map(item => item.productId).sort((a, b) => a - b).join(",");
    if (signature === lastCartSignature) return;
    lastCartSignature = signature;
    const sequence = ++requestSequence;
    if (signature !== dismissedSignature) dismissedSignature = "";
    if (!products.length) { removePanel(); return; }
    if (!dataset) {
      const stored = await sendMessage({ type: "GET_DATASET" });
      dataset = stored.consultationDataset || null;
    }
    const rules = rulesForCart(products);
    if (!rules.length || dismissedSignature === signature) { removePanel(); return; }
    const posConfig = readJsonStorage("pos_config");
    const entity = readJsonStorage("entity");
    const selectedStore = localStorage.getItem("storesClicked");
    if (!posConfig?.pos_id || !posConfig?.auto_put_location || (entity?.id && entity.id !== posConfig.pos_id) || (selectedStore && selectedStore !== posConfig.pos_id)) {
      renderApiWarning(signature, "Chưa xác định được đúng cửa hàng bán hàng."); return;
    }
    renderLoading(signature, rules.length);
    const stockResult = await sendMessage({ type: "CHECK_STOCK", payload: {
      productIds: rules.map(rule => Number(rule.suggested_product_id)),
      sessionToken: readSessionToken(), posId: posConfig.pos_id, salesLocationId: posConfig.auto_put_location,
    }});
    if (sequence !== requestSequence || signature !== lastCartSignature) return;
    if (!stockResult?.ok) renderApiWarning(signature, stockResult?.error || "Không kiểm tra được tồn kho.");
    else renderSuggestions(signature, rules, stockResult);
  }
  function scheduleScan() { clearTimeout(scanTimer); scanTimer = setTimeout(scanCart, 250); }
  function attachCartObserver() {
    const table = document.querySelector(TABLE_SELECTOR);
    if (!table || table === observedTable) return;
    tableObserver?.disconnect(); observedTable = table;
    tableObserver = new MutationObserver(scheduleScan);
    tableObserver.observe(table, { childList: true, subtree: true, characterData: true });
    lastCartSignature = ""; scheduleScan();
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.consultationDataset) {
      dataset = changes.consultationDataset.newValue || null; lastCartSignature = ""; scheduleScan();
    }
  });
  sendMessage({ type: "GET_DATASET" }).then(result => {
    dataset = result.consultationDataset || null;
    if (!dataset) sendMessage({ type: "SYNC_DATASET" }).then(sync => {
      if (sync?.ok) dataset = sync.dataset; lastCartSignature = ""; scheduleScan();
    });
    attachCartObserver();
  });
  new MutationObserver(attachCartObserver).observe(document.documentElement, { childList: true, subtree: true });
  setInterval(attachCartObserver, 1500);
  setInterval(() => { if (lastCartSignature) { lastCartSignature = ""; scheduleScan(); } }, 60_000);
})();
