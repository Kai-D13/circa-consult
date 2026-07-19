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
    JSON.parse(
      JSON.stringify(
        core.parseProductLabel(
          "7266 - Paracetamol 500mg hadiphar (c/500v nang)",
        ),
      ),
    ),
    {
      productId: 7266,
      productName: "Paracetamol 500mg hadiphar (c/500v nang)",
    },
  );
  assert.equal(core.parseProductLabel("Không có sản phẩm để hiển thị"), null);
});

test("sales route guard supports POS list and SPA order URLs only", () => {
  assert.equal(core.isSalesPathname("/ban-hang"), true);
  assert.equal(core.isSalesPathname("/ban-hang/"), true);
  assert.equal(
    core.isSalesPathname("/ban-hang/3f3ff083-c685-444e-8ace-9eff0b9c4075"),
    true,
  );
  assert.equal(core.isSalesPathname("/trang-chu"), false);
  assert.equal(core.isSalesPathname("/ban-hang-khac"), false);
});

test("content script is injected before POS SPA navigation", () => {
  const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
  const matches = manifest.content_scripts[0].matches;
  assert.deepEqual(matches, [
    "https://pos.v2.circa.vn/*",
    "https://pos.dev.circa-v2.buymed.tech/*",
  ]);
});
test("suggestion card exposes product ID and uses the balanced panel size", () => {
  const contentScript = fs.readFileSync("content.js", "utf8");
  const contentStyles = fs.readFileSync("content.css", "utf8");
  assert.match(contentScript, /ccp-suggestion-id/);
  assert.match(contentScript, /match\.rule\.suggested_product_id/);
  assert.match(contentScript, /Thông tin hỗ trợ bán hàng/);
  assert.doesNotMatch(contentScript, /ccp-program-title/);
  assert.match(contentStyles, /width: min\(440px, calc\(100% - 24px\)\)/);
  assert.match(contentStyles, /max-height: min\(56vh, 500px\)/);
});
test("accept valid exact-id dataset", () => {
  const input = dataset([
    rule(),
    rule({
      suggested_product_id: 2001395,
      suggested_product_name: "Augmentin",
    }),
  ]);
  assert.equal(core.validateDataset(input), input);
});

test("reject duplicate source-suggested pair", () => {
  assert.throws(
    () => core.validateDataset(dataset([rule(), rule()])),
    /trùng cặp/,
  );
});

test("reject self suggestion and invalid IDs", () => {
  assert.throws(
    () =>
      core.validateDataset(dataset([rule({ suggested_product_id: 85270 })])),
    /self-suggestion/,
  );
  assert.throws(
    () => core.validateDataset(dataset([rule({ source_product_id: "abc" })])),
    /không hợp lệ/,
  );
});

test("product 13720 is available only at matching sales location", () => {
  const item = {
    product: {
      retail_units: [
        {
          unit_id: "box",
          unit_name: "hộp",
          convert_rate: 1,
          default_sale_unit: true,
        },
      ],
    },
    stock_details: [
      { location_type: "SALES", location_id: "sales-a", quantity: 1 },
    ],
    prices: [{ unit_id: "box", origin_price: 250000, final_price: 250000 }],
  };
  assert.deepEqual(
    JSON.parse(JSON.stringify(core.evaluateStock(item, 13720, "sales-a"))),
    {
      productId: 13720,
      productName: null,
      available: true,
      availableQuantity: 1,
      finalPrice: 250000,
      originPrice: 250000,
      unitId: "box",
      unitName: "hộp",
      convertRate: 1,
      isBaseUnit: false,
      isDefaultSaleUnit: true,
      priceUnitId: "box",
      priceUnitName: "hộp",
      resolvedSalesLocationId: "sales-a",
      reason: "AVAILABLE",
    },
  );
  assert.equal(core.evaluateStock(item, 13720, "sales-b").available, false);
});

test("product 2001395 with empty stock is marked unavailable even when price exists", () => {
  const result = core.evaluateStock(
    {
      product: {
        retail_units: [
          {
            unit_id: "box",
            unit_name: "hộp",
            convert_rate: 1,
            default_sale_unit: false,
          },
        ],
      },
      stock_details: [],
      prices: [{ unit_id: "box", final_price: 300000 }],
    },
    2001395,
    "sales-a",
  );
  assert.equal(result.available, false);
  assert.equal(result.availableQuantity, 0);
  assert.equal(result.unitName, "hộp");
  assert.equal(result.reason, "OUT_OF_STOCK");
});

