-- =====================================================================
-- NEXUS — "Serviços" só nos servidores de jogos e o assistente vira "NEXUS IA"
--  * servers.services_enabled: mostra Faturamento Roblox, Projetos, Finanças
--    e Arquivos. Ligado nos modelos "Jogos" e "Estúdio de jogos"; o dono
--    (ou quem gerencia o servidor) liga/desliga nas configurações.
--  * O assistente (feito com o Claude, da Anthropic) aparece como "NEXUS IA":
--    @NEXUS chama a IA no canal (o @Claude continua funcionando) e os avisos
--    usam o nome novo.
-- =====================================================================

alter table public.servers
  add column if not exists services_enabled boolean not null default false;

-- Servidores que já existem: liga onde há cara de estúdio de jogos.
update public.servers s
set services_enabled = true
where not s.services_enabled
  and exists (
    select 1 from public.channels c
    where c.server_id = s.id and c.kind = 'text' and c.name in ('desenvolvimento', 'bugs', 'procurando-grupo')
  );

grant update (services_enabled) on public.servers to authenticated;


-- Criar servidor: liga os Serviços nos modelos de jogos.
create or replace function public.create_server(
  p_name text,
  p_template text default 'estudio',
  p_is_public boolean default false,
  p_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_sid uuid;
  v_tpl text := coalesce(nullif(btrim(p_template), ''), 'estudio');
  v_info uuid;
  v_text uuid;
  v_voice uuid;
begin
  if v_uid is null then
    raise exception 'Faça login para criar um servidor.' using errcode = '28000';
  end if;
  if v_tpl not in ('estudio', 'simples', 'amigos', 'jogos', 'estudo') then
    raise exception 'Modelo de servidor desconhecido.' using errcode = '22023';
  end if;
  if (select count(*) from public.servers s where s.owner_id = v_uid) >= 25 then
    raise exception 'Limite de 25 servidores por pessoa atingido.' using errcode = 'P0001';
  end if;

  insert into public.servers (name, description, owner_id, services_enabled)
  values (btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''), v_uid, v_tpl in ('estudio', 'jogos'))
  returning id into v_sid;

  insert into public.server_members (server_id, user_id) values (v_sid, v_uid);

  insert into public.roles (server_id, name, position, permissions, is_default, hoist)
  values (v_sid, '@todos', 0,
          array['send_messages', 'attach_files', 'connect_voice', 'speak', 'video', 'share_screen',
                'create_invites', 'view_projects', 'view_files', 'view_roblox'],
          true, false);

  insert into public.roles (server_id, name, color, position, permissions)
  values (v_sid, 'Admin', '#F59E0B', 100, array['admin']);

  if v_tpl = 'estudio' then
    insert into public.roles (server_id, name, color, position, permissions) values
      (v_sid, 'Desenvolvedor', '#22C55E', 50, array['manage_projects', 'manage_files', 'use_claude']),
      (v_sid, 'Scripter', '#38BDF8', 40, array['manage_projects', 'use_claude']),
      (v_sid, 'Modelador', '#F472B6', 30, array['manage_files']),
      (v_sid, 'Tester', '#A78BFA', 20, array[]::text[]);
  elsif v_tpl in ('amigos', 'jogos', 'estudo') then
    insert into public.roles (server_id, name, color, position, permissions)
    values (v_sid, 'Moderador', '#14B8A6', 60,
            array['kick_members', 'ban_members', 'manage_messages', 'move_members', 'mention_everyone']);
  end if;

  if v_tpl in ('estudio', 'jogos', 'estudo') then
    insert into public.channel_categories (server_id, name, position) values (v_sid, 'Informações', 0) returning id into v_info;
  end if;
  insert into public.channel_categories (server_id, name, position) values (v_sid, 'Canais de texto', 1) returning id into v_text;
  insert into public.channel_categories (server_id, name, position) values (v_sid, 'Canais de voz', 2) returning id into v_voice;

  if v_tpl = 'estudio' then
    insert into public.channels (server_id, category_id, name, kind, topic, position) values
      (v_sid, v_text, 'geral', 'text', 'Chat da equipe, mensagens, arquivos e comunicação.', 0),
      (v_sid, v_info, 'anúncios', 'text', 'Avisos importantes da equipe.', 1),
      (v_sid, v_text, 'desenvolvimento', 'text', 'Scripts, sistemas e builds.', 2),
      (v_sid, v_text, 'ideias', 'text', 'Ideias para o jogo.', 3),
      (v_sid, v_text, 'bugs', 'text', 'Relatos de bugs e correções.', 4),
      (v_sid, v_text, 'equipe', 'text', 'Organização da equipe.', 5),
      (v_sid, v_voice, 'Geral', 'voice', null, 10),
      (v_sid, v_voice, 'Call da Equipe', 'voice', null, 11),
      (v_sid, v_voice, 'Trabalho', 'voice', null, 12),
      (v_sid, v_voice, 'Reuniões', 'voice', null, 13);
  elsif v_tpl = 'amigos' then
    insert into public.channels (server_id, category_id, name, kind, topic, position) values
      (v_sid, v_text, 'geral', 'text', 'Conversa geral.', 0),
      (v_sid, v_text, 'memes', 'text', 'Coisas engraçadas.', 1),
      (v_sid, v_text, 'clipes-e-prints', 'text', 'Os melhores momentos.', 2),
      (v_sid, v_voice, 'Bate-papo', 'voice', null, 10),
      (v_sid, v_voice, 'Jogando', 'voice', null, 11);
  elsif v_tpl = 'jogos' then
    insert into public.channels (server_id, category_id, name, kind, topic, position) values
      (v_sid, v_info, 'regras', 'text', 'Leia antes de participar.', 0),
      (v_sid, v_info, 'anúncios', 'text', 'Novidades do grupo.', 1),
      (v_sid, v_text, 'geral', 'text', 'Conversa geral.', 2),
      (v_sid, v_text, 'procurando-grupo', 'text', 'Ache gente para jogar.', 3),
      (v_sid, v_text, 'clipes', 'text', 'Jogadas e prints.', 4),
      (v_sid, v_voice, 'Lobby', 'voice', null, 10),
      (v_sid, v_voice, 'Partida 1', 'voice', null, 11),
      (v_sid, v_voice, 'Partida 2', 'voice', null, 12);
  elsif v_tpl = 'estudo' then
    insert into public.channels (server_id, category_id, name, kind, topic, position) values
      (v_sid, v_info, 'avisos', 'text', 'Avisos e datas importantes.', 0),
      (v_sid, v_info, 'materiais', 'text', 'Links, PDFs e resumos.', 1),
      (v_sid, v_text, 'geral', 'text', 'Conversa geral.', 2),
      (v_sid, v_text, 'dúvidas', 'text', 'Pergunte aqui.', 3),
      (v_sid, v_text, 'tarefas', 'text', 'Trabalhos e prazos.', 4),
      (v_sid, v_voice, 'Sala de estudo', 'voice', null, 10),
      (v_sid, v_voice, 'Foco total', 'voice', null, 11);
  else
    insert into public.channels (server_id, category_id, name, kind, topic, position) values
      (v_sid, v_text, 'geral', 'text', 'Conversa geral.', 0),
      (v_sid, v_voice, 'Geral', 'voice', null, 10);
  end if;

  update public.servers
  set system_channel_id = (select c.id from public.channels c where c.server_id = v_sid and c.kind = 'text' and c.name = 'geral' limit 1)
  where id = v_sid;

  return v_sid;
