-- =====================================================================
-- NEXUS — 0006 Claude Companion: modos, permissões, tarefas em segundo
-- plano, dúvidas e registros (logs)
-- =====================================================================

create or replace function public.companion_scopes()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'ouvir_call',           -- ouvir o áudio de uma sala
    'falar_call',           -- falar na call
    'ler_mensagens',        -- ler mensagens autorizadas
    'acessar_arquivos',     -- ler arquivos do projeto
    'modificar_projetos',   -- criar/alterar tarefas e arquivos do projeto
    'executar_comandos',    -- executar comandos no computador
    'controlar_apps',       -- controlar aplicativos (Roblox Studio, Blender)
    'ver_financas',         -- consultar dados financeiros
    'integracoes_externas', -- usar integrações externas
    'publicar_alteracoes'   -- publicar alterações
  ]::text[]
$$;

create table public.companion_settings (
  user_id uuid primary key references public.profiles (id) on delete cascade default auth.uid(),
  mode text not null default 'hibrido'
    check (mode in ('quando_chamado', 'participante_ativo', 'segundo_plano', 'hibrido')),
  max_concurrent_tasks integer not null default 2 check (max_concurrent_tasks between 1 and 5),
  voice_enabled boolean not null default false,
  transcript_retention_days integer not null default 0 check (transcript_retention_days between 0 and 90),
  updated_at timestamptz not null default now()
);

create trigger companion_settings_touch before update on public.companion_settings
  for each row execute function public.touch_updated_at();

create table public.companion_permissions (
  user_id uuid not null references public.profiles (id) on delete cascade,
  scope text not null check (scope = any (public.companion_scopes())),
  granted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, scope)
);

create table public.companion_tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  server_id uuid references public.servers (id) on delete set null,
  project_id uuid references public.projects (id) on delete set null,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  instructions text not null check (char_length(instructions) between 1 and 20000),
  status text not null default 'aguardando' check (status in (
    'aguardando', 'executando', 'aguardando_confirmacao', 'bloqueada', 'concluida', 'falhou', 'cancelada'
  )),
  blocked_reason text,
  progress integer not null default 0 check (progress between 0 and 100),
  progress_note text,
  priority text not null default 'media' check (priority in ('baixa', 'media', 'alta')),
  required_scopes text[] not null default '{}'::text[] check (required_scopes <@ public.companion_scopes()),
  resource_key text check (resource_key is null or char_length(resource_key) <= 200),
  state jsonb not null default '{}'::jsonb,
  result text,
  error text,
  steps integer not null default 0,
  max_steps integer not null default 30 check (max_steps between 1 and 200),
  attempts integer not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  heartbeat_at timestamptz,
  updated_at timestamptz not null default now()
);

create index companion_tasks_owner_idx on public.companion_tasks (owner_id, created_at desc);
create index companion_tasks_status_idx on public.companion_tasks (status) where status in ('aguardando', 'executando');

-- Evita duas tarefas mexendo no mesmo recurso (ex.: o mesmo arquivo) ao mesmo tempo.
create unique index companion_tasks_resource_lock on public.companion_tasks (resource_key)
  where resource_key is not null and status in ('executando', 'aguardando_confirmacao');

create trigger companion_tasks_touch before update on public.companion_tasks
  for each row execute function public.touch_updated_at();

create table public.companion_questions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references public.companion_tasks (id) on delete cascade,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  question text not null check (char_length(question) between 1 and 2000),
  options jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  urgency text not null default 'media' check (urgency in ('baixa', 'media', 'alta')),
  route text not null default 'chat_tarefas' check (route in ('call', 'notificacao', 'chat_tarefas', 'pendencias')),
  blocking boolean not null default true,
  status text not null default 'pendente' check (status in ('pendente', 'respondida', 'descartada')),
  answer text check (answer is null or char_length(answer) <= 4000),
  created_at timestamptz not null default now(),
  answered_at timestamptz
);

create index companion_questions_owner_idx on public.companion_questions (owner_id, status, created_at desc);

