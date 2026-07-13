"use strict";
importScripts("core.js");

const CONFIG = Object.freeze({
  supabaseUrl: "https://wbbjxaegcubhyxgemucj.supabase.co",
  supabasePublishableKey: "sb_publishable_qg-vekzhhsnX90Aj5YUUWg_t9KiR_bN",
  circaProductApi: "https://api.v2.circa.vn/v2/product",
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

async function syncDataset() {
  const startedAt = new Date().toISOString();
  try {
    const response = await fetch(`${CONFIG.supabaseUrl}/rest/v1/rpc/get_latest_dataset`, {
      method: "POST",
      headers: { apikey: CONFIG.supabasePublishableKey, "Content-Type": "application/json" },
      body: "{}",
    });
    if (!response.ok) throw new Error(`Supabase HTTP ${response.status}`);
    const dataset = validateDataset(await response.json());
    if (!dataset.dataset_version) throw new Error("Supabase chưa có dataset published.");
    const current = await storageGet(["consultationDataset"]);
    const changed = current.consultationDataset?.dataset_version !== dataset.dataset_version;
    await storageSet({
      consultationDataset: dataset,
      datasetSyncStatus: { ok: true, changed, version: dataset.dataset_version, syncedAt: new Date().toISOString(), error: null },
    });
    return { ok: true, changed, dataset };
  } catch (error) {
    await storageSet({ datasetSyncStatus: { ok: false, syncedAt: startedAt, error: error.message } });
    return { ok: false, error: error.message };
  }
}

function normalizeIds(values) {
  return [...new Set((values || []).map(Number).filter(id => Number.isInteger(id) && id > 0))];
}

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function fetchProductItems(productIds, sessionToken) {
  let lastError = null;
  for (let attempt = 1; attempt <= CONFIG.stockRequestAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONFIG.requestTimeoutMs);
    try {
      const response = await fetch(CONFIG.circaProductApi, {
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

async function fetchStock({ productIds, sessionToken, posId, salesLocationId }) {
  const ids = normalizeIds(productIds);
  if (!ids.length) return { ok: true, products: {} };
  if (!sessionToken) return { ok: false, code: "NO_SESSION", error: "Không đọc được phiên đăng nhập POS." };
  if (!posId || !salesLocationId) return { ok: false, code: "NO_POS_CONTEXT", error: "Không xác định được POS hoặc sales location." };

  const now = Date.now();
  const result = {};
  const missing = [];
  ids.forEach(id => {
    const cached = stockCache.get(`${posId}:${id}`);
    if (cached && cached.expiresAt > now) result[id] = cached.value;
    else missing.push(id);
  });

  if (missing.length) {
    try {
      const items = await fetchProductItems(missing, sessionToken);
      const returned = new Map(items.map(item => [Number(item.product?.product_id), item]));
      missing.forEach(id => {
        const value = CIRCA_CORE.evaluateStock(returned.get(id), id, salesLocationId);
        result[id] = value;
        stockCache.set(`${posId}:${id}`, { value, expiresAt: now + CONFIG.stockCacheTtlMs });
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
  if (message?.type === "SYNC_DATASET") { syncDataset().then(sendResponse); return true; }
  if (message?.type === "GET_DATASET") { storageGet(["consultationDataset", "datasetSyncStatus"]).then(sendResponse); return true; }
  if (message?.type === "CHECK_STOCK") { fetchStock(message.payload || {}).then(sendResponse); return true; }
  return false;
});
