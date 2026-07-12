"use strict";
const statusEl = document.getElementById("status");
const syncButton = document.getElementById("sync");
function message(payload) { return new Promise(resolve => chrome.runtime.sendMessage(payload, resolve)); }
function escapeHtml(value) { const d=document.createElement("div"); d.textContent=value??""; return d.innerHTML; }
function render(data) {
  const dataset = data?.consultationDataset;
  const sync = data?.datasetSyncStatus;
  statusEl.innerHTML = [
    ["Trạng thái", sync?.ok ? '<span class="ok">Đã đồng bộ</span>' : `<span class="error">${escapeHtml(sync?.error || "Chưa đồng bộ")}</span>`],
    ["Dataset version", escapeHtml(dataset?.dataset_version || "—")],
    ["Published", dataset?.published_at ? escapeHtml(new Date(dataset.published_at).toLocaleString("vi-VN")) : "—"],
    ["Số rule hiệu lực", String(dataset?.rules?.length || 0)],
    ["Đồng bộ gần nhất", sync?.syncedAt ? escapeHtml(new Date(sync.syncedAt).toLocaleString("vi-VN")) : "—"],
  ].map(([key,value])=>`<dt>${key}</dt><dd>${value}</dd>`).join("");
}
async function load() { render(await message({type:"GET_DATASET"})); }
syncButton.onclick = async () => {
  syncButton.disabled = true; syncButton.textContent = "Đang đồng bộ…";
  await message({type:"SYNC_DATASET"}); await load();
  syncButton.disabled = false; syncButton.textContent = "Đồng bộ ngay";
};
load();

