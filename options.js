const fileInput = document.getElementById("file");
const msg = document.getElementById("msg");
const preview = document.getElementById("preview");
const countEl = document.getElementById("count");

// Danh sách đang được chọn (parse từ file, chờ bấm Lưu)
let pendingList = null;

function showMsg(text, ok) {
  msg.textContent = text;
  msg.className = ok ? "ok" : "err";
}

function normalize(str) {
  return (str || "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

function slug(str) {
  return normalize(str).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "nhom";
}

// Xác định cột dựa trên tên tiêu đề (chấp nhận nhiều cách viết)
function mapHeaders(headerRow) {
  const idx = { label: -1, keywords: -1, name: -1, note: -1 };
  headerRow.forEach((h, i) => {
    const n = normalize(h);
    if (idx.label === -1 && (n.includes("nhom") || n === "group")) idx.label = i;
    else if (idx.keywords === -1 && (n.includes("khoa") || n.includes("keyword"))) idx.keywords = i;
    else if (idx.name === -1 && (n.includes("goi y") || n.includes("san pham") || n.includes("suggest") || n.includes("ten"))) idx.name = i;
    else if (idx.note === -1 && (n.includes("ghi chu") || n.includes("note"))) idx.note = i;
  });
  return idx;
}

// Chuyển các dòng Excel thành cấu trúc consultationList
function rowsToList(rows) {
  if (!rows.length) throw new Error("File rỗng, không có dữ liệu.");
  const header = rows[0];
  const idx = mapHeaders(header);
  if (idx.label === -1 || idx.keywords === -1 || idx.name === -1) {
    throw new Error("Không tìm thấy đủ cột. Cần có: Nhóm, Từ khoá, Tên gợi ý.");
  }

  const groups = [];
  const byLabel = {};
  let current = null;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const label = (row[idx.label] || "").toString().trim();
    const kwRaw = (row[idx.keywords] || "").toString().trim();
    const name = (row[idx.name] || "").toString().trim();
    const note = idx.note >= 0 ? (row[idx.note] || "").toString().trim() : "";

    // Bỏ dòng trống hoàn toàn / thiếu tên gợi ý
    if (!label && !kwRaw && !name) continue;
    if (!name) continue;

    const groupKey = label || (current ? current.label : "");
    if (!groupKey) continue; // không xác định được nhóm

    let group = byLabel[normalize(groupKey)];
    if (!group) {
      const keywords = kwRaw
        ? kwRaw.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean)
        : [];
      group = { id: slug(groupKey), label: groupKey, keywords, suggestions: [] };
      byLabel[normalize(groupKey)] = group;
      groups.push(group);
    } else if (kwRaw) {
      // Bổ sung thêm từ khoá nếu dòng sau ghi thêm
      kwRaw.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean).forEach((k) => {
        if (!group.keywords.includes(k)) group.keywords.push(k);
      });
    }
    current = group;
    group.suggestions.push({ name, note });
  }

  if (!groups.length) throw new Error("Không đọc được nhóm nào từ file.");
  // Nhóm nào thiếu từ khoá thì lấy tên nhóm làm từ khoá
  groups.forEach((g) => {
    if (!g.keywords.length) g.keywords = [normalize(g.label)];
  });
  return groups;
}

function esc(str) {
  const d = document.createElement("div");
  d.textContent = str == null ? "" : str;
  return d.innerHTML;
}

function renderPreview(list) {
  if (!list || !list.length) {
    preview.innerHTML = '<p class="muted">Chưa có danh sách nào.</p>';
    countEl.textContent = "";
    return;
  }
  let rows = "";
  let total = 0;
  list.forEach((g) => {
    const n = g.suggestions.length || 1;
    g.suggestions.forEach((s, i) => {
      total++;
      rows +=
        "<tr>" +
        (i === 0
          ? '<td rowspan="' + n + '"><strong>' + esc(g.label) + "</strong></td>" +
            '<td rowspan="' + n + '">' + esc(g.keywords.join(", ")) + "</td>"
          : "") +
        "<td>" + esc(s.name) + "</td>" +
        "<td>" + esc(s.note || "") + "</td>" +
        "</tr>";
    });
  });
  preview.innerHTML =
    "<table><tr><th>Nhóm</th><th>Từ khoá</th><th>Tên gợi ý</th><th>Ghi chú</th></tr>" +
    rows + "</table>";
  countEl.textContent = list.length + " nhóm · " + total + " gợi ý";
}

function loadCurrent() {
  chrome.storage.local.get(["consultationList"], (res) => {
    const list = res.consultationList && res.consultationList.length
      ? res.consultationList
      : DEFAULT_CONSULTATION_LIST;
    renderPreview(list);
  });
}

fileInput.onchange = (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const wb = XLSX.read(ev.target.result, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
      const list = rowsToList(rows);
      pendingList = list;
      renderPreview(list);
      showMsg('Đã đọc "' + file.name + '". Kiểm tra bảng xem trước rồi bấm Lưu.', true);
    } catch (err) {
      pendingList = null;
      showMsg("Lỗi đọc file: " + err.message, false);
    }
  };
  reader.onerror = () => showMsg("Không đọc được file.", false);
  reader.readAsArrayBuffer(file);
};

document.getElementById("save").onclick = () => {
  if (!pendingList) {
    showMsg("Hãy chọn file Excel trước khi lưu.", false);
    return;
  }
  chrome.storage.local.set({ consultationList: pendingList }, () => {
    showMsg("Đã lưu! Danh sách áp dụng ngay trên trang bán hàng.", true);
    renderPreview(pendingList);
  });
};

document.getElementById("reset").onclick = () => {
  chrome.storage.local.set({ consultationList: DEFAULT_CONSULTATION_LIST }, () => {
    pendingList = null;
    fileInput.value = "";
    showMsg("Đã khôi phục danh sách mặc định.", true);
    renderPreview(DEFAULT_CONSULTATION_LIST);
  });
};

loadCurrent();
