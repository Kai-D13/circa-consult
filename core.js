(function (root) {
  "use strict";
  const PROGRAM_TYPES = new Set([
    "consultation",
    "promotion",
    "marketing",
    "near_expiry",
    "combo",
  ]);
  function validateDataset(dataset) {
    if (
      !dataset ||
      dataset.schema_version !== 1 ||
      !Array.isArray(dataset.rules)
    )
      throw new Error("Dataset Supabase không đúng schema version 1.");
    const seen = new Set();
    dataset.rules.forEach((rule, index) => {
      const sourceId = Number(rule.source_product_id);
      const suggestedId = Number(rule.suggested_product_id);
      if (
        !Number.isInteger(sourceId) ||
        sourceId <= 0 ||
        !Number.isInteger(suggestedId) ||
        suggestedId <= 0
      )
        throw new Error(
          `Dataset có product ID không hợp lệ tại rule ${index + 1}.`,
        );
      if (sourceId === suggestedId)
        throw new Error(`Dataset có self-suggestion tại rule ${index + 1}.`);
      if (
        !String(rule.source_product_name || "").trim() ||
        !String(rule.suggested_product_name || "").trim()
      )
        throw new Error(`Dataset thiếu tên sản phẩm tại rule ${index + 1}.`);
      const pair = `${sourceId}>${suggestedId}`;
      if (seen.has(pair)) throw new Error(`Dataset trùng cặp ${pair}.`);
      seen.add(pair);
    });
    return dataset;
  }
  function validateProgramBundle(bundle) {
    if (
      !bundle ||
      bundle.schema_version !== 2 ||
      !Array.isArray(bundle.programs)
    )
      throw new Error("Dữ liệu chương trình không đúng schema version 2.");
    const ids = new Set();
    bundle.programs.forEach((program, programIndex) => {
      if (!program.program_id || ids.has(program.program_id))
        throw new Error(
          `Chương trình ${programIndex + 1} thiếu hoặc trùng ID.`,
        );
      ids.add(program.program_id);
      if (
        !PROGRAM_TYPES.has(program.program_type) ||
        !program.dataset_version ||
        !Array.isArray(program.rules)
      )
        throw new Error(`Chương trình ${programIndex + 1} không hợp lệ.`);
      program.rules.forEach((rule, ruleIndex) => {
        const sourceId = Number(rule.source_product_id);
        if (!Number.isInteger(sourceId) || sourceId <= 0)
          throw new Error(
            `Rule ${ruleIndex + 1} của chương trình ${programIndex + 1} có source_product_id không hợp lệ.`,
          );
        if (program.program_type === "consultation") {
          const suggestedId = Number(rule.suggested_product_id);
          if (!Number.isInteger(suggestedId) || suggestedId <= 0)
            throw new Error(
              `Rule tư vấn ${ruleIndex + 1} thiếu suggested_product_id.`,
            );
        } else if (program.program_type === "combo") {
          const comboId = Number(rule.combo_id);
          if (!Number.isInteger(comboId) || comboId <= 0)
            throw new Error(
              "Rule combo " + (ruleIndex + 1) + " thiếu combo_id.",
            );
          if (!String(rule.message || "").trim())
            throw new Error(
              "Rule combo " + (ruleIndex + 1) + " thiếu message.",
            );
        } else {
          const related = rule.related_product_id;
          if (
            related != null &&
            (!Number.isInteger(Number(related)) || Number(related) <= 0)
          )
            throw new Error(
              `Rule chương trình ${ruleIndex + 1} có related_product_id không hợp lệ.`,
            );
          if (!String(rule.message || "").trim())
            throw new Error(
              `Rule chương trình ${ruleIndex + 1} thiếu message.`,
            );
        }
      });
    });
    return bundle;
  }
  function programLifecycle(program, now = Date.now()) {
    const from = program?.effective_from
      ? Date.parse(program.effective_from)
      : null;
    const to = program?.effective_to ? Date.parse(program.effective_to) : null;
    if (Number.isFinite(from) && now < from) return "scheduled";
    if (Number.isFinite(to) && now > to) return "expired";
    return "active";
  }
  function comboGroups(program) {
    const groups = new Map();
    (program?.rules || []).forEach((rule) => {
      const comboId = Number(rule.combo_id);
      if (!groups.has(comboId))
        groups.set(comboId, {
          comboId,
          message: String(rule.message || "").trim(),
          members: [],
        });
      groups.get(comboId).members.push(Number(rule.source_product_id));
    });
    return [...groups.values()].map((group) => ({
      ...group,
      members: [...new Set(group.members)],
    }));
  }
  function isSalesPathname(pathname) {
    const value = String(pathname || "");
    return value === "/ban-hang" || value.startsWith("/ban-hang/");
  }
  function parseProductLabel(text) {
    const match = String(text || "")
      .trim()
      .match(/^(\d+)\s*-\s*(.+)$/s);
    return match
      ? { productId: Number(match[1]), productName: match[2].trim() }
      : null;
  }
  function selectSaleOption(item, priceScope = null) {
    const units = Array.isArray(item?.product?.retail_units)
      ? item.product.retail_units
      : [];
    const sellerCodes = new Set(priceScope?.sellerCodes || []);
    const skuCodes = new Set(priceScope?.skuCodes || []);
    const shouldScopePrices = sellerCodes.size > 0 || skuCodes.size > 0;
    const validPrices = (item?.prices || [])
      .filter((p) => Number(p.final_price) > 0)
      .filter(
        (p) =>
          !shouldScopePrices ||
          sellerCodes.has(p.seller_code) ||
          skuCodes.has(p.sku_code),
      );
    const baseUnit =
      units.find((u) => u.is_base_unit === true) ||
      units.find((u) => u.buymed_base_unit === true) ||
      null;
    const defaultUnit = units.find((u) => u.default_sale_unit === true) || null;
    const ordered = [baseUnit, defaultUnit, ...units]
      .filter(Boolean)
      .filter(
        (u, i, list) => list.findIndex((c) => c.unit_id === u.unit_id) === i,
      );
    const unit =
      ordered.find((u) => validPrices.some((p) => p.unit_id === u.unit_id)) ||
      baseUnit ||
      defaultUnit ||
      units[0] ||
      null;
    const prices = unit
      ? validPrices.filter((p) => p.unit_id === unit.unit_id)
      : validPrices;
    const price =
      prices.sort((a, b) => Number(a.final_price) - Number(b.final_price))[0] ||
      null;
    return {
      unitId: unit?.unit_id || price?.unit_id || null,
      unitName: unit?.unit_name || null,
      convertRate: Number(unit?.convert_rate || 0) || null,
      isBaseUnit: Boolean(unit?.is_base_unit || unit?.buymed_base_unit),
      isDefaultSaleUnit: Boolean(unit?.default_sale_unit),
      finalPrice: price ? Number(price.final_price) : null,
      originPrice:
        price && Number(price.origin_price) > 0
          ? Number(price.origin_price)
          : null,
    };
  }
  function evaluateStock(item, productId, salesLocationId, options = {}) {
    const positive = (item?.stock_details || []).filter(
      (s) => s.location_type === "SALES" && Number(s.quantity) > 0,
    );
    const locationIds = [
      ...new Set(positive.map((s) => s.location_id).filter(Boolean)),
    ];
    const aggregate =
      !salesLocationId && options.aggregateAllSalesLocations === true;
    const single =
      !salesLocationId &&
      options.allowSingleSalesLocationFallback === true &&
      locationIds.length === 1;
    const resolved = salesLocationId || (single ? locationIds[0] : null);
    const stocks = aggregate
      ? positive
      : resolved
        ? positive.filter((s) => s.location_id === resolved)
        : [];
    const availableQuantity = stocks.reduce(
      (sum, s) => sum + Number(s.quantity),
      0,
    );
    const scope =
      options.matchPriceToStock === true
        ? {
            sellerCodes: stocks.map((s) => s.seller_code).filter(Boolean),
            skuCodes: stocks.map((s) => s.sku_code).filter(Boolean),
          }
        : null;
    const sale = selectSaleOption(item, scope);
    const units = Array.isArray(item?.product?.retail_units)
      ? item.product.retail_units
      : [];
    const base =
      units.find((u) => u.is_base_unit === true) ||
      units.find((u) => u.buymed_base_unit === true) ||
      null;
    const stockUnit = base || {
      unit_id: sale.unitId,
      unit_name: sale.unitName,
      convert_rate: sale.convertRate,
      is_base_unit: sale.isBaseUnit,
    };
    const ambiguous =
      !aggregate &&
      !salesLocationId &&
      options.allowSingleSalesLocationFallback === true &&
      locationIds.length > 1;
    return {
      productId: Number(productId),
      productName: item?.product?.product_name || null,
      available: availableQuantity > 0 && Number(sale.finalPrice) > 0,
      availableQuantity,
      finalPrice: sale.finalPrice,
      originPrice: sale.originPrice,
      unitId: stockUnit?.unit_id || null,
      unitName: stockUnit?.unit_name || null,
      convertRate: Number(stockUnit?.convert_rate || 0) || null,
      isBaseUnit: Boolean(
        stockUnit?.is_base_unit || stockUnit?.buymed_base_unit,
      ),
      isDefaultSaleUnit: sale.isDefaultSaleUnit,
      priceUnitId: sale.unitId,
      priceUnitName: sale.unitName,
      resolvedSalesLocationId: resolved,
      reason: !item
        ? "NOT_FOUND"
        : ambiguous
          ? "AMBIGUOUS_LOCATION"
          : availableQuantity <= 0
            ? "OUT_OF_STOCK"
            : !sale.finalPrice
              ? "NO_PRICE"
              : "AVAILABLE",
    };
  }
  root.CIRCA_CORE = Object.freeze({
    validateDataset,
    validateProgramBundle,
    programLifecycle,
    comboGroups,
    isSalesPathname,
    parseProductLabel,
    selectSaleOption,
    evaluateStock,
  });
})(globalThis);
