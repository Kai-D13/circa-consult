const XLSX = require("../xlsx.full.min.js");
const path = require("node:path");
const fs = require("node:fs");

const rows = [
  {
    combo_id: 999902925,
    sub_product_id: 60559,
    message: "Tư vấn bán kèm: Combo 2 Ferrovit C Mega (hộp/30 viên nang) - hộp",
  },
  {
    combo_id: 999902925,
    sub_product_id: 200419,
    message: "Tư vấn bán kèm: Combo 2 Ferrovit C Mega (hộp/30 viên nang) - hộp",
  },
];

const headers = ["combo_id", "sub_product_id", "message"];
const workbook = XLSX.utils.book_new();
const sheet = XLSX.utils.json_to_sheet(rows, { header: headers });
sheet["!cols"] = [{ wch: 18 }, { wch: 20 }, { wch: 72 }];
sheet["!autofilter"] = { ref: `A1:C${rows.length + 1}` };
sheet["!freeze"] = { xSplit: 0, ySplit: 1, topLeftCell: "A2", activePane: "bottomLeft", state: "frozen" };

headers.forEach((_, index) => {
  const cell = sheet[XLSX.utils.encode_cell({ r: 0, c: index })];
  cell.s = {
    font: { bold: true, color: { rgb: "FFFFFF" } },
    fill: { patternType: "solid", fgColor: { rgb: "F97316" } },
    alignment: { horizontal: "center", vertical: "center" },
  };
});

XLSX.utils.book_append_sheet(workbook, sheet, "combo_rules");
const bytes = XLSX.write(workbook, {
  type: "buffer",
  bookType: "xlsx",
  compression: true,
  cellStyles: true,
});

const outputDir = path.join(__dirname, "..", "outputs", "combo-program");
fs.mkdirSync(outputDir, { recursive: true });
const output = path.join(outputDir, "circa-combo-template.xlsx");
fs.writeFileSync(output, bytes);
fs.copyFileSync(output, path.join(__dirname, "combo-template.xlsx"));
console.log(output);
