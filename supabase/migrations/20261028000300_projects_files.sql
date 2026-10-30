-- =====================================================================
-- NEXUS — 0003 Desenvolvimento de jogos (projetos, tarefas, versões,
-- histórico) e Arquivos
-- =====================================================================

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.servers (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  description text check (description is null or char_length(description) <= 2000),
  status text not null default 'ativo' check (status in ('planejamento', 'ativo', 'pausado', 'lancado', 'arquivado')),
  color text check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  roblox_place_id bigint check (roblox_place_id is null or roblox_place_id > 0),
  roblox_universe_id bigint check (roblox_universe_id is null or roblox_universe_id > 0),
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, server_id)
);

create index projects_server_idx on public.projects (server_id);

create trigger projects_touch before update on public.projects
  for each row execute function public.touch_updated_at();

create table public.project_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  server_id uuid not null,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text check (description is null or char_length(description) <= 5000),
  kind text not null default 'tarefa' check (kind in ('tarefa', 'bug', 'melhoria')),
  status text not null default 'a_fazer' check (status in ('a_fazer', 'em_andamento', 'em_revisao', 'concluida', 'cancelada')),
  priority text not null default 'media' check (priority in ('baixa', 'media', 'alta', 'critica')),
  assignee_id uuid references public.profiles (id) on delete set null,
  due_date date,
  labels text[] not null default '{}'::text[],
  position double precision not null default 0,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_by_kind text not null default 'user' check (created_by_kind in ('user', 'claude')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  foreign key (project_id, server_id) references public.projects (id, server_id) on delete cascade
);

create index project_tasks_project_idx on public.project_tasks (project_id, status);
create index project_tasks_assignee_idx on public.project_tasks (assignee_id) where assignee_id is not null;

create trigger project_tasks_touch before update on public.project_tasks
  for each row execute function public.touch_updated_at();

create table public.project_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  server_id uuid not null,
  version text not null check (char_length(btrim(version)) between 1 and 40),
  notes text check (notes is null or char_length(notes) <= 5000),
  status text not null default 'em_teste' check (status in ('planejada', 'em_teste', 'publicada', 'revertida')),
  released_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (project_id, server_id) references public.projects (id, server_id) on delete cascade
);

create index project_versions_project_idx on public.project_versions (project_id, created_at desc);

