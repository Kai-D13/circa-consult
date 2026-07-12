create extension if not exists pgcrypto;

create type public.dataset_status as enum ('draft', 'published', 'archived');

create table public.admin_allowlist (
  email text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);

insert into public.admin_allowlist (email)
values ('hoangvudn96@gmail.com')
on conflict do nothing;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null check (role in ('admin', 'viewer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.dataset_versions (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  schema_version integer not null default 1 check (schema_version = 1),
  status public.dataset_status not null default 'draft',
  source_filename text not null,
  checksum text,
  row_count integer not null default 0 check (row_count >= 0),
  validation_summary jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_by_email text,
  created_at timestamptz not null default now(),
  published_by uuid references auth.users(id),
  published_by_email text,
  published_at timestamptz
);

create unique index dataset_versions_single_published
  on public.dataset_versions ((status))
  where status = 'published';

create table public.consultation_rules (
  id uuid primary key default gen_random_uuid(),
  dataset_version_id uuid not null references public.dataset_versions(id) on delete cascade,
  rule_code text,
  source_product_id bigint not null check (source_product_id > 0),
  source_product_name text not null check (length(trim(source_product_name)) > 0),
  suggested_product_id bigint not null check (suggested_product_id > 0),
  suggested_product_name text not null check (length(trim(suggested_product_name)) > 0),
  consultation_title text not null check (length(trim(consultation_title)) > 0),
  consultation_note text not null check (length(trim(consultation_note)) > 0),
  category_name text,
  priority integer not null default 100,
  is_active boolean not null default true,
  effective_from date,
  effective_to date,
  source text,
  note_internal text,
  created_at timestamptz not null default now(),
  check (source_product_id <> suggested_product_id),
  check (effective_to is null or effective_from is null or effective_to >= effective_from),
  unique (dataset_version_id, source_product_id, suggested_product_id)
);

create index consultation_rules_source_lookup
  on public.consultation_rules (dataset_version_id, source_product_id)
  where is_active = true;

create table public.dataset_audit_logs (
  id bigint generated always as identity primary key,
  dataset_version_id uuid references public.dataset_versions(id) on delete set null,
  action text not null check (action in ('create_draft', 'publish', 'rollback')),
  actor_id uuid references auth.users(id),
  actor_email text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_email text := lower(coalesce(new.email, ''));
  assigned_role text;
begin
  assigned_role := case
    when exists (select 1 from public.admin_allowlist a where a.email = normalized_email)
      then 'admin'
    else 'viewer'
  end;

  insert into public.profiles (user_id, email, role)
  values (new.id, normalized_email, assigned_role)
  on conflict (user_id) do update
    set email = excluded.email,
        role = excluded.role,
        updated_at = now();
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert or update of email on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.role = 'admin'
  );
$$;

alter table public.admin_allowlist enable row level security;
alter table public.profiles enable row level security;
alter table public.dataset_versions enable row level security;
alter table public.consultation_rules enable row level security;
alter table public.dataset_audit_logs enable row level security;

create policy profiles_read_self
  on public.profiles for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

create policy admin_allowlist_admin_read
  on public.admin_allowlist for select to authenticated
  using (public.is_admin());

create policy dataset_versions_admin_read
  on public.dataset_versions for select to authenticated
  using (public.is_admin());

create policy consultation_rules_admin_read
  on public.consultation_rules for select to authenticated
  using (public.is_admin());

create policy dataset_audit_admin_read
  on public.dataset_audit_logs for select to authenticated
  using (public.is_admin());

create or replace function public.create_draft_dataset(
  p_source_filename text,
  p_rules jsonb,
  p_checksum text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_dataset_id uuid;
  new_version text;
  rule jsonb;
  rule_count integer;
begin
  if not public.is_admin() then
    raise exception 'Admin permission required' using errcode = '42501';
  end if;
  if p_source_filename is null or length(trim(p_source_filename)) = 0 then
    raise exception 'Source filename is required';
  end if;
  if jsonb_typeof(p_rules) <> 'array' then
    raise exception 'Rules must be a JSON array';
  end if;
  rule_count := jsonb_array_length(p_rules);
  if rule_count = 0 then
    raise exception 'Dataset must contain at least one rule';
  end if;

  new_version := to_char(clock_timestamp() at time zone 'UTC', 'YYYY.MM.DD.HH24MISS.MS');
  insert into public.dataset_versions (
    version, source_filename, checksum, row_count, validation_summary,
    created_by, created_by_email
  ) values (
    new_version, trim(p_source_filename), nullif(trim(p_checksum), ''), rule_count,
    jsonb_build_object('errors', 0, 'warnings', 0),
    auth.uid(), auth.jwt() ->> 'email'
  ) returning id into new_dataset_id;

  for rule in select value from jsonb_array_elements(p_rules)
  loop
    insert into public.consultation_rules (
      dataset_version_id, rule_code,
      source_product_id, source_product_name,
      suggested_product_id, suggested_product_name,
      consultation_title, consultation_note, category_name,
      priority, is_active, effective_from, effective_to,
      source, note_internal
    ) values (
      new_dataset_id, nullif(trim(rule ->> 'rule_code'), ''),
      (rule ->> 'source_product_id')::bigint, trim(rule ->> 'source_product_name'),
      (rule ->> 'suggested_product_id')::bigint, trim(rule ->> 'suggested_product_name'),
      trim(rule ->> 'consultation_title'), trim(rule ->> 'consultation_note'),
      nullif(trim(rule ->> 'category_name'), ''),
      coalesce((rule ->> 'priority')::integer, 100),
      coalesce((rule ->> 'is_active')::boolean, true),
      nullif(rule ->> 'effective_from', '')::date,
      nullif(rule ->> 'effective_to', '')::date,
      nullif(trim(rule ->> 'source'), ''),
      nullif(trim(rule ->> 'note_internal'), '')
    );
  end loop;

  insert into public.dataset_audit_logs (
    dataset_version_id, action, actor_id, actor_email,
    details
  ) values (
    new_dataset_id, 'create_draft', auth.uid(), auth.jwt() ->> 'email',
    jsonb_build_object('source_filename', p_source_filename, 'row_count', rule_count)
  );
  return new_dataset_id;
end;
$$;

create or replace function public.publish_dataset(p_dataset_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_status public.dataset_status;
  action_name text;
begin
  if not public.is_admin() then
    raise exception 'Admin permission required' using errcode = '42501';
  end if;
  select status into target_status
  from public.dataset_versions where id = p_dataset_id for update;
  if target_status is null then
    raise exception 'Dataset not found';
  end if;
  if target_status = 'published' then
    return;
  end if;
  action_name := case when target_status = 'archived' then 'rollback' else 'publish' end;

  update public.dataset_versions
  set status = 'archived'
  where status = 'published';

  update public.dataset_versions
  set status = 'published',
      published_by = auth.uid(),
      published_by_email = auth.jwt() ->> 'email',
      published_at = now()
  where id = p_dataset_id;

  insert into public.dataset_audit_logs (
    dataset_version_id, action, actor_id, actor_email
  ) values (
    p_dataset_id, action_name, auth.uid(), auth.jwt() ->> 'email'
  );
end;
$$;

create or replace function public.get_latest_dataset()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'schema_version', d.schema_version,
        'dataset_version', d.version,
        'published_at', d.published_at,
        'checksum', d.checksum,
        'row_count', d.row_count,
        'rules', coalesce((
          select jsonb_agg(jsonb_build_object(
            'rule_id', r.id,
            'rule_code', r.rule_code,
            'source_product_id', r.source_product_id,
            'source_product_name', r.source_product_name,
            'suggested_product_id', r.suggested_product_id,
            'suggested_product_name', r.suggested_product_name,
            'consultation_title', r.consultation_title,
            'consultation_note', r.consultation_note,
            'category_name', r.category_name,
            'priority', r.priority,
            'effective_from', r.effective_from,
            'effective_to', r.effective_to
          ) order by r.source_product_id, r.priority, r.suggested_product_id)
          from public.consultation_rules r
          where r.dataset_version_id = d.id
            and r.is_active = true
            and (r.effective_from is null or r.effective_from <= current_date)
            and (r.effective_to is null or r.effective_to >= current_date)
        ), '[]'::jsonb)
      )
      from public.dataset_versions d
      where d.status = 'published'
      limit 1
    ),
    jsonb_build_object(
      'schema_version', 1,
      'dataset_version', null,
      'published_at', null,
      'checksum', null,
      'row_count', 0,
      'rules', '[]'::jsonb
    )
  );
$$;

revoke all on function public.create_draft_dataset(text, jsonb, text) from public;
revoke all on function public.publish_dataset(uuid) from public;
grant execute on function public.create_draft_dataset(text, jsonb, text) to authenticated;
grant execute on function public.publish_dataset(uuid) to authenticated;
grant execute on function public.get_latest_dataset() to anon, authenticated;

grant usage on schema public to anon, authenticated;

