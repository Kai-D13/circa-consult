# Deploy Admin Portal lên Vercel

## Cấu hình project

Sau khi repository được push lên GitHub:

1. Vercel Dashboard → **Add New Project**.
2. Import repository `Kai-D13/circa-consult`.
3. Chọn **Root Directory** là `admin-portal`.
4. Framework Preset: **Other**.
5. Build Command: `node build.mjs`.
6. Output Directory: `dist`.
7. Install Command: để trống hoặc mặc định.

`admin-portal/vercel.json` đã khai báo build/output và security headers.

## Environment Variables

Vercel → Project → Settings → Environment Variables:

```text
CIRCA_SUPABASE_URL=https://wbbjxaegcubhyxgemucj.supabase.co
CIRCA_SUPABASE_PUBLISHABLE_KEY=<Supabase publishable key>
```

Áp dụng cho Production, Preview và Development. Publishable key là public-client key; không cấu hình Supabase secret key trên frontend.

Sau khi thêm hoặc đổi biến môi trường, redeploy project.

## Supabase Auth URL

Sau khi có production URL Vercel:

```text
Supabase Dashboard → Authentication → URL Configuration
```

Thiết lập:

```text
Site URL: https://<production-domain>
Redirect URLs: https://<production-domain>/**
```

Nếu dùng custom domain, chuyển Site URL sang custom domain và dùng URL cụ thể cho production.

## Kiểm tra sau deploy

1. Trang login tải logo/font/style đúng.
2. Security headers có mặt.
3. Admin đăng nhập được.
4. Dataset published và history tải được.
5. Upload sample, preview và lưu draft được.
6. Không publish draft test nếu chưa được phê duyệt.
7. Logout xóa session trong tab.

