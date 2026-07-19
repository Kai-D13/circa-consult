alter table public.program_rules add column if not exists combo_id bigint;
alter table public.program_rules drop constraint if exists program_rules_combo_id_check;
alter table public.program_rules add constraint program_rules_combo_id_check check (combo_id is null or combo_id > 0);

-- Generic rules used related_product_id in their identity. Combo members need combo_id
-- so the same product can safely appear in more than one combo in one dataset.
drop index if exists public.program_rules_unique_mapping;
create unique index if not exists program_rules_unique_mapping
  on public.program_rules (dataset_version_id, source_product_id, coalesce(related_product_id, 0))
  where combo_id is null;
create unique index if not exists program_rules_unique_combo_member
  on public.program_rules (dataset_version_id, combo_id, source_product_id)
  where combo_id is not null;
create index if not exists program_rules_combo_lookup
  on public.program_rules(dataset_version_id, combo_id) where combo_id is not null;

create or replace function public.create_combo_draft(
  p_program_id uuid,
  p_program_name text,
  p_source_filename text,
  p_source_sheet_name text,
  p_rules jsonb,
  p_checksum text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  target_program_id uuid := p_program_id;
  new_dataset_id uuid;
  new_version text;
  rule jsonb;
  rule_count integer;
  month_start timestamp;
  effective_start timestamptz;
  effective_end timestamptz;
begin
  if not public.is_admin() then raise exception 'Admin permission required' using errcode = '42501'; end if;
  if length(trim(coalesce(p_program_name, ''))) = 0 then raise exception 'Program name is required'; end if;
  if length(trim(coalesce(p_source_filename, ''))) = 0 or length(trim(coalesce(p_source_sheet_name, ''))) = 0 then
    raise exception 'Source filename and sheet name are required';
  end if;
  if jsonb_typeof(p_rules) <> 'array' or jsonb_array_length(p_rules) = 0 then
    raise exception 'Rules must be a non-empty JSON array';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_rules) r
    where coalesce(r ->> 'combo_id', '') !~ '^[1-9][0-9]*$'
       or coalesce(r ->> 'sub_product_id', '') !~ '^[1-9][0-9]*$'
       or length(trim(coalesce(r ->> 'message', ''))) = 0
  ) then raise exception 'Every combo rule requires positive combo_id, positive sub_product_id and message'; end if;

  if exists (
    select 1 from jsonb_array_elements(p_rules) r
    group by (r ->> 'combo_id')::bigint
    having count(distinct trim(r ->> 'message')) > 1
  ) then raise exception 'All members of one combo_id must use the same message'; end if;

  if exists (
    select 1 from jsonb_array_elements(p_rules) r
    group by (r ->> 'combo_id')::bigint, (r ->> 'sub_product_id')::bigint
    having count(*) > 1
  ) then raise exception 'Duplicate combo_id and sub_product_id pair'; end if;

  if target_program_id is null then
    insert into public.programs(program_type, created_by, created_by_email)
    values('combo', auth.uid(), auth.jwt() ->> 'email') returning id into target_program_id;
  elsif not exists (
    select 1 from public.programs where id = target_program_id and program_type = 'combo' and archived_at is null
  ) then raise exception 'Combo program not found or archived'; end if;

  month_start := date_trunc('month', timezone('Asia/Ho_Chi_Minh', now()));
  effective_start := month_start at time zone 'Asia/Ho_Chi_Minh';
  effective_end := ((month_start + interval '1 month') at time zone 'Asia/Ho_Chi_Minh') - interval '1 microsecond';
  rule_count := jsonb_array_length(p_rules);
  new_version := to_char(clock_timestamp() at time zone 'UTC', 'YYYY.MM.DD.HH24MISS.MS');

  insert into public.dataset_versions(
    version, program_id, program_name, display_title, effective_from, effective_to,
    source_filename, source_sheet_name, checksum, row_count, validation_summary,
    created_by, created_by_email
  ) values(
    new_version, target_program_id, trim(p_program_name), 'Chương trình combo', effective_start, effective_end,
    trim(p_source_filename), trim(p_source_sheet_name), nullif(trim(p_checksum), ''), rule_count,
    jsonb_build_object('errors', 0, 'warnings', 0, 'effective_timezone', 'Asia/Ho_Chi_Minh'),
    auth.uid(), auth.jwt() ->> 'email'
  ) returning id into new_dataset_id;

  for rule in select value from jsonb_array_elements(p_rules) loop
    insert into public.program_rules(dataset_version_id, combo_id, source_product_id, message)
    values(new_dataset_id, (rule ->> 'combo_id')::bigint, (rule ->> 'sub_product_id')::bigint, trim(rule ->> 'message'));
  end loop;

  insert into public.dataset_audit_logs(dataset_version_id, action, actor_id, actor_email, details)
  values(new_dataset_id, 'create_draft', auth.uid(), auth.jwt() ->> 'email',
    jsonb_build_object('program_id', target_program_id, 'program_type', 'combo',
      'source_filename', p_source_filename, 'source_sheet_name', p_source_sheet_name,
      'row_count', rule_count, 'effective_timezone', 'Asia/Ho_Chi_Minh'));

  return jsonb_build_object('program_id', target_program_id, 'dataset_version_id', new_dataset_id,
    'version', new_version, 'effective_from', effective_start, 'effective_to', effective_end);
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
      else coalesce((select jsonb_agg(jsonb_build_object('rule_id',r.id,'combo_id',r.combo_id,
        'source_product_id',r.source_product_id,'related_product_id',r.related_product_id,
        'message',r.message,'related_message',r.related_message)
        order by r.combo_id,r.source_product_id,r.related_product_id)
        from public.program_rules r where r.dataset_version_id=d.id),'[]'::jsonb) end
    ) order by d.published_at desc),'[]'::jsonb)
  )
  from public.dataset_versions d join public.programs p on p.id=d.program_id
  where d.status='published' and p.archived_at is null;
$$;

revoke all on function public.create_combo_draft(uuid,text,text,text,jsonb,text) from public;
grant execute on function public.create_combo_draft(uuid,text,text,text,jsonb,text) to authenticated;
grant execute on function public.get_program_bundle() to anon,authenticated;
