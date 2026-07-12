# Quản lý quyền Admin bằng Supabase SQL Editor

Thay `<EMAIL>` bằng email lowercase của user đã tồn tại trong Authentication.

## Cấp quyền Admin

```sql
begin;

insert into public.admin_allowlist (email)
values (lower('<EMAIL>'))
on conflict (email) do nothing;

insert into public.profiles (user_id, email, role)
select id, lower(email), 'admin'
from auth.users
where lower(email) = lower('<EMAIL>')
on conflict (user_id) do update
set email = excluded.email,
    role = 'admin',
    updated_at = now();

commit;
```

Xác minh:

```sql
select p.user_id, p.email, p.role
from public.profiles p
where p.email = lower('<EMAIL>');
```

Kết quả phải có đúng một dòng với `role = admin`. User cần logout/login lại portal để JWT/session và quyền được kiểm tra lại.

## Thu hồi quyền Admin

```sql
begin;

delete from public.admin_allowlist
where email = lower('<EMAIL>');

update public.profiles
set role = 'viewer', updated_at = now()
where email = lower('<EMAIL>');

commit;
```

Không chỉnh trực tiếp `auth.users` để cấp role. `admin_allowlist` quyết định user nào được trigger gán Admin, còn `profiles.role` được RLS/RPC sử dụng khi kiểm tra quyền hiện tại.