end
$$;

-- @NEXUS (ou @Claude) chama a IA no canal.
create or replace function public.messages_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
begin
  if tg_op = 'INSERT' then
    if new.channel_id is not null then
      select c.server_id, c.kind into new.server_id, v_kind from public.channels c where c.id = new.channel_id;
      if v_kind is distinct from 'text' then
        raise exception 'Mensagens só podem ser enviadas em canais de texto.' using errcode = 'P0001';
      end if;
    else
      new.server_id := null;
    end if;
    if new.author_kind = 'user' then
      new.meta := '{}'::jsonb;
    end if;
    new.edited_at := null;
    new.created_at := now();
  else
    -- UPDATE: apenas o conteúdo pode mudar via cliente (privilégios por coluna).
    if new.content is distinct from old.content and new.author_kind = 'user' then
      new.edited_at := now();
    end if;
  end if;

  if btrim(new.content) = '' and jsonb_array_length(new.attachments) = 0 and new.author_kind = 'user' then
    raise exception 'A mensagem está vazia.' using errcode = 'P0001';
  end if;

  -- Menções a pessoas: @usuario (apenas quem participa do canal/conversa).
  select coalesce(array_agg(distinct p.id), '{}'::uuid[])
  into new.mentions
  from regexp_matches(new.content, '(?:^|[^A-Za-z0-9_.@])@([A-Za-z0-9_](?:[A-Za-z0-9_.]{1,30}[A-Za-z0-9_]))', 'g') as m(tok)
  join public.profiles p on p.username = lower(m.tok[1])
  where (new.channel_id is not null and public._can_view_channel(new.channel_id, p.id))
     or (new.dm_thread_id is not null and public._is_dm_participant(new.dm_thread_id, p.id));

  new.mentions_claude := new.author_kind = 'user'
    and new.content ~* '(^|[^a-z0-9_.@])@(claude|nexus)([^a-z0-9_]|$)';

  new.mentions_everyone := new.channel_id is not null
    and new.author_kind = 'user'
    and new.content ~* '(^|[^a-z0-9_.@])@(todos|everyone)([^a-z0-9_]|$)'
    and public._has_server_perm(new.server_id, new.author_id, 'mention_everyone');

  return new;