-- Histórico de alterações (quem fez o quê e quando). Escrito só por gatilhos/servidor.
create table public.activity_log (
  id bigint generated always as identity primary key,
  server_id uuid not null references public.servers (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  actor_kind text not null default 'user' check (actor_kind in ('user', 'claude', 'system')),
  action text not null,
  entity_type text,
  entity_id uuid,
  summary text not null check (char_length(summary) <= 500),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index activity_log_server_idx on public.activity_log (server_id, created_at desc);
create index activity_log_project_idx on public.activity_log (project_id, created_at desc) where project_id is not null;

create or replace function public._log_activity(
  p_server uuid,
  p_project uuid,
  p_actor uuid,
  p_actor_kind text,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_summary text,
  p_details jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.activity_log (server_id, project_id, actor_id, actor_kind, action, entity_type, entity_id, summary, details)
  values (p_server, p_project, p_actor, coalesce(p_actor_kind, 'user'), p_action, p_entity_type, p_entity_id, left(p_summary, 500), coalesce(p_details, '{}'::jsonb))
$$;

create or replace function public.status_label(p_status text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_status
    when 'a_fazer' then 'A fazer'
    when 'em_andamento' then 'Em andamento'
    when 'em_revisao' then 'Em revisão'
    when 'concluida' then 'Concluída'
    when 'cancelada' then 'Cancelada'
    else p_status
  end
$$;

create or replace function public.project_tasks_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_kind text := case when auth.uid() is null then 'system' else 'user' end;
begin
  if tg_op = 'INSERT' then
    if new.created_by_kind = 'claude' then
      v_kind := 'claude';
    end if;
    perform public._log_activity(new.server_id, new.project_id, v_actor, v_kind, 'task.created', 'task', new.id,
      'Criou ' || case new.kind when 'bug' then 'o bug' when 'melhoria' then 'a melhoria' else 'a tarefa' end || ' "' || new.title || '"');
    return new;
  elsif tg_op = 'UPDATE' then
    if new.status is distinct from old.status then
      if new.status = 'concluida' then
        new.completed_at := now();
      elsif old.status = 'concluida' then
        new.completed_at := null;
      end if;
      perform public._log_activity(new.server_id, new.project_id, v_actor, v_kind, 'task.status', 'task', new.id,
        '"' || new.title || '": ' || public.status_label(old.status) || ' → ' || public.status_label(new.status),
        jsonb_build_object('from', old.status, 'to', new.status));
    end if;
    if new.assignee_id is distinct from old.assignee_id then
      perform public._log_activity(new.server_id, new.project_id, v_actor, v_kind, 'task.assignee', 'task', new.id,
        '"' || new.title || '": responsável alterado',
        jsonb_build_object('from', old.assignee_id, 'to', new.assignee_id));
    end if;
    if new.priority is distinct from old.priority then
      perform public._log_activity(new.server_id, new.project_id, v_actor, v_kind, 'task.priority', 'task', new.id,
        '"' || new.title || '": prioridade ' || old.priority || ' → ' || new.priority);
    end if;
    return new;
  else
    -- Exclusão em cascata (projeto ou servidor apagado): não há onde registrar.
    if not exists (select 1 from public.projects p where p.id = old.project_id) then
      return old;
    end if;
    perform public._log_activity(old.server_id, old.project_id, v_actor, v_kind, 'task.deleted', 'task', old.id,
      'Excluiu "' || old.title || '"');
    return old;
  end if;
end
$$;

create trigger project_tasks_audit_ins after insert on public.project_tasks
  for each row execute function public.project_tasks_audit();
create trigger project_tasks_audit_upd before update on public.project_tasks
  for each row execute function public.project_tasks_audit();
create trigger project_tasks_audit_del after delete on public.project_tasks
  for each row execute function public.project_tasks_audit();

create or replace function public.projects_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public._log_activity(new.server_id, new.id, auth.uid(), 'user', 'project.created', 'project', new.id,
      'Criou o projeto "' || new.name || '"');
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    perform public._log_activity(new.server_id, new.id, auth.uid(), 'user', 'project.status', 'project', new.id,
      'Projeto "' || new.name || '": ' || old.status || ' → ' || new.status);
  end if;
  return new;
end
$$;

create trigger projects_audit after insert or update on public.projects
  for each row execute function public.projects_audit();

-- ---------------------------------------------------------------------
-- Arquivos e organização
-- ---------------------------------------------------------------------
create table public.files (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.servers (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  folder text not null default '' check (char_length(folder) <= 200 and folder !~ '(^|/)\.\.(/|$)'),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  kind text not null default 'arquivo'
    check (kind in ('arquivo', 'imagem', 'modelo3d', 'documento', 'referencia', 'link', 'ideia', 'cronograma', 'script')),
  storage_path text unique,
  url text check (url is null or url ~* '^https?://'),
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  description text check (description is null or char_length(description) <= 2000),
  tags text[] not null default '{}'::text[],
  visibility text not null default 'servidor' check (visibility in ('servidor', 'privado')),
  uploaded_by uuid references public.profiles (id) on delete set null default auth.uid(),
  version integer not null default 1,
  previous_version_id uuid references public.files (id) on delete set null,
  search tsvector,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind in ('link', 'ideia', 'cronograma') or storage_path is not null),
  check (kind <> 'link' or url is not null)
);

create index files_server_idx on public.files (server_id, folder);
create index files_project_idx on public.files (project_id) where project_id is not null;
create index files_search_idx on public.files using gin (search);

create or replace function public.files_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.folder := regexp_replace(btrim(new.folder, ' /'), '/{2,}', '/', 'g');
  new.search := to_tsvector('portuguese'::regconfig,
    coalesce(new.name, '') || ' ' || coalesce(new.description, '') || ' ' ||
    coalesce(array_to_string(new.tags, ' '), '') || ' ' || replace(coalesce(new.folder, ''), '/', ' '));
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end
$$;

create trigger files_before_write before insert or update on public.files
  for each row execute function public.files_before_write();

create or replace function public.files_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public._log_activity(new.server_id, new.project_id, auth.uid(), 'user', 'file.created', 'file', new.id,
      'Adicionou "' || new.name || '"' || case when new.folder <> '' then ' em ' || new.folder else '' end);
    return new;
  else
    if not exists (select 1 from public.servers sv where sv.id = old.server_id) then
      return old;
    end if;
    perform public._log_activity(old.server_id,
      (select p.id from public.projects p where p.id = old.project_id),
      auth.uid(), 'user', 'file.deleted', 'file', old.id, 'Removeu "' || old.name || '"');
    return old;
  end if;
end
$$;

create trigger files_audit_ins after insert on public.files
  for each row execute function public.files_audit();
create trigger files_audit_del after delete on public.files
  for each row execute function public.files_audit();

create or replace function public._can_view_file(p_file uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.files f
    where f.id = p_file
      and public._has_server_perm(f.server_id, p_user, 'view_files')
      and (f.visibility = 'servidor'
           or f.uploaded_by = p_user
           or public._has_server_perm(f.server_id, p_user, 'manage_files'))
  )
$$;

create or replace function public.search_files(p_server uuid, p_query text)
returns setof public.files
language sql
stable
security invoker
set search_path = ''
as $$
  with q as (
    select string_agg(w || ':*', ' & ') as tsq
    from regexp_split_to_table(lower(coalesce(p_query, '')), '[^[:alnum:]]+') as w
    where w <> ''
  )
  select f.*
  from public.files f, q
  where f.server_id = p_server
    and q.tsq is not null
    and (f.search @@ to_tsquery('portuguese'::regconfig, q.tsq) or f.name ilike '%' || p_query || '%')
  order by f.updated_at desc
  limit 100
$$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.projects enable row level security;
alter table public.project_tasks enable row level security;
alter table public.project_versions enable row level security;
alter table public.activity_log enable row level security;
alter table public.files enable row level security;

create policy projects_select on public.projects for select to authenticated
  using (public.has_server_perm(server_id, 'view_projects'));
create policy projects_write on public.projects for insert to authenticated
  with check (public.has_server_perm(server_id, 'manage_projects') and created_by = auth.uid());
create policy projects_update on public.projects for update to authenticated
  using (public.has_server_perm(server_id, 'manage_projects'))
  with check (public.has_server_perm(server_id, 'manage_projects'));
create policy projects_delete on public.projects for delete to authenticated
  using (public.has_server_perm(server_id, 'manage_projects'));
revoke update on public.projects from anon, authenticated;
grant update (name, description, status, color, roblox_place_id, roblox_universe_id) on public.projects to authenticated;

create policy tasks_select on public.project_tasks for select to authenticated
  using (public.has_server_perm(server_id, 'view_projects'));
create policy tasks_insert on public.project_tasks for insert to authenticated
  with check (public.has_server_perm(server_id, 'manage_projects') and created_by = auth.uid() and created_by_kind = 'user');
create policy tasks_update on public.project_tasks for update to authenticated
  using (public.has_server_perm(server_id, 'manage_projects') or assignee_id = auth.uid())
  with check (public.has_server_perm(server_id, 'manage_projects') or assignee_id = auth.uid());
create policy tasks_delete on public.project_tasks for delete to authenticated
  using (public.has_server_perm(server_id, 'manage_projects'));
revoke update on public.project_tasks from anon, authenticated;
grant update (title, description, kind, status, priority, assignee_id, due_date, labels, position) on public.project_tasks to authenticated;

create policy versions_select on public.project_versions for select to authenticated
  using (public.has_server_perm(server_id, 'view_projects'));
create policy versions_write on public.project_versions for all to authenticated
  using (public.has_server_perm(server_id, 'manage_projects'))
  with check (public.has_server_perm(server_id, 'manage_projects'));

create policy activity_select on public.activity_log for select to authenticated
  using (
    public.is_server_member(server_id)
    and (
      (action like 'task.%' or action like 'project.%') and public.has_server_perm(server_id, 'view_projects')
      or action like 'file.%' and public.has_server_perm(server_id, 'view_files')
      or action like 'finance.%' and public.has_server_perm(server_id, 'view_finance')
      or not (action like 'task.%' or action like 'project.%' or action like 'file.%' or action like 'finance.%')
    )
  );
revoke insert, update, delete on public.activity_log from anon, authenticated;

create policy files_select on public.files for select to authenticated
  using (
    public.has_server_perm(server_id, 'view_files')
    and (visibility = 'servidor' or uploaded_by = auth.uid() or public.has_server_perm(server_id, 'manage_files'))
  );
create policy files_insert on public.files for insert to authenticated
  with check (public.has_server_perm(server_id, 'view_files') and uploaded_by = auth.uid());
create policy files_update on public.files for update to authenticated
  using (uploaded_by = auth.uid() or public.has_server_perm(server_id, 'manage_files'))
  with check (uploaded_by = auth.uid() or public.has_server_perm(server_id, 'manage_files'));
create policy files_delete on public.files for delete to authenticated
  using (uploaded_by = auth.uid() or public.has_server_perm(server_id, 'manage_files'));
revoke update on public.files from anon, authenticated;
grant update (project_id, folder, name, kind, url, description, tags, visibility) on public.files to authenticated;

revoke execute on function public._log_activity(uuid, uuid, uuid, text, text, text, uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public._can_view_file(uuid, uuid) from public, anon, authenticated;
grant execute on function public._can_view_file(uuid, uuid) to service_role;
grant execute on function public._log_activity(uuid, uuid, uuid, text, text, text, uuid, text, jsonb) to service_role;
