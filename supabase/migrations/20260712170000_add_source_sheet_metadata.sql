alter table public.dataset_versions
  add column if not exists source_sheet_name text;

create or replace function public.create_draft_dataset(
  p_source_filename text,
  p_source_sheet_name text,
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
  normalized_sheet_name text;
begin
  normalized_sheet_name := nullif(trim(p_source_sheet_name), '');
  if normalized_sheet_name is null then
    raise exception 'Source sheet name is required';
  end if;

  new_dataset_id := public.create_draft_dataset(p_source_filename, p_rules, p_checksum);

  update public.dataset_versions
  set source_sheet_name = normalized_sheet_name
  where id = new_dataset_id;

  update public.dataset_audit_logs
  set details = details || jsonb_build_object('source_sheet_name', normalized_sheet_name)
  where dataset_version_id = new_dataset_id
    and action = 'create_draft';

  return new_dataset_id;
end;
$$;

revoke all on function public.create_draft_dataset(text, text, jsonb, text) from public;
grant execute on function public.create_draft_dataset(text, text, jsonb, text) to authenticated;