end
$$;

-- Avisos com o nome novo.
create or replace function public.messages_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_author text;
  v_channel text;
  v_preview text;
  v_link jsonb;
begin
  v_author := coalesce(
    (select p.display_name from public.profiles p where p.id = new.author_id),
    case new.author_kind when 'claude' then 'NEXUS IA' else 'Sistema' end
  );
  v_preview := case
    when btrim(new.content) <> '' then left(new.content, 160)
    else '📎 Anexo'
  end;

  if new.dm_thread_id is not null then
    update public.dm_threads set last_message_at = new.created_at where id = new.dm_thread_id;
    update public.dm_participants set hidden = false where thread_id = new.dm_thread_id and hidden;
    v_link := jsonb_build_object('dm_thread_id', new.dm_thread_id, 'message_id', new.id);
    perform public._notify(d.user_id, 'dm', v_author || ' enviou uma mensagem', v_preview, v_link)
    from public.dm_participants d
    where d.thread_id = new.dm_thread_id and d.user_id is distinct from new.author_id;
    return new;
  end if;

  select c.name into v_channel from public.channels c where c.id = new.channel_id;
  v_link := jsonb_build_object('server_id', new.server_id, 'channel_id', new.channel_id, 'message_id', new.id);

  -- Menções diretas
  perform public._notify(u, 'mention', v_author || ' mencionou você em #' || v_channel, v_preview, v_link)
  from unnest(new.mentions) as u
  where u is distinct from new.author_id;

  -- @todos (limitado a 500 pessoas por mensagem)
  if new.mentions_everyone then
    perform public._notify(m.user_id, 'mention', v_author || ' mencionou @todos em #' || v_channel, v_preview, v_link)
    from (
      select sm.user_id
      from public.server_members sm
      where sm.server_id = new.server_id
        and sm.user_id is distinct from new.author_id
        and not (sm.user_id = any (new.mentions))
        and public._can_view_channel(new.channel_id, sm.user_id)
      limit 500
    ) m;
  end if;

  return new;
end
$$;

