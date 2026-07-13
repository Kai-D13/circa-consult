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
    product: { retail_units: [{ unit_id: "box", unit_name: "hộp", convert_rate: 1, default_sale_unit: true }] },
    stock_details: [{ location_type: "SALES", location_id: "sales-a", quantity: 1 }],
    prices: [{ unit_id: "box", origin_price: 250000, final_price: 250000 }],
  };
  assert.deepEqual(JSON.parse(JSON.stringify(core.evaluateStock(item, 13720, "sales-a"))), {
    productId: 13720, available: true, availableQuantity: 1, finalPrice: 250000, originPrice: 250000,
    unitId: "box", unitName: "hộp", convertRate: 1, isDefaultSaleUnit: true,
    resolvedSalesLocationId: "sales-a", reason: "AVAILABLE",
  });
  assert.equal(core.evaluateStock(item, 13720, "sales-b").available, false);
});

test("product 2001395 with empty stock is marked unavailable even when price exists", () => {
  const result = core.evaluateStock({
    product: { retail_units: [{ unit_id: "box", unit_name: "hộp", convert_rate: 1, default_sale_unit: false }] },
    stock_details: [], prices: [{ unit_id: "box", final_price: 300000 }],
  }, 2001395, "sales-a");
  assert.equal(result.available, false);
  assert.equal(result.availableQuantity, 0);
  assert.equal(result.unitName, "hộp");
  assert.equal(result.reason, "OUT_OF_STOCK");
});

test("stock without a valid price is not sellable", () => {
  const result = core.evaluateStock({ stock_details: [{ location_type: "SALES", location_id: "sales-a", quantity: 2 }], prices: [] }, 1, "sales-a");
  assert.equal(result.available, false);
  assert.equal(result.reason, "NO_PRICE");
});

test("product 111908 uses default sale unit price and keeps stock in base units", () => {
  const item = {
    product: { retail_units: [
      { unit_id: "tablet", unit_name: "viên", convert_rate: 1, is_base_unit: true, default_sale_unit: false },
      { unit_id: "box", unit_name: "hộp", convert_rate: 30, is_base_unit: false, default_sale_unit: true },
    ] },
    stock_details: [
      { location_type: "SALES", location_id: "sales-a", quantity: 30 },
      { location_type: "SALES", location_id: "sales-a", quantity: 30 },
    ],
    prices: [
      { unit_id: "tablet", origin_price: 7000, final_price: 6300 },
      { unit_id: "box", origin_price: 210000, final_price: 189000 },
    ],
  };
  const result = core.evaluateStock(item, 111908, "sales-a");
  assert.equal(result.available, true);
  assert.equal(result.availableQuantity, 60);
  assert.equal(result.unitId, "box");
  assert.equal(result.unitName, "hộp");
  assert.equal(result.convertRate, 30);
  assert.equal(result.finalPrice, 189000);
  assert.equal(result.isDefaultSaleUnit, true);
});

test("single priced unit is used when API does not flag a default sale unit", () => {
  const item = {
    product: { retail_units: [{ unit_id: "box", unit_name: "hộp", convert_rate: 1, default_sale_unit: false }] },
    stock_details: [{ location_type: "SALES", location_id: "sales-a", quantity: 2 }],
    prices: [{ unit_id: "box", final_price: 300000 }],
  };
  const result = core.evaluateStock(item, 2001395, "sales-a");
  assert.equal(result.available, true);
  assert.equal(result.unitName, "hộp");
  assert.equal(result.finalPrice, 300000);
  assert.equal(result.isDefaultSaleUnit, false);
});

test("default sale unit is not replaced by another unit when its price is missing", () => {
  const item = {
    product: { retail_units: [
      { unit_id: "tablet", unit_name: "viên", convert_rate: 1, default_sale_unit: false },
      { unit_id: "box", unit_name: "hộp", convert_rate: 30, default_sale_unit: true },
    ] },
    stock_details: [{ location_type: "SALES", location_id: "sales-a", quantity: 60 }],
    prices: [{ unit_id: "tablet", final_price: 6300 }],
  };
  const result = core.evaluateStock(item, 111908, "sales-a");
  assert.equal(result.available, false);
  assert.equal(result.unitName, "hộp");
  assert.equal(result.finalPrice, null);
  assert.equal(result.reason, "NO_PRICE");
});

test("DEV fallback uses the only SALES location and price from its stock seller", () => {
  const item = {
    product: { retail_units: [
      { unit_id: "bag", unit_name: "bịch", convert_rate: 5, default_sale_unit: false },
      { unit_id: "piece", unit_name: "miếng", convert_rate: 1, default_sale_unit: false },
      { unit_id: "tablet", unit_name: "viên", convert_rate: 1, is_base_unit: true, default_sale_unit: false },
    ] },
    stock_details: [
      { location_type: "SALES", location_id: "dev-sales", quantity: 499, seller_code: "CIRCATEST", sku_code: "CIRCATEST.TEST" },
    ],
    prices: [
      { seller_code: "OTHER", sku_code: "OTHER.TEST", unit_id: "bag", final_price: 1 },
      { seller_code: "CIRCATEST", sku_code: "CIRCATEST.TEST", unit_id: "bag", origin_price: 222300, final_price: 222300 },
      { seller_code: "CIRCATEST", sku_code: "CIRCATEST.TEST", unit_id: "piece", origin_price: 15500, final_price: 15500 },
    ],
  };
  const result = core.evaluateStock(item, 1107, "", {
    allowSingleSalesLocationFallback: true,
    matchPriceToStock: true,
  });
  assert.equal(result.available, true);
  assert.equal(result.availableQuantity, 499);
  assert.equal(result.resolvedSalesLocationId, "dev-sales");
  assert.equal(result.unitName, "bịch");
  assert.equal(result.finalPrice, 222300);
});

test("DEV fallback refuses to guess when more than one SALES location is returned", () => {
  const item = {
    product: { retail_units: [{ unit_id: "box", unit_name: "hộp", convert_rate: 1 }] },
    stock_details: [
      { location_type: "SALES", location_id: "dev-a", quantity: 1, seller_code: "A" },
      { location_type: "SALES", location_id: "dev-b", quantity: 1, seller_code: "B" },
    ],
    prices: [{ seller_code: "A", unit_id: "box", final_price: 1000 }],
  };
  const result = core.evaluateStock(item, 1107, "", {
    allowSingleSalesLocationFallback: true,
    matchPriceToStock: true,
  });
  assert.equal(result.available, false);
  assert.equal(result.availableQuantity, 0);
  assert.equal(result.resolvedSalesLocationId, null);
  assert.equal(result.reason, "AMBIGUOUS_LOCATION");
});
