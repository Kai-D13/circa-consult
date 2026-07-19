alter table public.dataset_audit_logs drop constraint if exists dataset_audit_logs_action_check;
alter table public.dataset_audit_logs add constraint dataset_audit_logs_action_check
  check (action in ('create_draft', 'publish', 'rollback', 'stop', 'delete_draft', 'delete_version'));

create or replace function public.delete_dataset_version(p_dataset_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_program uuid;
  target_status public.dataset_status;
  target_version text;
  target_name text;
  remaining_count integer;
begin
  if not public.is_admin() then
    raise exception 'Admin permission required' using errcode = '42501';
  end if;

  select program_id, status, version, program_name
  into target_program, target_status, target_version, target_name
  from public.dataset_versions
  where id = p_dataset_id
  for update;

  if target_program is null then
    raise exception 'Dataset version not found';
  end if;
  if target_status = 'published' then
    raise exception 'Published version must be stopped before deletion';
  end if;

  insert into public.dataset_audit_logs(dataset_version_id, action, actor_id, actor_email, details)
  values(
    p_dataset_id,
    'delete_version',
    auth.uid(),
    auth.jwt() ->> 'email',
    jsonb_build_object(
      'program_id', target_program,
      'program_name', target_name,
      'version', target_version,
      'previous_status', target_status
    )
  );

  delete from public.dataset_versions where id = p_dataset_id;

  select count(*) into remaining_count
  from public.dataset_versions
  where program_id = target_program;

  if remaining_count = 0
     and target_program <> '00000000-0000-4000-8000-000000000001' then
    delete from public.programs where id = target_program;
  end if;
end;
$$;

revoke all on function public.delete_dataset_version(uuid) from public;
grant execute on function public.delete_dataset_version(uuid) to authenticated;