create table public.companion_logs (
  id bigint generated always as identity primary key,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  task_id uuid references public.companion_tasks (id) on delete set null,
  level text not null default 'info' check (level in ('info', 'aviso', 'erro')),
  event text not null,
  message text not null check (char_length(message) <= 2000),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index companion_logs_owner_idx on public.companion_logs (owner_id, created_at desc);
create index companion_logs_task_idx on public.companion_logs (task_id, created_at) where task_id is not null;

-- ---------------------------------------------------------------------
-- Funções internas (usadas pelo executor no servidor)
-- ---------------------------------------------------------------------
create or replace function public._companion_log(
  p_owner uuid, p_task uuid, p_level text, p_event text, p_message text, p_details jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.companion_logs (owner_id, task_id, level, event, message, details)
  values (p_owner, p_task, coalesce(p_level, 'info'), p_event, left(p_message, 2000), coalesce(p_details, '{}'::jsonb))
$$;

create or replace function public._companion_has_scope(p_user uuid, p_scope text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.companion_permissions p
    where p.user_id = p_user and p.scope = p_scope and p.granted
  )
$$;

-- Faz uma pergunta. Se for bloqueante, pausa só a tarefa afetada.
-- Rota pela urgência (seção 5.5/5.7 da especificação) e pelo modo da pessoa:
-- em "Só quando chamado" e "Trabalhador em segundo plano" o Claude só pede
-- atenção quando a dúvida bloqueia o trabalho; as demais vão para as pendências.
create or replace function public._companion_ask(
  p_task uuid, p_question text, p_options jsonb, p_urgency text, p_blocking boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.companion_tasks%rowtype;
  v_id uuid;
  v_route text;
  v_mode text;
begin
  select * into v_task from public.companion_tasks where id = p_task;
  if not found then
    raise exception 'Tarefa não encontrada';
  end if;

  select s.mode into v_mode from public.companion_settings s where s.user_id = v_task.owner_id;
  v_mode := coalesce(v_mode, 'hibrido');

  v_route := case
    when not coalesce(p_blocking, true) and v_mode in ('quando_chamado', 'segundo_plano') then 'pendencias'
    when coalesce(p_urgency, 'media') in ('alta', 'media') then 'notificacao'
    when coalesce(p_blocking, true) then 'chat_tarefas'
    else 'pendencias'
  end;

  insert into public.companion_questions (task_id, owner_id, question, options, urgency, route, blocking)
  values (p_task, v_task.owner_id, p_question, coalesce(p_options, '[]'::jsonb), coalesce(p_urgency, 'media'), v_route, coalesce(p_blocking, true))
  returning id into v_id;

  if coalesce(p_blocking, true) then
    update public.companion_tasks
    set status = 'aguardando_confirmacao', blocked_reason = 'Aguardando sua resposta'
    where id = p_task and status = 'executando';
  end if;

  if v_route = 'notificacao' then
    perform public._notify(v_task.owner_id, 'question', 'Claude precisa de uma decisão: ' || v_task.title, left(p_question, 300),
      jsonb_build_object('task_id', p_task, 'question_id', v_id));
  end if;

  perform public._companion_log(v_task.owner_id, p_task, 'info', 'question.created',
    'Pergunta registrada (' || coalesce(p_urgency, 'media') || ', ' || case when coalesce(p_blocking, true) then 'bloqueante' else 'não bloqueante' end || ')',
    jsonb_build_object('question_id', v_id, 'route', v_route, 'mode', v_mode));

  return v_id;
end
$$;

-- Pega a próxima tarefa que pode rodar (respeita limite de simultâneas e travas de recurso).
create or replace function public._companion_claim(p_task uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.companion_tasks%rowtype;
  v_running integer;
  v_limit integer;
begin
  select * into v_task from public.companion_tasks where id = p_task for update;
  if not found or v_task.status <> 'aguardando' then
    return false;
  end if;

  select coalesce(s.max_concurrent_tasks, 2) into v_limit
  from public.companion_settings s where s.user_id = v_task.owner_id;
  v_limit := coalesce(v_limit, 2);

  select count(*) into v_running from public.companion_tasks t
  where t.owner_id = v_task.owner_id and t.status = 'executando';

  if v_running >= v_limit then
    update public.companion_tasks set progress_note = 'Na fila: limite de ' || v_limit || ' tarefas simultâneas' where id = p_task;
    return false;
  end if;

  begin
    update public.companion_tasks
    set status = 'executando', started_at = coalesce(started_at, now()), heartbeat_at = now(),
        blocked_reason = null, attempts = attempts + 1, progress_note = null
    where id = p_task;
  exception when unique_violation then
    update public.companion_tasks
    set progress_note = 'Na fila: outra tarefa está usando o mesmo recurso (' || v_task.resource_key || ')'
    where id = p_task;
    perform public._companion_log(v_task.owner_id, p_task, 'aviso', 'task.resource_busy',
      'Aguardando liberação do recurso ' || v_task.resource_key);
    return false;
  end;

  perform public._companion_log(v_task.owner_id, p_task, 'info', 'task.started', 'Tarefa iniciada');
  return true;
end
$$;

-- ---------------------------------------------------------------------
-- RPCs para o app (sempre do próprio usuário)
-- ---------------------------------------------------------------------
create or replace function public.companion_create_task(
  p_title text,
  p_instructions text,
  p_project uuid default null,
  p_priority text default 'media',
  p_required_scopes text[] default '{}'::text[],
  p_resource_key text default null,
  p_max_steps integer default 30
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_server uuid;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Faça login.' using errcode = '28000';
  end if;
  if not public._can_use_claude(v_uid) then
    raise exception 'Seu acesso ao Claude ainda não foi liberado pelo administrador do NEXUS.' using errcode = '42501';
  end if;
  if p_project is not null then
    select p.server_id into v_server from public.projects p where p.id = p_project;
    if v_server is null or not public._has_server_perm(v_server, v_uid, 'view_projects') then
      raise exception 'Projeto não encontrado ou sem acesso.' using errcode = '42501';
    end if;
  end if;
  if (select count(*) from public.companion_tasks t where t.owner_id = v_uid and t.status in ('aguardando', 'executando', 'aguardando_confirmacao', 'bloqueada')) >= 20 then
    raise exception 'Limite de 20 tarefas abertas. Conclua ou cancele alguma antes.' using errcode = 'P0001';
  end if;

  insert into public.companion_tasks (owner_id, server_id, project_id, title, instructions, priority, required_scopes, resource_key, max_steps)
  values (v_uid, v_server, p_project, btrim(p_title), p_instructions, coalesce(p_priority, 'media'),
          coalesce(p_required_scopes, '{}'::text[]), nullif(btrim(coalesce(p_resource_key, '')), ''), least(greatest(coalesce(p_max_steps, 30), 1), 200))
  returning id into v_id;

  perform public._companion_log(v_uid, v_id, 'info', 'task.created', 'Tarefa criada: ' || btrim(p_title));
  return v_id;
end
$$;

create or replace function public.companion_task_action(p_task uuid, p_action text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_task public.companion_tasks%rowtype;
  v_new text;
begin
  select * into v_task from public.companion_tasks where id = p_task and owner_id = v_uid for update;
  if not found then
    raise exception 'Tarefa não encontrada.' using errcode = 'P0002';
  end if;

  if p_action = 'cancelar' and v_task.status in ('aguardando', 'executando', 'aguardando_confirmacao', 'bloqueada') then
    v_new := 'cancelada';
    update public.companion_tasks set status = v_new, finished_at = now(), blocked_reason = null where id = p_task;
    update public.companion_questions set status = 'descartada' where task_id = p_task and status = 'pendente';
  elsif p_action = 'pausar' and v_task.status in ('aguardando', 'executando') then
    v_new := 'bloqueada';
    update public.companion_tasks set status = v_new, blocked_reason = 'Pausada por você' where id = p_task;
  elsif p_action = 'retomar' and v_task.status = 'bloqueada' then
    if exists (select 1 from public.companion_questions q where q.task_id = p_task and q.status = 'pendente' and q.blocking) then
      v_new := 'aguardando_confirmacao';
      update public.companion_tasks set status = v_new, blocked_reason = 'Aguardando sua resposta' where id = p_task;
    else
      v_new := 'aguardando';
      update public.companion_tasks set status = v_new, blocked_reason = null where id = p_task;
    end if;
  elsif p_action = 'repetir' and v_task.status in ('falhou', 'cancelada') then
    v_new := 'aguardando';
    update public.companion_tasks
    set status = v_new, error = null, finished_at = null, blocked_reason = null, progress = 0, progress_note = null,
        steps = 0, state = '{}'::jsonb
    where id = p_task;
  else
    raise exception 'Ação "%" não é possível com a tarefa no estado "%".', p_action, v_task.status using errcode = 'P0001';
  end if;

  perform public._companion_log(v_uid, p_task, 'info', 'task.' || p_action,
    'Você escolheu ' || p_action || ': ' || v_task.status || ' → ' || v_new);
  return v_new;
end
$$;

create or replace function public.companion_answer_question(p_question uuid, p_answer text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_q public.companion_questions%rowtype;
begin
  select * into v_q from public.companion_questions where id = p_question and owner_id = v_uid for update;
  if not found then
    raise exception 'Pergunta não encontrada.' using errcode = 'P0002';
  end if;
  if v_q.status <> 'pendente' then
    raise exception 'Esta pergunta já foi respondida ou descartada.' using errcode = 'P0001';
  end if;
  if btrim(coalesce(p_answer, '')) = '' then
    raise exception 'Escreva uma resposta.' using errcode = 'P0001';
  end if;

  update public.companion_questions set status = 'respondida', answer = btrim(p_answer), answered_at = now() where id = p_question;

  -- Se não houver outras perguntas bloqueantes pendentes, a tarefa volta para a fila.
  if v_q.task_id is not null and not exists (
    select 1 from public.companion_questions q
    where q.task_id = v_q.task_id and q.status = 'pendente' and q.blocking
  ) then
    update public.companion_tasks set status = 'aguardando', blocked_reason = null
    where id = v_q.task_id and status = 'aguardando_confirmacao';
  end if;

  perform public._companion_log(v_uid, v_q.task_id, 'info', 'question.answered', 'Você respondeu uma pergunta do Claude',
    jsonb_build_object('question_id', p_question));
end
$$;

create or replace function public.companion_set_permission(p_scope text, p_granted boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Faça login.' using errcode = '28000';
  end if;
  if not (p_scope = any (public.companion_scopes())) then
    raise exception 'Permissão desconhecida: %', p_scope using errcode = 'P0001';
  end if;
  insert into public.companion_permissions (user_id, scope, granted, updated_at)
  values (v_uid, p_scope, coalesce(p_granted, false), now())
  on conflict (user_id, scope) do update set granted = excluded.granted, updated_at = now();

  perform public._companion_log(v_uid, null, 'info',
    case when p_granted then 'permission.granted' else 'permission.revoked' end,
    case when p_granted then 'Permissão concedida: ' else 'Permissão revogada: ' end || p_scope);
end
$$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.companion_settings enable row level security;
alter table public.companion_permissions enable row level security;
alter table public.companion_tasks enable row level security;
alter table public.companion_questions enable row level security;
alter table public.companion_logs enable row level security;

create policy companion_settings_own on public.companion_settings for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke update on public.companion_settings from anon, authenticated;
grant update (mode, max_concurrent_tasks, voice_enabled, transcript_retention_days) on public.companion_settings to authenticated;

create policy companion_permissions_select on public.companion_permissions for select to authenticated
  using (user_id = auth.uid());
-- Alterações só pela RPC (que registra em log).
revoke insert, update, delete on public.companion_permissions from anon, authenticated;

create policy companion_tasks_select on public.companion_tasks for select to authenticated
  using (owner_id = auth.uid());
create policy companion_tasks_delete on public.companion_tasks for delete to authenticated
  using (owner_id = auth.uid() and status in ('concluida', 'falhou', 'cancelada'));
revoke insert, update on public.companion_tasks from anon, authenticated;

create policy companion_questions_select on public.companion_questions for select to authenticated
  using (owner_id = auth.uid());
revoke insert, update, delete on public.companion_questions from anon, authenticated;

create policy companion_logs_select on public.companion_logs for select to authenticated
  using (owner_id = auth.uid());
create policy companion_logs_delete on public.companion_logs for delete to authenticated
  using (owner_id = auth.uid());
revoke insert, update on public.companion_logs from anon, authenticated;

revoke execute on function public._companion_log(uuid, uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public._companion_has_scope(uuid, text) from public, anon, authenticated;
revoke execute on function public._companion_ask(uuid, text, jsonb, text, boolean) from public, anon, authenticated;
revoke execute on function public._companion_claim(uuid) from public, anon, authenticated;
grant execute on function public._companion_log(uuid, uuid, text, text, text, jsonb) to service_role;
grant execute on function public._companion_has_scope(uuid, text) to service_role;
grant execute on function public._companion_ask(uuid, text, jsonb, text, boolean) to service_role;
grant execute on function public._companion_claim(uuid) to service_role;

revoke execute on function public.companion_create_task(text, text, uuid, text, text[], text, integer) from public, anon;
revoke execute on function public.companion_task_action(uuid, text) from public, anon;
revoke execute on function public.companion_answer_question(uuid, text) from public, anon;
revoke execute on function public.companion_set_permission(text, boolean) from public, anon;
grant execute on function public.companion_create_task(text, text, uuid, text, text[], text, integer) to authenticated;
grant execute on function public.companion_task_action(uuid, text) to authenticated;
grant execute on function public.companion_answer_question(uuid, text) to authenticated;
grant execute on function public.companion_set_permission(text, boolean) to authenticated;