create or replace function public._claude_quota(p_user uuid)
returns table (allowed boolean, daily_limit bigint, used_today bigint, remaining bigint, month_cost_usd numeric, month_budget_usd numeric, reason text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit bigint;
  v_used bigint;
  v_month_cost numeric;
  v_budget numeric;
begin
  select coalesce(x.daily_token_limit, s.claude_daily_tokens_per_user), s.claude_monthly_budget_usd
  into v_limit, v_budget
  from public.app_settings s
  left join public.ai_access x on x.user_id = p_user;

  select coalesce(sum(u.input_tokens + u.output_tokens), 0) into v_used
  from public.ai_usage u
  where u.user_id = p_user and u.day = (now() at time zone 'utc')::date;

  select coalesce(sum(u.cost_usd), 0) into v_month_cost
  from public.ai_usage u
  where u.day >= date_trunc('month', now() at time zone 'utc')::date;

  allowed := true;
  reason := null;
  if not public._can_use_claude(p_user) then
    allowed := false;
    reason := 'Seu acesso à NEXUS IA ainda não foi liberado pelo administrador do NEXUS.';
  elsif exists (select 1 from public.app_admins a where a.user_id = p_user) then
    -- Administradores só são limitados pelo orçamento mensal.
    null;
  elsif v_used >= v_limit then
    allowed := false;
    reason := 'Você atingiu o limite diário de uso da NEXUS IA. O limite renova à meia-noite (UTC).';
  end if;
  if allowed and v_month_cost >= v_budget then
    allowed := false;
    reason := 'O orçamento mensal da NEXUS IA definido pelo administrador foi atingido.';
  end if;

  daily_limit := v_limit;
  used_today := v_used;
  remaining := greatest(v_limit - v_used, 0);
  month_cost_usd := v_month_cost;
  month_budget_usd := v_budget;
  return next;
end
$$;

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
    perform public._notify(v_task.owner_id, 'question', 'A NEXUS IA precisa de uma decisão: ' || v_task.title, left(p_question, 300),
      jsonb_build_object('task_id', p_task, 'question_id', v_id));
  end if;

  perform public._companion_log(v_task.owner_id, p_task, 'info', 'question.created',
    'Pergunta registrada (' || coalesce(p_urgency, 'media') || ', ' || case when coalesce(p_blocking, true) then 'bloqueante' else 'não bloqueante' end || ')',
    jsonb_build_object('question_id', v_id, 'route', v_route, 'mode', v_mode));

  return v_id;
end
$$;

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
    raise exception 'Seu acesso à NEXUS IA ainda não foi liberado pelo administrador do NEXUS.' using errcode = '42501';
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

  perform public._companion_log(v_uid, v_q.task_id, 'info', 'question.answered', 'Você respondeu uma pergunta da NEXUS IA',
    jsonb_build_object('question_id', p_question));
end
$$;

create or replace function public._voice_invite_check(p_channel uuid, p_user uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_server uuid;
  v_ready boolean;
begin
  select c.server_id into v_server from public.channels c where c.id = p_channel and c.kind = 'voice';
  if v_server is null then
    return 'Canal de voz não encontrado.';
  end if;
  select coalesce(s.voice_agent_ready, false) into v_ready from public.app_settings s;
  if not coalesce(v_ready, false) then
    return 'O serviço de voz da NEXUS IA ainda não foi ativado pelo administrador do NEXUS.';
  end if;
  if not public._can_join_voice(p_channel, p_user) then
    return 'Você não tem permissão para entrar nesta call.';
  end if;
  if not public._can_use_claude_in_server(v_server, p_user) then
    return 'Seu cargo neste servidor não permite usar a NEXUS IA.';
  end if;
  if not public._companion_has_scope(p_user, 'ouvir_call') or not public._companion_has_scope(p_user, 'falar_call') then
    return 'Libere "Ouvir calls" e "Falar nas calls" em NEXUS Companion → Permissões antes de chamar a NEXUS IA.';
  end if;
  return null;
end
$$;
