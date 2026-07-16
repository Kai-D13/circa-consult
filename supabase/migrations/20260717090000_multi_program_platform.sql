-- Multi-program platform. Keeps get_latest_dataset() for extension <= 1.3.x.
do $$ begin
  create type public.program_type as enum ('consultation', 'promotion', 'marketing', 'near_expiry');
exception when duplicate_object then null; end $$;

create table if not exists public.programs (
  id uuid primary key default gen_random_uuid(),
  program_type public.program_type not null,
  created_by uuid references auth.users(id),
  created_by_email text,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid references auth.users(id),
  archived_by_email text
);

alter table public.dataset_versions add column if not exists program_id uuid references public.programs(id);
alter table public.dataset_versions add column if not exists program_name text;
alter table public.dataset_versions add column if not exists display_title text;
alter table public.dataset_versions add column if not exists effective_from timestamptz;
alter table public.dataset_versions add column if not exists effective_to timestamptz;

insert into public.programs (id, program_type, created_by_email)
values ('00000000-0000-4000-8000-000000000001', 'consultation', 'system-migration')
on conflict (id) do nothing;

update public.dataset_versions
set program_id = '00000000-0000-4000-8000-000000000001',
    program_name = coalesce(program_name, 'Tư vấn bán kèm'),
    display_title = coalesce(display_title, 'Gợi ý tư vấn bán kèm')
where program_id is null;

alter table public.dataset_versions alter column program_id set not null;
alter table public.dataset_versions alter column program_name set not null;
alter table public.dataset_versions alter column display_title set not null;
alter table public.dataset_versions drop constraint if exists dataset_versions_effective_range;
alter table public.dataset_versions add constraint dataset_versions_effective_range
  check (effective_to is null or effective_from is null or effective_to >= effective_from);

drop index if exists public.dataset_versions_single_published;
create unique index if not exists dataset_versions_one_published_per_program
  on public.dataset_versions (program_id) where status = 'published';

create table if not exists public.program_rules (
  id uuid primary key default gen_random_uuid(),
  dataset_version_id uuid not null references public.dataset_versions(id) on delete cascade,
  source_product_id bigint not null check (source_product_id > 0),
  related_product_id bigint check (related_product_id > 0),
  message text not null check (length(trim(message)) > 0),
  related_message text,
  created_at timestamptz not null default now(),
  check (related_message is null or related_product_id is not null)
);
create unique index if not exists program_rules_unique_mapping
  on public.program_rules (dataset_version_id, source_product_id, coalesce(related_product_id, 0));
create index if not exists program_rules_source_lookup on public.program_rules(dataset_version_id, source_product_id);
create index if not exists program_rules_related_lookup on public.program_rules(dataset_version_id, related_product_id)
  where related_message is not null;

alter table public.programs enable row level security;
alter table public.program_rules enable row level security;
drop policy if exists programs_admin_read on public.programs;
create policy programs_admin_read on public.programs for select to authenticated using (public.is_admin());
drop policy if exists program_rules_admin_read on public.program_rules;
create policy program_rules_admin_read on public.program_rules for select to authenticated using (public.is_admin());

alter table public.dataset_audit_logs drop constraint if exists dataset_audit_logs_action_check;
alter table public.dataset_audit_logs add constraint dataset_audit_logs_action_check
  check (action in ('create_draft', 'publish', 'rollback', 'stop', 'delete_draft'));

