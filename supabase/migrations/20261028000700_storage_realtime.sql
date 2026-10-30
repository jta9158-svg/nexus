-- =====================================================================
-- NEXUS — 0007 Armazenamento (Storage) e tempo real (Realtime)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Buckets
--   avatars         público  avatars/<user_id>/...
--   server-assets   público  server-assets/<server_id>/...
--   attachments     privado  attachments/c/<channel_id>/<id>/<nome>
--                            attachments/d/<dm_thread_id>/<id>/<nome>
--   project-files   privado  project-files/<server_id>/<id>/<nome>
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('avatars', 'avatars', true, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  ('server-assets', 'server-assets', true, 10485760, array['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  ('attachments', 'attachments', false, 26214400, null),
  ('project-files', 'project-files', false, 52428800, null)
on conflict (id) do nothing;

-- Funções de acesso por caminho do arquivo
create or replace function public.storage_can_read_attachment(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
  v_id uuid := public.try_uuid(v_parts[2]);
begin
  if v_id is null then
    return false;
  end if;
  if v_parts[1] = 'c' then
    return public._can_view_channel(v_id, auth.uid());
  elsif v_parts[1] = 'd' then
    return public._is_dm_participant(v_id, auth.uid());
  end if;
  return false;
end
$$;

create or replace function public.storage_can_write_attachment(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
  v_id uuid := public.try_uuid(v_parts[2]);
  v_server uuid;
begin
  if v_id is null or array_length(v_parts, 1) < 4 then
    return false;
  end if;
  if v_parts[1] = 'c' then
    select c.server_id into v_server from public.channels c where c.id = v_id and c.kind = 'text';
    return v_server is not null
       and public._can_view_channel(v_id, auth.uid())
       and public._has_server_perm(v_server, auth.uid(), 'send_messages')
       and public._has_server_perm(v_server, auth.uid(), 'attach_files');
  elsif v_parts[1] = 'd' then
    return public._is_dm_participant(v_id, auth.uid());
  end if;
  return false;
end
$$;

create or replace function public.storage_can_read_project_file(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.files f
    where f.storage_path = p_name
      and public._can_view_file(f.id, auth.uid())
  )
$$;

create or replace function public.storage_can_write_project_file(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.try_uuid(split_part(p_name, '/', 1)) is not null
     and public._has_server_perm(public.try_uuid(split_part(p_name, '/', 1)), auth.uid(), 'view_files')
$$;

create or replace function public.storage_can_manage_server_asset(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.try_uuid(split_part(p_name, '/', 1)) is not null
     and public._has_server_perm(public.try_uuid(split_part(p_name, '/', 1)), auth.uid(), 'manage_server')
$$;

-- Políticas do storage.objects
create policy "nexus avatars upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and split_part(name, '/', 1) = auth.uid()::text);
create policy "nexus avatars update" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and split_part(name, '/', 1) = auth.uid()::text)
  with check (bucket_id = 'avatars' and split_part(name, '/', 1) = auth.uid()::text);
create policy "nexus avatars delete" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and split_part(name, '/', 1) = auth.uid()::text);

create policy "nexus server assets upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'server-assets' and public.storage_can_manage_server_asset(name));
create policy "nexus server assets update" on storage.objects for update to authenticated
  using (bucket_id = 'server-assets' and public.storage_can_manage_server_asset(name))
  with check (bucket_id = 'server-assets' and public.storage_can_manage_server_asset(name));
create policy "nexus server assets delete" on storage.objects for delete to authenticated
  using (bucket_id = 'server-assets' and public.storage_can_manage_server_asset(name));

create policy "nexus attachments read" on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and public.storage_can_read_attachment(name));
create policy "nexus attachments upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and public.storage_can_write_attachment(name));
create policy "nexus attachments delete" on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and owner_id = auth.uid()::text);

create policy "nexus project files read" on storage.objects for select to authenticated
  using (bucket_id = 'project-files' and (public.storage_can_read_project_file(name) or owner_id = auth.uid()::text));
create policy "nexus project files upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'project-files' and public.storage_can_write_project_file(name));
create policy "nexus project files delete" on storage.objects for delete to authenticated
  using (bucket_id = 'project-files' and (
    owner_id = auth.uid()::text
    or (public.try_uuid(split_part(name, '/', 1)) is not null
        and public.has_server_perm(public.try_uuid(split_part(name, '/', 1)), 'manage_files'))
  ));

-- ---------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------

-- Tabelas que enviam mudanças em tempo real (respeitando RLS).
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array[
      'messages', 'notifications', 'channels', 'server_members', 'member_roles', 'roles', 'servers',
      'dm_threads', 'dm_participants', 'project_tasks', 'companion_tasks', 'companion_questions',
      'ai_messages', 'files', 'claude_channel_requests'
    ] loop
      begin
        execute format('alter publication supabase_realtime add table public.%I', t);
      exception when duplicate_object then
        null;
      end;
    end loop;
  end if;
end
$$;

-- Canais privados (presença online, quem está em cada call, "digitando").
-- Tópicos: server:<id>, dm:<id>, user:<id>
create or replace function public.realtime_topic_allowed(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_prefix text := split_part(p_topic, ':', 1);
  v_id uuid := public.try_uuid(split_part(p_topic, ':', 2));
begin
  if auth.uid() is null or v_id is null then
    return false;
  end if;
  if v_prefix = 'server' then
    return public._is_server_member(v_id, auth.uid());
  elsif v_prefix = 'dm' then
    return public._is_dm_participant(v_id, auth.uid());
  elsif v_prefix = 'user' then
    return v_id = auth.uid();
  end if;
  return false;
end
$$;

do $$
begin
  if to_regclass('realtime.messages') is not null then
    execute $p$
      create policy "nexus realtime read" on realtime.messages for select to authenticated
      using (public.realtime_topic_allowed((select realtime.topic())))
    $p$;
    execute $p$
      create policy "nexus realtime write" on realtime.messages for insert to authenticated
      with check (public.realtime_topic_allowed((select realtime.topic())))
    $p$;
  end if;
end
$$;
