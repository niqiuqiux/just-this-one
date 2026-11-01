-- Run once in the Supabase SQL Editor, or apply with `supabase db push`.
-- No service-role key is needed by the web application.
begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create or replace function private.valid_workspace(candidate jsonb)
returns boolean
language plpgsql immutable strict
set search_path = ''
as $$
declare
  item jsonb;
begin
  if jsonb_typeof(candidate) is distinct from 'object'
    or jsonb_typeof(candidate->'entries') is distinct from 'array'
    or not (candidate ? 'activeId')
    or jsonb_typeof(candidate->'activeId') not in ('null', 'string')
    or jsonb_array_length(candidate->'entries') > 5000
    or octet_length(candidate::text) > 5242880 then return false; end if;
  for item in select * from jsonb_array_elements(candidate->'entries') loop
    if not coalesce(
      jsonb_typeof(item) = 'object'
      and jsonb_typeof(item->'id') = 'string' and length(item->>'id') between 1 and 200
      and jsonb_typeof(item->'title') = 'string' and length(btrim(item->>'title')) between 1 and 120
      and length(item->>'title') <= 120
      and jsonb_typeof(item->'body') = 'string' and length(item->>'body') <= 5000
      and item->>'category' in ('灵感', '工作', '生活', '学习')
      and jsonb_typeof(item->'minutes') = 'number' and (item->>'minutes')::numeric > 0 and (item->>'minutes')::numeric <= 1440
      and jsonb_typeof(item->'isTask') = 'boolean' and jsonb_typeof(item->'done') = 'boolean'
      and jsonb_typeof(item->'createdAt') = 'number' and (item->>'createdAt')::numeric between 0 and 8640000000000000
      and (not (item ? 'completedAt') or (jsonb_typeof(item->'completedAt') = 'number' and (item->>'completedAt')::numeric between 0 and 8640000000000000))
      and (not (item ? 'example') or item->'example' = 'false'::jsonb), false)
    then return false; end if;
  end loop;
  if (select count(*) <> count(distinct e->>'id') from jsonb_array_elements(candidate->'entries') e) then return false; end if;
  if candidate->>'activeId' is not null and not exists (
    select 1 from jsonb_array_elements(candidate->'entries') e
    where e->>'id' = candidate->>'activeId' and e->'isTask' = 'true'::jsonb and e->'done' = 'false'::jsonb
  ) then return false; end if;
  return true;
exception when others then
  return false;
end;
$$;

create table if not exists public.workspaces (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision integer not null default 0 check (revision >= 0),
  data jsonb not null default '{"entries":[],"activeId":null}'::jsonb check (private.valid_workspace(data)),
  updated_at timestamptz not null default now()
);

alter table public.workspaces enable row level security;
drop policy if exists "Read own workspace" on public.workspaces;
create policy "Read own workspace" on public.workspaces
  for select to authenticated using ((select auth.uid()) = user_id);

revoke all on table public.workspaces from anon, authenticated;
grant select on table public.workspaces to authenticated;

-- Only this function may write. Row locking + revision checks prevent lost updates.
create or replace function private.save_workspace(expected_revision integer, workspace jsonb, expected_user_id uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  saved public.workspaces%rowtype;
begin
  if owner_id is null or owner_id is distinct from expected_user_id then
    raise exception 'Authentication required or account changed' using errcode = '42501'; end if;
  if expected_revision is null or expected_revision < 0 or workspace is null or not private.valid_workspace(workspace)
    then raise exception 'Invalid workspace' using errcode = '22023'; end if;

  insert into public.workspaces (user_id) values (owner_id) on conflict (user_id) do nothing;
  select * into saved from public.workspaces where user_id = owner_id for update;
  -- A retry after a lost response succeeds without creating another revision.
  if saved.data = workspace then
    return jsonb_build_object('applied', true, 'snapshot', jsonb_build_object('revision', saved.revision, 'data', saved.data));
  end if;
  if saved.revision <> expected_revision then
    return jsonb_build_object('applied', false, 'snapshot', jsonb_build_object('revision', saved.revision, 'data', saved.data));
  end if;
  update public.workspaces set data = workspace, revision = revision + 1, updated_at = now()
    where user_id = owner_id returning * into saved;
  return jsonb_build_object('applied', true, 'snapshot', jsonb_build_object('revision', saved.revision, 'data', saved.data));
end;
$$;

-- The exposed RPC is unprivileged; privileged writes live outside the Data API schema.
revoke all on function private.save_workspace(integer, jsonb, uuid) from public, anon;
grant execute on function private.save_workspace(integer, jsonb, uuid) to authenticated;

create or replace function public.save_workspace(expected_revision integer, workspace jsonb, expected_user_id uuid)
returns jsonb
language sql security invoker
set search_path = ''
as $$
  select private.save_workspace(expected_revision, workspace, expected_user_id);
$$;

revoke all on function public.save_workspace(integer, jsonb, uuid) from public, anon;
grant execute on function public.save_workspace(integer, jsonb, uuid) to authenticated;
revoke all on function private.valid_workspace(jsonb) from public, anon, authenticated;

commit;
