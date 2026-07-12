(function () {
  // Các bộ chọn ứng viên cho bảng sản phẩm trong đơn (thử lần lượt).
  // Nếu Circa đổi giao diện, chỉ cần thêm bộ chọn mới vào danh sách này.
  const TABLE_SELECTORS = [
    "#table-order-items-offline",
    "table[id*='order']",
    "table[id*='cart']",
    "table[class*='order']",
    "table[class*='cart']",
    "table[class*='product']",
    ".order-items table",
    ".cart-items table",
  ];
  const PANEL_ID = "circa-consult-panel";
  const DEBUG = true; // đặt false để tắt log trong Console
  let consultationList = DEFAULT_CONSULTATION_LIST;

  function log() {
    if (DEBUG) console.log("[Circa tư vấn]", ...arguments);
  }

  function loadList(cb) {
    if (chrome && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(["consultationList"], (res) => {
        consultationList = (res.consultationList && res.consultationList.length)
          ? res.consultationList
          : DEFAULT_CONSULTATION_LIST;
        cb && cb();
      });
    } else {
      cb && cb();
    }
  }

  function normalize(str) {
    return (str || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "");
  }

  // Tìm bảng sản phẩm theo danh sách bộ chọn ứng viên.
  function findCartTable() {
    for (const sel of TABLE_SELECTORS) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  // Trả về đoạn text dùng để dò từ khoá.
  // Ưu tiên đọc bảng đơn hàng; nếu không tìm thấy bảng thì dò trên toàn trang.
  function getCartText() {
    const table = findCartTable();
    if (table) {
      const txt = (table.innerText || table.textContent || "").replace(/\s+/g, " ").trim();
      return { text: txt, source: "table" };
    }
    // Fallback: dò toàn bộ nội dung hiển thị của trang.
    const body = (document.body.innerText || "").replace(/\s+/g, " ").trim();
    return { text: body, source: "page" };
  }

  function findMatches(text) {
    const n = normalize(text);
    const matches = [];
    consultationList.forEach((item) => {
      const hit = (item.keywords || []).some((kw) => {
        const k = normalize(kw).trim();
        return k && n.includes(k);
      });
      if (hit) matches.push(item);
    });
    return matches;
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function renderPanel(matches) {
    let panel = document.getElementById(PANEL_ID);
    if (!matches.length) {
      if (panel) panel.remove();
      return;
    }
    if (!panel) {
      panel = document.createElement("div");
      panel.id = PANEL_ID;
      document.body.appendChild(panel);
    }
    const groupsHtml = matches.map((m) => {
      const itemsHtml = (m.suggestions || []).map((s) =>
        "<li><strong>" + escapeHtml(s.name) + "</strong>" + (s.note ? " — " + escapeHtml(s.note) : "") + "</li>"
      ).join("");
      return "<div class=\"ccp-group\"><div class=\"ccp-group-title\">" + escapeHtml(m.label) + "</div><ul>" + itemsHtml + "</ul></div>";
    }).join("");
    panel.innerHTML =
      "<div class=\"ccp-header\"><span>💊 Gợi ý tư vấn cho khách</span>" +
      "<button class=\"ccp-close\" title=\"Đóng\">✕</button></div>" +
      "<div class=\"ccp-body\">" + groupsHtml + "</div>";
    panel.querySelector(".ccp-close").onclick = () => panel.remove();
  }

  function scanAndRender() {
    const { text, source } = getCartText();
    const matches = findMatches(text);
    log("Dò (" + source + "):", matches.length, "nhóm khớp",
        matches.map((m) => m.label));
    renderPanel(matches);
  }

  function startObserving() {
    // Quan sát toàn trang để bắt mọi thay đổi giỏ hàng, không phụ thuộc 1 bảng cụ thể.
    const observer = new MutationObserver(() => {
      clearTimeout(window.__ccpTimer);
      window.__ccpTimer = setTimeout(scanAndRender, 400);
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    log("Đã khởi động. Số nhóm tư vấn:", consultationList.length);
    scanAndRender();
  }

  loadList(startObserving);

  if (chrome && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.consultationList) {
        consultationList = changes.consultationList.newValue || DEFAULT_CONSULTATION_LIST;
        log("Danh sách cập nhật:", consultationList.length, "nhóm");
        scanAndRender();
      }
    });
  }
})();
