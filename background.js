"use strict";
importScripts("core.js");

const CONFIG = Object.freeze({
  supabaseUrl: "https://wbbjxaegcubhyxgemucj.supabase.co",
  supabasePublishableKey: "sb_publishable_qg-vekzhhsnX90Aj5YUUWg_t9KiR_bN",
  productApiByPosOrigin: Object.freeze({
    "https://pos.v2.circa.vn": "https://api.v2.circa.vn/v2/product",
    "https://pos.dev.circa-v2.buymed.tech": "https://pos.dev.circa-v2.buymed.tech/backend/v2/product",
  }),
  devPosOrigin: "https://pos.dev.circa-v2.buymed.tech",
  syncAlarm: "circa-consult-sync",
  syncMinutes: 15,
  stockCacheTtlMs: 60_000,
  requestTimeoutMs: 8_000,
  stockRequestAttempts: 2,
});

const stockCache = new Map();

function storageGet(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

function storageSet(values) {
  return new Promise((resolve, reject) => chrome.storage.local.set(values, () => {
    const error = chrome.runtime.lastError;
    if (error) reject(error); else resolve();
  }));
}

function validateDataset(dataset) {
  return CIRCA_CORE.validateDataset(dataset);
}

async function fetchRpc(name) {
  const response = await fetch(`${CONFIG.supabaseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: CONFIG.supabasePublishableKey, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!response.ok) { const error = new Error(`Supabase ${name} HTTP ${response.status}`); error.status = response.status; throw error; }
  return response.json();
}
function legacyBundle(dataset) {
  return {
    schema_version: 2,
    bundle_version: `legacy:${dataset.dataset_version}`,
    generated_at: new Date().toISOString(),
    programs: [{
      program_id: "legacy-consultation", program_type: "consultation", program_name: "Tư vấn bán kèm",
      display_title: "Gợi ý tư vấn bán kèm", dataset_version: dataset.dataset_version, published_at: dataset.published_at,
      effective_from: null, effective_to: null, lifecycle_status: "active", source_filename: null, source_sheet_name: null,
      checksum: dataset.checksum, row_count: dataset.row_count, rules: dataset.rules,
    }],
  };
}
async function syncDataset() {
  const startedAt = new Date().toISOString();
  try {
    let bundle;
    try { bundle = CIRCA_CORE.validateProgramBundle(await fetchRpc("get_program_bundle")); }
    catch (error) {
      if (![400, 404].includes(error.status)) throw error;
      const legacy = validateDataset(await fetchRpc("get_latest_dataset"));
      if (!legacy.dataset_version) throw new Error("Supabase chưa có dữ liệu được publish.");
      bundle = CIRCA_CORE.validateProgramBundle(legacyBundle(legacy));
    }
    const current = await storageGet(["programBundle"]);
    const changed = current.programBundle?.bundle_version !== bundle.bundle_version;
    const consultation = bundle.programs.find(item => item.program_type === "consultation") || null;
    const consultationDataset = consultation ? {
      schema_version: 1, dataset_version: consultation.dataset_version, published_at: consultation.published_at,
      checksum: consultation.checksum, row_count: consultation.row_count, rules: consultation.rules,
    } : null;
    await storageSet({
      programBundle: bundle,
      consultationDataset,
      datasetSyncStatus: { ok: true, changed, version: bundle.bundle_version, programCount: bundle.programs.length,
        syncedAt: new Date().toISOString(), error: null },
    });
    return { ok: true, changed, bundle };
  } catch (error) {
    await storageSet({ datasetSyncStatus: { ok: false, syncedAt: startedAt, error: error.message } });
    return { ok: false, error: error.message };
  }
}
function normalizeIds(values) {
  return [...new Set((values || []).map(Number).filter(id => Number.isInteger(id) && id > 0))];
}

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function fetchProductItems(productIds, sessionToken, productApi) {
  let lastError = null;
  for (let attempt = 1; attempt <= CONFIG.stockRequestAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONFIG.requestTimeoutMs);
    try {
      const response = await fetch(productApi, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify({ product_ids: productIds, get_all_price: true }),
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) {
        const error = new Error("Phiên POS hết hạn. Vui lòng đăng nhập lại.");
        error.code = "UNAUTHORIZED";
        throw error;
      }
      if (!response.ok) throw new Error(`Circa Product API HTTP ${response.status}`);
      const body = await response.json();
      if (!body?.success || !Array.isArray(body?.data?.products)) throw new Error("Circa Product API trả dữ liệu không hợp lệ.");
      return body.data.products;
    } catch (error) {
      if (error.code === "UNAUTHORIZED") throw error;
      lastError = error;
      if (attempt < CONFIG.stockRequestAttempts) await wait(350 * attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  if (lastError?.name === "AbortError") {
    const error = new Error("Kiểm tra tồn kho quá thời gian.");
    error.code = "TIMEOUT";
    throw error;
  }
  if (lastError) lastError.code = lastError.code || "API_ERROR";
  throw lastError || Object.assign(new Error("Không kiểm tra được tồn kho."), { code: "API_ERROR" });
}

async function fetchStock({ productIds, sessionToken, posId, salesLocationId, posOrigin }) {
  const ids = normalizeIds(productIds);
  if (!ids.length) return { ok: true, products: {} };
  if (!sessionToken) return { ok: false, code: "NO_SESSION", error: "Không đọc được phiên đăng nhập POS." };
  const productApi = CONFIG.productApiByPosOrigin[posOrigin];
  if (!productApi) return { ok: false, code: "UNSUPPORTED_POS_ORIGIN", error: "Domain POS không nằm trong danh sách được extension hỗ trợ." };
  const isDevPos = posOrigin === CONFIG.devPosOrigin;
  if (!posId) return { ok: false, code: "NO_POS_CONTEXT", error: "Không xác định được POS bán hàng." };
  const cacheLocationScope = salesLocationId || (isDevPos ? "single-location" : "all-sales-locations");

  const now = Date.now();
  const result = {};
  const missing = [];
  ids.forEach(id => {
    const cached = stockCache.get(`${posOrigin}:${posId}:${cacheLocationScope}:${id}`);
    if (cached && cached.expiresAt > now) result[id] = cached.value;
    else missing.push(id);
  });

  if (missing.length) {
    try {
      const items = await fetchProductItems(missing, sessionToken, productApi);
      const returned = new Map(items.map(item => [Number(item.product?.product_id), item]));
      missing.forEach(id => {
        const value = CIRCA_CORE.evaluateStock(returned.get(id), id, salesLocationId, {
          allowSingleSalesLocationFallback: isDevPos,
          aggregateAllSalesLocations: !salesLocationId && !isDevPos,
          matchPriceToStock: isDevPos,
        });
        result[id] = value;
        stockCache.set(`${posOrigin}:${posId}:${cacheLocationScope}:${id}`, { value, expiresAt: now + CONFIG.stockCacheTtlMs });
      });
    } catch (error) {
      return { ok: false, code: error.code || "API_ERROR", error: error.message };
    }
  }
  return { ok: true, products: result };
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(CONFIG.syncAlarm, { periodInMinutes: CONFIG.syncMinutes });
  syncDataset();
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(CONFIG.syncAlarm, { periodInMinutes: CONFIG.syncMinutes });
  syncDataset();
});
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === CONFIG.syncAlarm) syncDataset(); });

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const respond = promise => promise
    .then(sendResponse)
    .catch(error => sendResponse({ ok: false, code: error.code || "UNEXPECTED_ERROR", error: error.message || "Extension gặp lỗi không xác định." }));
  if (message?.type === "SYNC_DATASET") { respond(syncDataset()); return true; }
  if (message?.type === "GET_DATASET") { respond(storageGet(["programBundle", "consultationDataset", "datasetSyncStatus"])); return true; }
  if (message?.type === "CHECK_STOCK") { respond(fetchStock(message.payload || {})); return true; }
  return false;
});
