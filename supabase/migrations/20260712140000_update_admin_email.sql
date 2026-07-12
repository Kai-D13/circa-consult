insert into public.admin_allowlist (email)
values ('hoangvud96@gmail.com')
on conflict do nothing;

delete from public.admin_allowlist
where email = 'hoangvudn96@gmail.com';

update public.profiles
set role = case when email = 'hoangvud96@gmail.com' then 'admin' else 'viewer' end,
    updated_at = now()
where email in ('hoangvud96@gmail.com', 'hoangvudn96@gmail.com');

