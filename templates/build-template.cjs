const XLSX = require("../xlsx.full.min.js");
const path = require("node:path");
const fs = require("node:fs");
const rows = [
  { source_product_id: 2001719, related_product_id: 2001719, message: "Mua 2 chai tặng 1 chai. POS tự áp dụng khi đủ điều kiện.", related_message: "" },
  { source_product_id: 1001, related_product_id: 2001, message: "Mua sản phẩm A được tặng sản phẩm B.", related_message: "Sản phẩm B là quà tặng khi mua sản phẩm A." },
];
const workbook = XLSX.utils.book_new();
const sheet = XLSX.utils.json_to_sheet(rows, { header: ["source_product_id", "related_product_id", "message", "related_message"] });
sheet["!cols"] = [{ wch: 20 }, { wch: 20 }, { wch: 62 }, { wch: 62 }];
sheet["!autofilter"] = { ref: `A1:D${rows.length + 1}` };
XLSX.utils.book_append_sheet(workbook, sheet, "promotion_rules");
const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx", compression: true });
fs.writeFileSync(path.join(__dirname, "khuyen-mai-template.xlsx"), bytes);