create or replace function public.create_program_draft(
  p_program_id uuid,
  p_program_type text,
  p_program_name text,
  p_display_title text,
  p_effective_from timestamptz,
  p_effective_to timestamptz,
  p_source_filename text,
  p_source_sheet_name text,
  p_rules jsonb,
  p_checksum text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  target_program_id uuid := p_program_id;
  target_type public.program_type;
  new_dataset_id uuid;
  new_version text;
  rule jsonb;
  rule_count integer;
begin
  if not public.is_admin() then raise exception 'Admin permission required' using errcode = '42501'; end if;
  begin target_type := p_program_type::public.program_type;
  exception when invalid_text_representation then raise exception 'Unsupported program type: %', p_program_type; end;
  if target_type = 'consultation' then raise exception 'Use consultation dataset importer for consultation type'; end if;
  if length(trim(coalesce(p_program_name, ''))) = 0 then raise exception 'Program name is required'; end if;
  if length(trim(coalesce(p_display_title, ''))) = 0 then raise exception 'Display title is required'; end if;
  if p_effective_from is null or p_effective_to is null or p_effective_to < p_effective_from then
    raise exception 'Valid effective_from and effective_to are required';
  end if;
  if length(trim(coalesce(p_source_filename, ''))) = 0 or length(trim(coalesce(p_source_sheet_name, ''))) = 0 then
    raise exception 'Source filename and sheet name are required';
  end if;
  if jsonb_typeof(p_rules) <> 'array' or jsonb_array_length(p_rules) = 0 then raise exception 'Rules must be a non-empty JSON array'; end if;

  if target_program_id is null then
    insert into public.programs(program_type, created_by, created_by_email)
    values(target_type, auth.uid(), auth.jwt() ->> 'email') returning id into target_program_id;
  else
    if not exists(select 1 from public.programs where id = target_program_id and program_type = target_type and archived_at is null) then
      raise exception 'Program not found, archived, or type mismatch';
    end if;
  end if;

  rule_count := jsonb_array_length(p_rules);
  new_version := to_char(clock_timestamp() at time zone 'UTC', 'YYYY.MM.DD.HH24MISS.MS');
  insert into public.dataset_versions(
    version, program_id, program_name, display_title, effective_from, effective_to,
    source_filename, source_sheet_name, checksum, row_count, validation_summary,
    created_by, created_by_email
  ) values(
    new_version, target_program_id, trim(p_program_name), trim(p_display_title), p_effective_from, p_effective_to,
    trim(p_source_filename), trim(p_source_sheet_name), nullif(trim(p_checksum), ''), rule_count,
    jsonb_build_object('errors', 0, 'warnings', 0), auth.uid(), auth.jwt() ->> 'email'
  ) returning id into new_dataset_id;

  for rule in select value from jsonb_array_elements(p_rules) loop
    insert into public.program_rules(dataset_version_id, source_product_id, related_product_id, message, related_message)
    values(
      new_dataset_id,
      (rule ->> 'source_product_id')::bigint,
      nullif(rule ->> 'related_product_id', '')::bigint,
      trim(rule ->> 'message'),
      nullif(trim(rule ->> 'related_message'), '')
    );
  end loop;

  insert into public.dataset_audit_logs(dataset_version_id, action, actor_id, actor_email, details)
  values(new_dataset_id, 'create_draft', auth.uid(), auth.jwt() ->> 'email',
    jsonb_build_object('program_id', target_program_id, 'program_type', target_type, 'source_filename', p_source_filename,
      'source_sheet_name', p_source_sheet_name, 'row_count', rule_count));
  return jsonb_build_object('program_id', target_program_id, 'dataset_version_id', new_dataset_id, 'version', new_version);
end; $$;

-- Legacy consultation import now creates a version inside the fixed consultation program.
create or replace function public.create_draft_dataset(p_source_filename text, p_rules jsonb, p_checksum text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare new_dataset_id uuid; new_version text; rule jsonb; rule_count integer;
begin
  if not public.is_admin() then raise exception 'Admin permission required' using errcode = '42501'; end if;
  if length(trim(coalesce(p_source_filename, ''))) = 0 then raise exception 'Source filename is required'; end if;
  if jsonb_typeof(p_rules) <> 'array' or jsonb_array_length(p_rules) = 0 then raise exception 'Dataset must contain at least one rule'; end if;
  rule_count := jsonb_array_length(p_rules);
  new_version := to_char(clock_timestamp() at time zone 'UTC', 'YYYY.MM.DD.HH24MISS.MS');
  insert into public.dataset_versions(version, program_id, program_name, display_title, source_filename, checksum, row_count,
    validation_summary, created_by, created_by_email)
  values(new_version, '00000000-0000-4000-8000-000000000001', 'Tư vấn bán kèm', 'Gợi ý tư vấn bán kèm',
    trim(p_source_filename), nullif(trim(p_checksum), ''), rule_count, jsonb_build_object('errors',0,'warnings',0),
    auth.uid(), auth.jwt() ->> 'email') returning id into new_dataset_id;
  for rule in select value from jsonb_array_elements(p_rules) loop
    insert into public.consultation_rules(dataset_version_id, rule_code, source_product_id, source_product_name,
      suggested_product_id, suggested_product_name, consultation_title, consultation_note, category_name, priority,
      is_active, effective_from, effective_to, source, note_internal)
    values(new_dataset_id, nullif(trim(rule ->> 'rule_code'), ''), (rule ->> 'source_product_id')::bigint,
      trim(rule ->> 'source_product_name'), (rule ->> 'suggested_product_id')::bigint, trim(rule ->> 'suggested_product_name'),
      trim(rule ->> 'consultation_title'), trim(rule ->> 'consultation_note'), nullif(trim(rule ->> 'category_name'), ''),
      coalesce((rule ->> 'priority')::integer,100), coalesce((rule ->> 'is_active')::boolean,true),
      nullif(rule ->> 'effective_from','')::date, nullif(rule ->> 'effective_to','')::date,
      nullif(trim(rule ->> 'source'),''), nullif(trim(rule ->> 'note_internal'),''));
  end loop;
  insert into public.dataset_audit_logs(dataset_version_id, action, actor_id, actor_email, details)
  values(new_dataset_id,'create_draft',auth.uid(),auth.jwt()->>'email',jsonb_build_object('source_filename',p_source_filename,'row_count',rule_count));
  return new_dataset_id;
end; $$;

create or replace function public.create_draft_dataset(p_source_filename text, p_source_sheet_name text, p_rules jsonb, p_checksum text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare new_dataset_id uuid;
begin
  if length(trim(coalesce(p_source_sheet_name,''))) = 0 then raise exception 'Source sheet name is required'; end if;
  new_dataset_id := public.create_draft_dataset(p_source_filename,p_rules,p_checksum);
  update public.dataset_versions set source_sheet_name=trim(p_source_sheet_name) where id=new_dataset_id;
  update public.dataset_audit_logs set details=details||jsonb_build_object('source_sheet_name',trim(p_source_sheet_name))
    where dataset_version_id=new_dataset_id and action='create_draft';
  return new_dataset_id;
end; $$;

create or replace function public.publish_dataset(p_dataset_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare target_status public.dataset_status; target_program uuid; action_name text;
begin
  if not public.is_admin() then raise exception 'Admin permission required' using errcode='42501'; end if;
  select status,program_id into target_status,target_program from public.dataset_versions where id=p_dataset_id for update;
  if target_status is null then raise exception 'Dataset not found'; end if;
  if target_status='published' then return; end if;
  action_name := case when target_status='archived' then 'rollback' else 'publish' end;
  update public.dataset_versions set status='archived' where program_id=target_program and status='published';
  update public.dataset_versions set status='published',published_by=auth.uid(),published_by_email=auth.jwt()->>'email',published_at=now()
    where id=p_dataset_id;
  insert into public.dataset_audit_logs(dataset_version_id,action,actor_id,actor_email)
    values(p_dataset_id,action_name,auth.uid(),auth.jwt()->>'email');
end; $$;

create or replace function public.stop_program(p_program_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare stopped_id uuid;
begin
  if not public.is_admin() then raise exception 'Admin permission required' using errcode='42501'; end if;
  update public.dataset_versions set status='archived' where program_id=p_program_id and status='published' returning id into stopped_id;
  if stopped_id is null then raise exception 'Program has no published version'; end if;
  insert into public.dataset_audit_logs(dataset_version_id,action,actor_id,actor_email)
    values(stopped_id,'stop',auth.uid(),auth.jwt()->>'email');
end; $$;

create or replace function public.delete_draft_dataset(p_dataset_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare target_program uuid; remaining_count integer;
begin
  if not public.is_admin() then raise exception 'Admin permission required' using errcode='42501'; end if;
  select program_id into target_program from public.dataset_versions where id=p_dataset_id and status='draft' for update;
  if target_program is null then raise exception 'Only draft versions can be deleted'; end if;
  insert into public.dataset_audit_logs(dataset_version_id,action,actor_id,actor_email,details)
    values(p_dataset_id,'delete_draft',auth.uid(),auth.jwt()->>'email',jsonb_build_object('program_id',target_program));
  delete from public.dataset_versions where id=p_dataset_id;
  select count(*) into remaining_count from public.dataset_versions where program_id=target_program;
  if remaining_count=0 and target_program <> '00000000-0000-4000-8000-000000000001' then delete from public.programs where id=target_program; end if;
end; $$;

create or replace function public.get_program_bundle()
returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'schema_version',2,
    'bundle_version',coalesce(md5(string_agg(d.program_id::text||':'||d.version,'|' order by d.program_id)),md5('empty')),
    'generated_at',now(),
    'programs',coalesce(jsonb_agg(jsonb_build_object(
      'program_id',d.program_id,'program_type',p.program_type,'program_name',d.program_name,'display_title',d.display_title,
      'dataset_version',d.version,'published_at',d.published_at,'effective_from',d.effective_from,'effective_to',d.effective_to,
      'lifecycle_status',case when d.effective_from is not null and now()<d.effective_from then 'scheduled'
        when d.effective_to is not null and now()>d.effective_to then 'expired' else 'active' end,
      'source_filename',d.source_filename,'source_sheet_name',d.source_sheet_name,'checksum',d.checksum,'row_count',d.row_count,
      'published_by_email',d.published_by_email,
      'rules',case when p.program_type='consultation' then coalesce((select jsonb_agg(jsonb_build_object(
        'rule_id',r.id,'source_product_id',r.source_product_id,'source_product_name',r.source_product_name,
        'suggested_product_id',r.suggested_product_id,'suggested_product_name',r.suggested_product_name,
        'consultation_title',r.consultation_title,'consultation_note',r.consultation_note,'priority',r.priority,
        'effective_from',r.effective_from,'effective_to',r.effective_to) order by r.source_product_id,r.priority,r.suggested_product_id)
        from public.consultation_rules r where r.dataset_version_id=d.id and r.is_active=true),'[]'::jsonb)
      else coalesce((select jsonb_agg(jsonb_build_object('rule_id',r.id,'source_product_id',r.source_product_id,
        'related_product_id',r.related_product_id,'message',r.message,'related_message',r.related_message)
        order by r.source_product_id,r.related_product_id) from public.program_rules r where r.dataset_version_id=d.id),'[]'::jsonb) end
    ) order by d.published_at desc),'[]'::jsonb)
  )
  from public.dataset_versions d join public.programs p on p.id=d.program_id
  where d.status='published' and p.archived_at is null;
$$;

-- Backward-compatible consultation RPC.
create or replace function public.get_latest_dataset()
returns jsonb language sql stable security definer set search_path=public as $$
  select coalesce((select jsonb_build_object('schema_version',1,'dataset_version',d.version,'published_at',d.published_at,
    'checksum',d.checksum,'row_count',d.row_count,'rules',coalesce((select jsonb_agg(jsonb_build_object(
      'rule_id',r.id,'rule_code',r.rule_code,'source_product_id',r.source_product_id,'source_product_name',r.source_product_name,
      'suggested_product_id',r.suggested_product_id,'suggested_product_name',r.suggested_product_name,
      'consultation_title',r.consultation_title,'consultation_note',r.consultation_note,'category_name',r.category_name,
      'priority',r.priority,'effective_from',r.effective_from,'effective_to',r.effective_to))
      from public.consultation_rules r where r.dataset_version_id=d.id and r.is_active=true
        and (r.effective_from is null or r.effective_from<=current_date) and (r.effective_to is null or r.effective_to>=current_date)),'[]'::jsonb))
    from public.dataset_versions d where d.program_id='00000000-0000-4000-8000-000000000001' and d.status='published' limit 1),
    jsonb_build_object('schema_version',1,'dataset_version',null,'published_at',null,'checksum',null,'row_count',0,'rules','[]'::jsonb));
$$;

revoke all on function public.create_program_draft(uuid,text,text,text,timestamptz,timestamptz,text,text,jsonb,text) from public;
revoke all on function public.stop_program(uuid) from public;
revoke all on function public.delete_draft_dataset(uuid) from public;
grant execute on function public.create_program_draft(uuid,text,text,text,timestamptz,timestamptz,text,text,jsonb,text) to authenticated;
grant execute on function public.stop_program(uuid) to authenticated;
grant execute on function public.delete_draft_dataset(uuid) to authenticated;
grant execute on function public.get_program_bundle() to anon,authenticated;
grant execute on function public.get_latest_dataset() to anon,authenticated;
