(function () {
  "use strict";

  const config = window.CIRCA_ADMIN_CONFIG;
  const requiredColumns = [
    "source_product_id", "source_product_name", "suggested_product_id",
    "suggested_product_name", "consultation_title", "consultation_note"
  ];
  const state = { session: null, pending: null, versions: [] };
  const $ = (id) => document.getElementById(id);

  function toast(message) {
    const el = $("toast");
    el.textContent = message;
    el.classList.add("show");
    setTimeout(() => el.classList.remove("show"), 3500);
  }

  async function request(path, options = {}) {
    const headers = {
      apikey: config.supabasePublishableKey,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    };
    if (state.session?.access_token) headers.Authorization = `Bearer ${state.session.access_token}`;
    const response = await fetch(`${config.supabaseUrl}${path}`, { ...options, headers });
    const body = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.msg || body?.message || body?.error_description || body?.hint || `HTTP ${response.status}`);
    return body;
  }

  function saveSession(session) {
    state.session = session;
    if (session) sessionStorage.setItem("circa_admin_session", JSON.stringify(session));
    else sessionStorage.removeItem("circa_admin_session");
    renderAuth();
  }

  function restoreSession() {
    try { state.session = JSON.parse(sessionStorage.getItem("circa_admin_session")); }
    catch (_) { state.session = null; }
  }

  function renderAuth() {
    const loggedIn = Boolean(state.session?.access_token);
    $("auth-card").classList.toggle("hidden", loggedIn);
    $("app").classList.toggle("hidden", !loggedIn);
    $("user-area").classList.toggle("hidden", !loggedIn);
    $("user-email").textContent = state.session?.user?.email || "";
    if (loggedIn) loadDashboard().catch(handleError);
  }

  async function authenticate(mode) {
    const email = $("email").value.trim().toLowerCase();
    const password = $("password").value;
    if (!email || !password) throw new Error("Cần nhập email và mật khẩu.");
    const path = mode === "signup" ? "/auth/v1/signup" : "/auth/v1/token?grant_type=password";
    const session = await request(path, { method: "POST", body: JSON.stringify({ email, password }) });
    if (!session.access_token) throw new Error("Tài khoản đã tạo nhưng chưa có session. Kiểm tra email xác nhận nếu project yêu cầu.");
    saveSession(session);
    toast(mode === "signup" ? "Đã tạo tài khoản Admin." : "Đăng nhập thành công.");
  }

  function normalizeHeader(value) {
    return String(value || "").trim().toLowerCase().replace(/\s+/g, "_");
  }

  function parseBoolean(value, fallback = true) {
    if (value === null || value === undefined || value === "") return fallback;
    if (typeof value === "boolean") return value;
    const normalized = String(value).trim().toLowerCase();
    if (["true", "1", "yes", "có", "x"].includes(normalized)) return true;
    if (["false", "0", "no", "không"].includes(normalized)) return false;
    throw new Error(`Giá trị boolean không hợp lệ: ${value}`);
  }

  function parsePositiveId(value, field, rowNumber) {
    const text = String(value ?? "").trim();
    if (!/^\d+$/.test(text) || Number(text) <= 0) throw new Error(`Dòng ${rowNumber}: ${field} phải là số nguyên dương.`);
    return text;
  }

  function validateRows(rawRows) {
    if (!rawRows.length) throw new Error("Sheet không có dữ liệu.");
    const normalizedRows = rawRows.map((raw, index) => {
      const row = {};
      Object.entries(raw).forEach(([key, value]) => { row[normalizeHeader(key)] = value; });
      const rowNumber = index + 2;
      const missing = requiredColumns.filter(key => !String(row[key] ?? "").trim());
      if (missing.length) throw new Error(`Dòng ${rowNumber}: thiếu ${missing.join(", ")}.`);
      const sourceId = parsePositiveId(row.source_product_id, "source_product_id", rowNumber);
      const suggestedId = parsePositiveId(row.suggested_product_id, "suggested_product_id", rowNumber);
      if (sourceId === suggestedId) throw new Error(`Dòng ${rowNumber}: sản phẩm nguồn và gợi ý không được trùng nhau.`);
      if (row.effective_from && row.effective_to && String(row.effective_to) < String(row.effective_from)) {
        throw new Error(`Dòng ${rowNumber}: effective_to phải lớn hơn hoặc bằng effective_from.`);
      }
      return {
        rule_code: String(row.rule_code || "").trim() || null,
        source_product_id: sourceId,
        source_product_name: String(row.source_product_name).trim(),
        suggested_product_id: suggestedId,
        suggested_product_name: String(row.suggested_product_name).trim(),
        consultation_title: String(row.consultation_title).trim(),
        consultation_note: String(row.consultation_note).trim(),
        category_name: String(row.category_name || row["bệnh_mãn_tính"] || row["bệnh_mạn_tính"] || "").trim() || null,
        priority: Number.isInteger(Number(row.priority)) ? Number(row.priority) : 100,
        is_active: parseBoolean(row.is_active, true),
        effective_from: String(row.effective_from || "").trim() || null,
        effective_to: String(row.effective_to || "").trim() || null,
        source: String(row.source || "").trim() || null,
        note_internal: String(row.note_internal || "").trim() || null,
      };
    });
    const pairs = new Set();
    normalizedRows.forEach((row, index) => {
      const pair = `${row.source_product_id}>${row.suggested_product_id}`;
      if (pairs.has(pair)) throw new Error(`Dòng ${index + 2}: cặp source → suggested bị trùng (${pair}).`);
      pairs.add(pair);
    });
    return normalizedRows;
  }

  async function digest(buffer) {
    const hash = await crypto.subtle.digest("SHA-256", buffer);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
  }

  async function handleFile(file) {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const sheetName = config.expectedSheetNames.find(name => workbook.SheetNames.includes(name));
    if (!sheetName) throw new Error(`Không tìm thấy sheet ${config.expectedSheetNames.join(" hoặc ")}.`);
    const rawRows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "", raw: false });
    const rules = validateRows(rawRows);
    state.pending = { filename: file.name, checksum: await digest(buffer), sheetName, rules };
    $("validation-summary").className = "validation ok";
    $("validation-summary").textContent = `Hợp lệ: ${rules.length} rule · Sheet ${sheetName}\nSHA-256: ${state.pending.checksum}`;
    $("save-draft").disabled = false;
    $("clear-file").disabled = false;
    renderPreview(rules);
  }

  function renderPreview(rules) {
    $("preview-card").classList.remove("hidden");
    $("preview-count").textContent = `${rules.length} rule`;
    $("preview-table").innerHTML = `<thead><tr><th>Source ID</th><th>Sản phẩm nguồn</th><th>Suggested ID</th><th>Sản phẩm gợi ý</th><th>Nội dung</th></tr></thead><tbody>${rules.map(row => `<tr><td>${escapeHtml(row.source_product_id)}</td><td>${escapeHtml(row.source_product_name)}</td><td>${escapeHtml(row.suggested_product_id)}</td><td>${escapeHtml(row.suggested_product_name)}</td><td><strong>${escapeHtml(row.consultation_title)}</strong><br>${escapeHtml(row.consultation_note)}</td></tr>`).join("")}</tbody>`;
  }

  function escapeHtml(value) {
    const node = document.createElement("div");
    node.textContent = value ?? "";
    return node.innerHTML;
  }

  function clearPending() {
    state.pending = null;
    $("dataset-file").value = "";
    $("validation-summary").className = "validation empty";
    $("validation-summary").textContent = "Chưa chọn file.";
    $("save-draft").disabled = true;
    $("clear-file").disabled = true;
    $("preview-card").classList.add("hidden");
  }

  async function saveDraft() {
    if (!state.pending) return;
    $("save-draft").disabled = true;
    const result = await request("/rest/v1/rpc/create_draft_dataset", {
      method: "POST",
      body: JSON.stringify({
        p_source_filename: state.pending.filename,
        p_rules: state.pending.rules,
        p_checksum: state.pending.checksum,
      }),
    });
    toast(`Đã tạo draft ${result}.`);
    clearPending();
    await loadDashboard();
  }

  async function loadDashboard() {
    const [current, versions] = await Promise.all([
      request("/rest/v1/rpc/get_latest_dataset", { method: "POST", body: "{}" }),
      request("/rest/v1/dataset_versions?select=id,version,status,source_filename,row_count,created_by_email,created_at,published_by_email,published_at&order=created_at.desc", { method: "GET" }),
    ]);
    state.versions = versions;
    renderCurrent(current);
    renderVersions(versions);
  }

  function renderCurrent(current) {
    $("current-status").innerHTML = current?.dataset_version
      ? `<dt>Version</dt><dd>${escapeHtml(current.dataset_version)}</dd><dt>Published</dt><dd>${escapeHtml(new Date(current.published_at).toLocaleString("vi-VN"))}</dd><dt>Số rule hiệu lực</dt><dd>${current.rules?.length || 0}</dd><dt>Checksum</dt><dd>${escapeHtml(current.checksum || "—")}</dd>`
      : "<dt>Trạng thái</dt><dd>Chưa có dataset published.</dd>";
  }

  function renderVersions(versions) {
    $("versions-table").innerHTML = `<thead><tr><th>Version</th><th>Trạng thái</th><th>File</th><th>Rules</th><th>Người tạo</th><th>Published</th><th>Thao tác</th></tr></thead><tbody>${versions.map(v => `<tr><td>${escapeHtml(v.version)}</td><td><span class="badge ${v.status}">${escapeHtml(v.status)}</span></td><td>${escapeHtml(v.source_filename)}</td><td>${v.row_count}</td><td>${escapeHtml(v.created_by_email || "—")}</td><td>${v.published_at ? escapeHtml(new Date(v.published_at).toLocaleString("vi-VN")) : "—"}</td><td>${v.status === "published" ? "Đang áp dụng" : `<button data-publish="${v.id}" class="${v.status === "archived" ? "secondary" : ""}">${v.status === "archived" ? "Rollback" : "Publish"}</button>`}</td></tr>`).join("")}</tbody>`;
  }

  async function publish(id) {
    const version = state.versions.find(item => item.id === id);
    if (!version || !confirm(`${version.status === "archived" ? "Rollback" : "Publish"} dataset ${version.version}?`)) return;
    await request("/rest/v1/rpc/publish_dataset", { method: "POST", body: JSON.stringify({ p_dataset_id: id }) });
    toast(`Đã áp dụng version ${version.version}.`);
    await loadDashboard();
  }

  function handleError(error) {
    console.error(error);
    toast(error.message || "Có lỗi xảy ra.");
    if (/jwt|token|401/i.test(error.message || "")) saveSession(null);
  }

  $("login").onclick = () => authenticate("login").catch(handleError);
  $("signup")?.addEventListener("click", () => authenticate("signup").catch(handleError));
  $("logout").onclick = () => saveSession(null);
  $("refresh").onclick = () => loadDashboard().catch(handleError);
  $("clear-file").onclick = clearPending;
  $("save-draft").onclick = () => saveDraft().catch(handleError);
  $("dataset-file").onchange = event => {
    const file = event.target.files?.[0];
    if (!file) return;
    handleFile(file).catch(error => {
      state.pending = null;
      $("validation-summary").className = "validation error";
      $("validation-summary").textContent = error.message;
      $("save-draft").disabled = true;
      $("clear-file").disabled = false;
    });
  };
  $("versions-table").onclick = event => {
    const id = event.target.dataset?.publish;
    if (id) publish(id).catch(handleError);
  };

  restoreSession();
  renderAuth();
})();
