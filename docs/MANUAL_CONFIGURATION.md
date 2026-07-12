# Hướng dẫn cấu hình thủ công

## 1. Supabase production

Project hiện tại:

```text
Project name: circa-consult
Project ref: wbbjxaegcubhyxgemucj
Region: ap-northeast-2
```

Migration đã được quản lý trong `supabase/migrations`. Khi triển khai trên máy mới:

```powershell
cd C:\QR_code\circa-consult-extension
npx --yes supabase@latest login
npx --yes supabase@latest link --project-ref wbbjxaegcubhyxgemucj
npx --yes supabase@latest db push --dry-run
npx --yes supabase@latest db push
```

Không đưa Personal Access Token, database password hoặc Supabase secret key vào Git.

### Auth Admin

Admin production:

```text
hoangvudn96@gmail.com
```

Lần đầu phải xác nhận email do Supabase Auth đang bật email confirmation.

Để thêm Admin mới:

1. Thêm email lowercase vào `public.admin_allowlist` bằng migration.
2. Push migration.
3. Admin đăng ký tài khoản tại Admin Portal và xác nhận email.
4. Trigger `handle_new_user` tự tạo `profiles.role = admin`.

Không sửa role trực tiếp từ frontend.

### Auth URL Configuration

Khi Admin Portal có domain production, vào:

```text
Supabase Dashboard → Authentication → URL Configuration
```

Cấu hình:

```text
Site URL: https://<admin-domain>
Redirect URLs: https://<admin-domain>/**
```

Giai đoạn local portal dùng password login nên không phụ thuộc redirect URL.

## 2. Chạy Admin Portal local

```powershell
cd C:\QR_code\circa-consult-extension
npx --yes serve admin-portal -l 4173
```

Mở:

```text
http://127.0.0.1:4173
```

Luồng vận hành:

1. Đăng nhập Admin.
2. Chọn file XLSX.
3. Kiểm tra validation và preview.
4. Bấm **Lưu bản nháp**.
5. Kiểm tra version ở bảng lịch sử.
6. Bấm **Publish**.
7. Chỉ version `published` được extension đọc.

Rollback:

1. Chọn version `archived`.
2. Bấm **Rollback**.
3. Xác nhận dialog.
4. Extension nhận lại version đó ở lần sync kế tiếp.

## 3. Schema Excel

Tên sheet không bị ràng buộc. Nếu file có một sheet, portal tự chọn. Nếu file có nhiều sheet, Admin chọn sheet cần import; tên sheet được lưu trong History và audit log.

Cột bắt buộc:

```text
source_product_id
source_product_name
suggested_product_id
suggested_product_name
consultation_title
consultation_note
```

Cột tùy chọn:

```text
Bệnh mãn tính
category_name
priority
is_active
effective_from
effective_to
rule_code
source
note_internal
```

Quy tắc:

- ID là số nguyên dương.
- Source và suggested không được cùng ID.
- Không lặp cùng cặp source → suggested trong một dataset.
- Ngày dùng định dạng `yyyy-mm-dd`.
- `effective_to` không được trước `effective_from`.
- `priority` nhỏ hơn hiển thị trước; mặc định `100`.
- `is_active` mặc định `TRUE`.
- `gmv_circa` và `ts_available_qty` không được sử dụng.

Một source có nhiều suggestion thì tạo nhiều dòng cùng `source_product_id`.

## 4. Cài extension pilot

Build package:

```powershell
cd C:\QR_code\circa-consult-extension
npm run check
npm test
powershell -ExecutionPolicy Bypass -File scripts\package-extension.ps1
```

Chrome:

1. Mở `chrome://extensions`.
2. Bật **Developer mode**.
3. Bấm **Load unpacked**.
4. Chọn `C:\QR_code\circa-consult-extension\dist\extension`.
5. Kiểm tra version `1.2.0`.
6. Pin extension nếu cần xem nhanh trạng thái dataset.

Khi source thay đổi, build lại rồi bấm **Reload** ở `chrome://extensions`.

## 5. Đồng bộ dataset tại POS

Extension tự sync:

- Khi extension được cài/update.
- Khi Chrome khởi động.
- Mỗi 15 phút.
- Khi người dùng bấm **Đồng bộ ngay** trong trang trạng thái.

Kiểm tra thủ công:

1. Bấm icon extension.
2. Mở **Trạng thái dữ liệu**.
3. Kiểm tra `Dataset version`, số rule và thời gian sync.
4. Bấm **Đồng bộ ngay** sau khi Admin vừa publish.

Nếu Supabase lỗi, extension giữ dataset gần nhất đã validate.

## 6. Điều kiện tồn kho

Extension đọc từ POS:

```text
cookie: session_token
localStorage.pos_config.pos_id
localStorage.pos_config.auto_put_location
localStorage.entity.id
localStorage.storesClicked
```

Suggestion chỉ hiển thị khi Product API trả:

```text
location_type = SALES
location_id = auto_put_location hiện tại
quantity > 0
final_price > 0
```

Stock cache theo `pos_id + product_id` trong 60 giây. Token POS không được ghi vào Chrome storage hoặc Supabase.

## 7. Chrome Web Store

Trước khi submit:

1. Hoàn tất pilot 1 POS rồi 3 POS.
2. Chuẩn bị icon 16/32/48/128 px.
3. Chuẩn bị screenshot UI extension.
4. Tạo privacy policy mô tả dữ liệu được xử lý.
5. Khai báo mục đích permissions `storage`, `alarms` và ba host permissions.
6. Xác nhận không có remote executable code.
7. Upload ZIP từ `dist`.
8. Điền single purpose: hỗ trợ dược sĩ xem gợi ý bán kèm còn tồn tại POS.
9. Không upload source chứa credential đặc quyền.