test("stock without a valid price is not sellable", () => {
  const result = core.evaluateStock(
    {
      stock_details: [
        { location_type: "SALES", location_id: "sales-a", quantity: 2 },
      ],
      prices: [],
    },
    1,
    "sales-a",
  );
  assert.equal(result.available, false);
  assert.equal(result.reason, "NO_PRICE");
});

test("product 111908 uses base unit for stock and price", () => {
  const item = {
    product: {
      retail_units: [
        {
          unit_id: "tablet",
          unit_name: "viên",
          convert_rate: 1,
          is_base_unit: true,
          default_sale_unit: false,
        },
        {
          unit_id: "box",
          unit_name: "hộp",
          convert_rate: 30,
          is_base_unit: false,
          default_sale_unit: true,
        },
      ],
    },
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
  assert.equal(result.unitId, "tablet");
  assert.equal(result.unitName, "viên");
  assert.equal(result.convertRate, 1);
  assert.equal(result.isBaseUnit, true);
  assert.equal(result.finalPrice, 6300);
  assert.equal(result.priceUnitId, "tablet");
  assert.equal(result.priceUnitName, "viên");
  assert.equal(result.isDefaultSaleUnit, false);
});

test("product 2001719 reports stock and price in its base unit", () => {
  const item = {
    product: {
      retail_units: [
        {
          unit_id: "carton",
          unit_name: "thùng",
          convert_rate: 24,
          is_base_unit: false,
          buymed_base_unit: false,
        },
        {
          unit_id: "bottle",
          unit_name: "chai",
          convert_rate: 1,
          is_base_unit: true,
          buymed_base_unit: true,
        },
      ],
    },
    stock_details: [
      { location_type: "SALES", location_id: "sales-a", quantity: 497 },
      { location_type: "SALES", location_id: "sales-a", quantity: 130 },
      { location_type: "SALES", location_id: "sales-a", quantity: 55 },
    ],
    prices: [
      { unit_id: "carton", final_price: 58700 },
      { unit_id: "bottle", final_price: 4000 },
    ],
  };
  const result = core.evaluateStock(item, 2001719, "sales-a");
  assert.equal(result.available, true);
  assert.equal(result.availableQuantity, 682);
  assert.equal(result.unitId, "bottle");
  assert.equal(result.unitName, "chai");
  assert.equal(result.convertRate, 1);
  assert.equal(result.isBaseUnit, true);
  assert.equal(result.finalPrice, 4000);
  assert.equal(result.priceUnitId, "bottle");
  assert.equal(result.priceUnitName, "chai");
});

test("single priced unit is used when API does not flag a default sale unit", () => {
  const item = {
    product: {
      retail_units: [
        {
          unit_id: "box",
          unit_name: "hộp",
          convert_rate: 1,
          default_sale_unit: false,
        },
      ],
    },
    stock_details: [
      { location_type: "SALES", location_id: "sales-a", quantity: 2 },
    ],
    prices: [{ unit_id: "box", final_price: 300000 }],
  };
  const result = core.evaluateStock(item, 2001395, "sales-a");
  assert.equal(result.available, true);
  assert.equal(result.unitName, "hộp");
  assert.equal(result.finalPrice, 300000);
  assert.equal(result.isDefaultSaleUnit, false);
});

test("base unit price is used when the default sale unit has no price", () => {
  const item = {
    product: {
      retail_units: [
        {
          unit_id: "tablet",
          unit_name: "viên",
          convert_rate: 1,
          is_base_unit: true,
          default_sale_unit: false,
        },
        {
          unit_id: "box",
          unit_name: "hộp",
          convert_rate: 30,
          default_sale_unit: true,
        },
      ],
    },
    stock_details: [
      { location_type: "SALES", location_id: "sales-a", quantity: 60 },
    ],
    prices: [{ unit_id: "tablet", final_price: 6300 }],
  };
  const result = core.evaluateStock(item, 111908, "sales-a");
  assert.equal(result.available, true);
  assert.equal(result.unitName, "viên");
  assert.equal(result.isBaseUnit, true);
  assert.equal(result.finalPrice, 6300);
  assert.equal(result.priceUnitName, "viên");
  assert.equal(result.reason, "AVAILABLE");
});

test("manual-location PROD POS aggregates all positive SALES stock", () => {
  const item = {
    product: {
      retail_units: [
        {
          unit_id: "tablet",
          unit_name: "vien",
          convert_rate: 1,
          is_base_unit: true,
          default_sale_unit: false,
        },
        {
          unit_id: "box",
          unit_name: "hop",
          convert_rate: 180,
          default_sale_unit: false,
        },
        {
          unit_id: "blister",
          unit_name: "vi",
          convert_rate: 10,
          default_sale_unit: true,
        },
      ],
    },
    stock_details: [
      {
        location_type: "SALES",
        location_id: "cutting-room",
        quantity: 80,
        is_used_location: true,
      },
      {
        location_type: "SALES",
        location_id: "1I",
        quantity: 25,
        is_used_location: false,
      },
      {
        location_type: "SALES",
        location_id: "negative",
        quantity: -10,
        is_used_location: false,
      },
      { location_type: "WAREHOUSE", location_id: "warehouse", quantity: 999 },
    ],
    prices: [
      { unit_id: "tablet", final_price: 1600 },
      { unit_id: "box", final_price: 288000 },
      { unit_id: "blister", final_price: 16000 },
    ],
  };
  const result = core.evaluateStock(item, 4721, "", {
    aggregateAllSalesLocations: true,
  });
  assert.equal(result.available, true);
  assert.equal(result.availableQuantity, 105);
  assert.equal(result.resolvedSalesLocationId, null);
  assert.equal(result.unitName, "vien");
  assert.equal(result.isBaseUnit, true);
  assert.equal(result.finalPrice, 1600);
  assert.equal(result.priceUnitName, "vien");
  assert.equal(result.reason, "AVAILABLE");
});
test("DEV fallback uses the only SALES location and price from its stock seller", () => {
  const item = {
    product: {
      retail_units: [
        {
          unit_id: "bag",
          unit_name: "bịch",
          convert_rate: 5,
          default_sale_unit: false,
        },
        {
          unit_id: "piece",
          unit_name: "miếng",
          convert_rate: 1,
          default_sale_unit: false,
        },
        {
          unit_id: "tablet",
          unit_name: "viên",
          convert_rate: 1,
          is_base_unit: true,
          default_sale_unit: false,
        },
      ],
    },
    stock_details: [
      {
        location_type: "SALES",
        location_id: "dev-sales",
        quantity: 499,
        seller_code: "CIRCATEST",
        sku_code: "CIRCATEST.TEST",
      },
    ],
    prices: [
      {
        seller_code: "OTHER",
        sku_code: "OTHER.TEST",
        unit_id: "bag",
        final_price: 1,
      },
      {
        seller_code: "CIRCATEST",
        sku_code: "CIRCATEST.TEST",
        unit_id: "bag",
        origin_price: 222300,
        final_price: 222300,
      },
      {
        seller_code: "CIRCATEST",
        sku_code: "CIRCATEST.TEST",
        unit_id: "piece",
        origin_price: 15500,
        final_price: 15500,
      },
    ],
  };
  const result = core.evaluateStock(item, 1107, "", {
    allowSingleSalesLocationFallback: true,
    matchPriceToStock: true,
  });
  assert.equal(result.available, true);
  assert.equal(result.availableQuantity, 499);
  assert.equal(result.resolvedSalesLocationId, "dev-sales");
  assert.equal(result.unitName, "viên");
  assert.equal(result.isBaseUnit, true);
  assert.equal(result.finalPrice, 222300);
  assert.equal(result.priceUnitName, "bịch");
});

test("DEV fallback refuses to guess when more than one SALES location is returned", () => {
  const item = {
    product: {
      retail_units: [{ unit_id: "box", unit_name: "hộp", convert_rate: 1 }],
    },
    stock_details: [
      {
        location_type: "SALES",
        location_id: "dev-a",
        quantity: 1,
        seller_code: "A",
      },
      {
        location_type: "SALES",
        location_id: "dev-b",
        quantity: 1,
        seller_code: "B",
      },
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

test("accept a multi-program bundle and calculate lifecycle", () => {
  const bundle = {
    schema_version: 2,
    bundle_version: "v2",
    programs: [
      {
        program_id: "consult",
        program_type: "consultation",
        dataset_version: "1",
        rules: [rule()],
      },
      {
        program_id: "promo",
        program_type: "promotion",
        dataset_version: "1",
        rules: [
          {
            source_product_id: 2001719,
            related_product_id: 2001719,
            message: "Mua 2 tặng 1",
          },
        ],
      },
    ],
  };
  assert.equal(core.validateProgramBundle(bundle), bundle);
  const now = Date.parse("2026-07-17T00:00:00Z");
  assert.equal(
    core.programLifecycle(
      {
        effective_from: "2026-07-16T00:00:00Z",
        effective_to: "2026-07-18T00:00:00Z",
      },
      now,
    ),
    "active",
  );
  assert.equal(
    core.programLifecycle({ effective_from: "2026-07-18T00:00:00Z" }, now),
    "scheduled",
  );
  assert.equal(
    core.programLifecycle({ effective_to: "2026-07-16T00:00:00Z" }, now),
    "expired",
  );
});

test("reject invalid promotion rules", () => {
  assert.throws(
    () =>
      core.validateProgramBundle({
        schema_version: 2,
        programs: [
          {
            program_id: "promo",
            program_type: "promotion",
            dataset_version: "1",
            rules: [{ source_product_id: 1, message: "" }],
          },
        ],
      }),
    /thiếu message/,
  );
});

test("old version deletion is available but published versions are protected", () => {
  const portal = fs.readFileSync("admin-portal/app.js", "utf8");
  const migration = fs.readFileSync(
    "supabase/migrations/20260717113000_delete_old_dataset_versions.sql",
    "utf8",
  );
  assert.match(portal, /delete_dataset_version/);
  assert.match(portal, /data-delete-version/);
  assert.match(migration, /target_status = 'published'/);
  assert.match(migration, /Published version must be stopped before deletion/);
});

test("accept and group combo rules by combo ID", () => {
  const program = {
    program_id: "combo-program",
    program_type: "combo",
    dataset_version: "1",
    rules: [
      {
        combo_id: 999902925,
        source_product_id: 60559,
        message: "Combo Ferrovit",
      },
      {
        combo_id: 999902925,
        source_product_id: 200419,
        message: "Combo Ferrovit",
      },
      {
        combo_id: 999903304,
        source_product_id: 57863,
        message: "Combo Vitamin",
      },
    ],
  };
  const bundle = { schema_version: 2, programs: [program] };
  assert.equal(core.validateProgramBundle(bundle), bundle);
  assert.deepEqual(JSON.parse(JSON.stringify(core.comboGroups(program))), [
    {
      comboId: 999902925,
      message: "Combo Ferrovit",
      members: [60559, 200419],
    },
    {
      comboId: 999903304,
      message: "Combo Vitamin",
      members: [57863],
    },
  ]);
});

test("reject combo rules without combo ID or message", () => {
  assert.throws(
    () =>
      core.validateProgramBundle({
        schema_version: 2,
        programs: [
          {
            program_id: "combo",
            program_type: "combo",
            dataset_version: "1",
            rules: [{ source_product_id: 60559, message: "Combo" }],
          },
        ],
      }),
    /combo_id/,
  );
  assert.throws(
    () =>
      core.validateProgramBundle({
        schema_version: 2,
        programs: [
          {
            program_id: "combo",
            program_type: "combo",
            dataset_version: "1",
            rules: [{ combo_id: 1, source_product_id: 60559, message: "" }],
          },
        ],
      }),
    /message/,
  );
});

test("combo implementation keeps the file schema minimal and stock informational", () => {
  const portal = fs.readFileSync("admin-portal/app.js", "utf8");
  const content = fs.readFileSync("content.js", "utf8");
  const migration = fs.readFileSync(
    "supabase/migrations/20260719101000_add_combo_programs.sql",
    "utf8",
  );
  assert.match(portal, /combo_id.*sub_product_id.*message/s);
  assert.match(portal, /create_combo_draft/);
  assert.match(content, /ccp-combo-member/);
  assert.match(content, /Đã chọn/);
  assert.match(content, /Chưa kiểm tra/);
  assert.match(migration, /Asia\/Ho_Chi_Minh/);
  assert.match(migration, /interval '1 month'/);
});
