"use strict";
const statusEl = document.getElementById("status"),
  programsEl = document.getElementById("programs"),
  syncButton = document.getElementById("sync");
function message(payload) {
  return new Promise((resolve) => chrome.runtime.sendMessage(payload, resolve));
}
function escapeHtml(value) {
  const d = document.createElement("div");
  d.textContent = value ?? "";
  return d.innerHTML;
}
function date(value) {
  return value ? new Date(value).toLocaleString("vi-VN") : "—";
}
function typeName(v) {
  return (
    {
      consultation: "Tư vấn bán kèm",
      promotion: "Khuyến mãi",
      marketing: "Marketing",
      near_expiry: "Cận date",
      combo: "Combo",
    }[v] || v
  );
}
function lifecycle(p) {
  return CIRCA_CORE.programLifecycle(p);
}
function renderRules(program) {
  if (program.program_type === "combo") {
    const rows = (program.rules || [])
      .map(
        (rule) =>
          "<tr><td>" +
          escapeHtml(rule.combo_id) +
          "</td><td>" +
          escapeHtml(rule.source_product_id) +
          "</td><td>" +
          escapeHtml(rule.message) +
          "</td></tr>",
      )
      .join("");
    return (
      "<div class=\rules\><table><thead><tr><th>Combo ID</th><th>Sub product ID</th><th>Nội dung</th></tr></thead><tbody>" +
      rows +
      "</tbody></table></div>"
    );
  }
  const rows = (program.rules || [])
    .map((rule) =>
      program.program_type === "consultation"
        ? `<tr><td>${rule.source_product_id}</td><td>${rule.suggested_product_id}</td><td>${escapeHtml(rule.consultation_note || rule.consultation_title)}</td></tr>`
        : `<tr><td>${rule.source_product_id}</td><td>${escapeHtml(rule.related_product_id || "—")}</td><td>${escapeHtml(rule.message)}</td></tr>`,
    )
    .join("");
  return `<div class="rules"><table><thead><tr><th>Source product ID</th><th>${program.program_type === "consultation" ? "Suggested" : "Related"} product ID</th><th>Nội dung</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
function render(data) {
  const bundle = data?.programBundle,
    sync = data?.datasetSyncStatus,
    programs = bundle?.programs || [];
  statusEl.innerHTML = [
    [
      "Trạng thái",
      sync?.ok
        ? '<span class="ok">Đã đồng bộ</span>'
        : `<span class="error">${escapeHtml(sync?.error || "Chưa đồng bộ")}</span>`,
    ],
    ["Bundle version", escapeHtml(bundle?.bundle_version || "—")],
    ["Số chương trình", String(programs.length)],
    [
      "Số rule",
      String(programs.reduce((n, p) => n + (p.rules?.length || 0), 0)),
    ],
    ["Đồng bộ gần nhất", date(sync?.syncedAt)],
  ]
    .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`)
    .join("");
  programsEl.className = programs.length ? "" : "empty";
  programsEl.innerHTML = programs.length
    ? programs
        .map((p) => {
          const state = lifecycle(p);
          return `<details class="program"><summary><span class="type">${escapeHtml(typeName(p.program_type))}</span><span>${escapeHtml(p.program_name)}</span><span class="status ${state}">${state}</span></summary><div class="program-body"><dl><dt>Tiêu đề popup</dt><dd>${escapeHtml(p.display_title)}</dd><dt>Hiệu lực</dt><dd>${date(p.effective_from)} → ${date(p.effective_to)}</dd><dt>File / sheet</dt><dd>${escapeHtml(p.source_filename || "—")} / ${escapeHtml(p.source_sheet_name || "—")}</dd><dt>Version</dt><dd>${escapeHtml(p.dataset_version)}</dd><dt>Published</dt><dd>${date(p.published_at)} · ${escapeHtml(p.published_by_email || "—")}</dd><dt>Số rule</dt><dd>${p.rules?.length || 0}</dd><dt>Checksum</dt><dd>${escapeHtml(p.checksum || "—")}</dd></dl>${renderRules(p)}</div></details>`;
        })
        .join("")
    : "Chưa có chương trình nào được publish.";
}
async function load() {
  render(await message({ type: "GET_DATASET" }));
}
syncButton.onclick = async () => {
  syncButton.disabled = true;
  syncButton.textContent = "Đang đồng bộ…";
  await message({ type: "SYNC_DATASET" });
  await load();
  syncButton.disabled = false;
  syncButton.textContent = "Đồng bộ ngay";
};
load();
