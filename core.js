(function (root) {
  "use strict";
  function validateDataset(dataset) {
    if (!dataset || dataset.schema_version !== 1 || !Array.isArray(dataset.rules)) throw new Error("Dataset Supabase không đúng schema version 1.");
    const seen = new Set();
    dataset.rules.forEach((rule, index) => {
      const sourceId = Number(rule.source_product_id);
      const suggestedId = Number(rule.suggested_product_id);
      if (!Number.isInteger(sourceId) || sourceId <= 0 || !Number.isInteger(suggestedId) || suggestedId <= 0) throw new Error(`Dataset có product ID không hợp lệ tại rule ${index + 1}.`);
      if (sourceId === suggestedId) throw new Error(`Dataset có self-suggestion tại rule ${index + 1}.`);
      if (!String(rule.source_product_name || "").trim() || !String(rule.suggested_product_name || "").trim()) throw new Error(`Dataset thiếu tên sản phẩm tại rule ${index + 1}.`);
      const pair = `${sourceId}>${suggestedId}`;
      if (seen.has(pair)) throw new Error(`Dataset trùng cặp ${pair}.`);
      seen.add(pair);
    });
    return dataset;
  }
  function parseProductLabel(text) {
    const match = String(text || "").trim().match(/^(\d+)\s*-\s*(.+)$/s);
    return match ? { productId: Number(match[1]), productName: match[2].trim() } : null;
  }
  function evaluateStock(item, productId, salesLocationId) {
    const salesStocks = (item?.stock_details || []).filter(stock => stock.location_type === "SALES" && stock.location_id === salesLocationId && Number(stock.quantity) > 0);
    const availableQuantity = salesStocks.reduce((sum, stock) => sum + Number(stock.quantity), 0);
    const validPrices = (item?.prices || []).filter(price => Number(price.final_price) > 0);
    return {
      productId: Number(productId),
      available: availableQuantity > 0 && validPrices.length > 0,
      availableQuantity,
      finalPrice: validPrices.length ? Math.min(...validPrices.map(price => Number(price.final_price))) : null,
      reason: !item ? "NOT_FOUND" : availableQuantity <= 0 ? "OUT_OF_STOCK" : !validPrices.length ? "NO_PRICE" : "AVAILABLE",
    };
  }
  root.CIRCA_CORE = Object.freeze({ validateDataset, parseProductLabel, evaluateStock });
})(globalThis);

