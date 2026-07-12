# Circa POS – Gợi ý tư vấn bán kèm

Chrome Extension Manifest V3 đồng bộ master tư vấn từ Supabase, exact-match sản phẩm trong giỏ theo `product_id`, kiểm tra tồn kho theo sales location của POS và chỉ hiển thị sản phẩm bán được.

## Cấu trúc

- Extension nằm ở thư mục gốc (`manifest.json`, `background.js`, `content.js`).
- `admin-portal/`: portal tĩnh để import XLSX, preview, tạo draft, publish và rollback.
- `supabase/migrations/`: schema, RLS và RPC versioned dataset.
- `tests/`: unit test cho parser, dataset validation và stock filtering.

## Dataset Excel

Tên sheet không bị ràng buộc. File có một sheet sẽ được chọn tự động; file có nhiều sheet sẽ hiển thị lựa chọn cho Admin. Các cột bắt buộc trong sheet được chọn:

```text
source_product_id
source_product_name
suggested_product_id
suggested_product_name
consultation_title
consultation_note
```

Các cột tùy chọn: `Bệnh mãn tính`/`category_name`, `priority`, `is_active`, `effective_from`, `effective_to`, `rule_code`, `source`, `note_internal`.

## Kiểm tra

```powershell
npm run check
npm test
```

## Đóng gói extension pilot

```powershell
powershell -ExecutionPolicy Bypass -File scripts\package-extension.ps1
```

Load unpacked từ `dist\extension`, hoặc dùng ZIP v1.2.1 trong `dist` để bàn giao.

## Admin Portal local

Serve thư mục `admin-portal` bằng một static HTTP server. Không mở trực tiếp bằng `file://` vì Auth/fetch cần origin HTTP.

```powershell
npx --yes serve admin-portal -l 4173
```

Admin đăng nhập bằng Supabase Auth. Chỉ email trong `admin_allowlist` được gọi RPC tạo draft/publish.

## Quy tắc tồn kho

Suggestion chỉ hiển thị khi `/v2/product` trả ít nhất một stock row thỏa:

```text
location_type = SALES
location_id = pos_config.auto_put_location
quantity > 0
final_price > 0
```

Token POS được đọc từ cookie `session_token`, gửi thẳng tới Circa API qua service worker và không lưu vào `chrome.storage` hay Supabase.
