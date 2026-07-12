const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const context = { console };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync("core.js", "utf8"), context);
const core = context.CIRCA_CORE;

function dataset(rules) {
  return { schema_version: 1, dataset_version: "test", rules };
}
function rule(overrides = {}) {
  return {
    source_product_id: 85270,
    source_product_name: "Bibozol",
    suggested_product_id: 13720,
    suggested_product_name: "Pediakid",
    ...overrides,
  };
}

test("parse product label from real POS format", () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(core.parseProductLabel("7266 - Paracetamol 500mg hadiphar (c/500v nang)"))),
    { productId: 7266, productName: "Paracetamol 500mg hadiphar (c/500v nang)" }
  );
  assert.equal(core.parseProductLabel("Không có sản phẩm để hiển thị"), null);
});

test("accept valid exact-id dataset", () => {
  const input = dataset([rule(), rule({ suggested_product_id: 2001395, suggested_product_name: "Augmentin" })]);
  assert.equal(core.validateDataset(input), input);
});

test("reject duplicate source-suggested pair", () => {
  assert.throws(() => core.validateDataset(dataset([rule(), rule()])), /trùng cặp/);
});

test("reject self suggestion and invalid IDs", () => {
  assert.throws(() => core.validateDataset(dataset([rule({ suggested_product_id: 85270 })])), /self-suggestion/);
  assert.throws(() => core.validateDataset(dataset([rule({ source_product_id: "abc" })])), /không hợp lệ/);
});

test("product 13720 is available only at matching sales location", () => {
  const item = {
    stock_details: [{ location_type: "SALES", location_id: "sales-a", quantity: 1 }],
    prices: [{ final_price: 250000 }],
  };
  assert.deepEqual(JSON.parse(JSON.stringify(core.evaluateStock(item, 13720, "sales-a"))), {
    productId: 13720, available: true, availableQuantity: 1, finalPrice: 250000, reason: "AVAILABLE",
  });
  assert.equal(core.evaluateStock(item, 13720, "sales-b").available, false);
});

test("product 2001395 with empty stock is hidden even when price exists", () => {
  const result = core.evaluateStock({ stock_details: [], prices: [{ final_price: 300000 }] }, 2001395, "sales-a");
  assert.equal(result.available, false);
  assert.equal(result.availableQuantity, 0);
  assert.equal(result.reason, "OUT_OF_STOCK");
});

test("stock without a valid price is not sellable", () => {
  const result = core.evaluateStock({ stock_details: [{ location_type: "SALES", location_id: "sales-a", quantity: 2 }], prices: [] }, 1, "sales-a");
  assert.equal(result.available, false);
  assert.equal(result.reason, "NO_PRICE");
});
