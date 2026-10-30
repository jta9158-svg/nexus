-- =====================================================================
-- NEXUS — 0004 Claude AI: conversas, mensagens, uso e controle de acesso
-- A chave da API da Anthropic fica SOMENTE nos segredos das Edge
-- Functions (nunca no app). Quem paga é o operador do NEXUS, por isso o
-- acesso é liberado explicitamente.
-- =====================================================================

create table public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  title text not null default 'Nova conversa' check (char_length(title) between 1 and 120),
  server_id uuid references public.servers (id) on delete set null,
  project_id uuid references public.projects (id) on delete set null,
  model text,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index ai_conversations_owner_idx on public.ai_conversations (owner_id, updated_at desc);

create trigger ai_conversations_touch before update on public.ai_conversations
  for each row execute function public.touch_updated_at();

create table public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null default '',
  attachments jsonb not null default '[]'::jsonb,
  status text not null default 'done' check (status in ('streaming', 'done', 'error', 'cancelled')),
  error text,
  model text,
  input_tokens integer,
  output_tokens integer,
  created_at timestamptz not null default now()
);

create index ai_messages_conversation_idx on public.ai_messages (conversation_id, created_at);

-- Uso diário por pessoa (tokens e custo estimado em USD).
create table public.ai_usage (
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null default ((now() at time zone 'utc')::date),
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  requests integer not null default 0,
  primary key (user_id, day)
);

-- Liberação individual de uso do Claude (além dos administradores).
create table public.ai_access (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  daily_token_limit integer check (daily_token_limit is null or daily_token_limit >= 0),
  granted_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

-- Pedidos de @Claude em canais (evita respostas duplicadas para a mesma mensagem).
create table public.claude_channel_requests (
  message_id uuid primary key references public.messages (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  requested_by uuid references public.profiles (id) on delete set null,
  reply_message_id uuid references public.messages (id) on delete set null,
  status text not null default 'pendente' check (status in ('pendente', 'respondido', 'erro', 'negado')),
  error text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Regras de acesso
-- ---------------------------------------------------------------------

-- Pode usar o Claude em conversas pessoais?
create or replace function public._can_use_claude(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user is not null and (
    exists (select 1 from public.app_admins a where a.user_id = p_user)
    or exists (select 1 from public.ai_access x where x.user_id = p_user)
    or exists (
      -- Cargo com "use_claude" em servidor cujo dono é administrador do app
      select 1
      from public.server_members sm
      join public.servers s on s.id = sm.server_id
      join public.app_admins a on a.user_id = s.owner_id
      where sm.user_id = p_user
        and public._has_server_perm(sm.server_id, p_user, 'use_claude')
    )
  )
$$;

-- Pode chamar @Claude neste servidor?
create or replace function public._can_use_claude_in_server(p_server uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public._has_server_perm(p_server, p_user, 'use_claude')
     and (
       exists (select 1 from public.servers s join public.app_admins a on a.user_id = s.owner_id where s.id = p_server)
       or exists (select 1 from public.ai_access x where x.user_id = p_user)
       or exists (select 1 from public.app_admins a where a.user_id = p_user)
     )
$$;

create or replace function public.can_use_claude()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public._can_use_claude(auth.uid())
$$;

create or replace function public.can_use_claude_in_server(p_server uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public._can_use_claude_in_server(p_server, auth.uid())
$$;

-- Limite diário de tokens restante (null = sem acesso).
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
    reason := 'Seu acesso ao Claude ainda não foi liberado pelo administrador do NEXUS.';
  elsif exists (select 1 from public.app_admins a where a.user_id = p_user) then
    -- Administradores só são limitados pelo orçamento mensal.
    null;
  elsif v_used >= v_limit then
    allowed := false;
    reason := 'Você atingiu o limite diário de uso do Claude. Ele renova à meia-noite (UTC).';
  end if;
  if allowed and v_month_cost >= v_budget then
    allowed := false;
    reason := 'O orçamento mensal do Claude definido pelo administrador foi atingido.';
  end if;

  daily_limit := v_limit;
  used_today := v_used;
  remaining := greatest(v_limit - v_used, 0);
  month_cost_usd := v_month_cost;
  month_budget_usd := v_budget;
  return next;
end
$$;

create or replace function public.my_claude_quota()
returns table (allowed boolean, daily_limit bigint, used_today bigint, remaining bigint, month_cost_usd numeric, month_budget_usd numeric, reason text)
language sql
stable
security definer
set search_path = ''
as $$
  select * from public._claude_quota(auth.uid())
$$;

-- Registro de uso (chamado pelas Edge Functions com a service role).
create or replace function public._record_ai_usage(p_user uuid, p_input bigint, p_output bigint, p_cost numeric)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.ai_usage (user_id, day, input_tokens, output_tokens, cost_usd, requests)
  values (p_user, (now() at time zone 'utc')::date, greatest(p_input, 0), greatest(p_output, 0), greatest(p_cost, 0), 1)
  on conflict (user_id, day) do update set
    input_tokens = public.ai_usage.input_tokens + excluded.input_tokens,
    output_tokens = public.ai_usage.output_tokens + excluded.output_tokens,
    cost_usd = public.ai_usage.cost_usd + excluded.cost_usd,
    requests = public.ai_usage.requests + 1
$$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;
alter table public.ai_usage enable row level security;
alter table public.ai_access enable row level security;
alter table public.claude_channel_requests enable row level security;

create policy ai_conversations_select on public.ai_conversations for select to authenticated
  using (owner_id = auth.uid());
create policy ai_conversations_insert on public.ai_conversations for insert to authenticated
  with check (
    owner_id = auth.uid()
    and (server_id is null or public.is_server_member(server_id))
    and (project_id is null or exists (
      select 1 from public.projects p where p.id = project_id and public.has_server_perm(p.server_id, 'view_projects')))
  );
create policy ai_conversations_update on public.ai_conversations for update to authenticated
  using (owner_id = auth.uid())
  with check (
    owner_id = auth.uid()
    and (project_id is null or exists (
      select 1 from public.projects p where p.id = project_id and public.has_server_perm(p.server_id, 'view_projects')))
  );
create policy ai_conversations_delete on public.ai_conversations for delete to authenticated
  using (owner_id = auth.uid());
revoke update on public.ai_conversations from anon, authenticated;
grant update (title, server_id, project_id, archived) on public.ai_conversations to authenticated;

create policy ai_messages_select on public.ai_messages for select to authenticated
  using (exists (select 1 from public.ai_conversations c where c.id = conversation_id and c.owner_id = auth.uid()));
-- Mensagens do Claude são gravadas somente pelo servidor (Edge Function).
revoke insert, update, delete on public.ai_messages from anon, authenticated;

create policy ai_usage_select on public.ai_usage for select to authenticated
  using (user_id = auth.uid() or public.is_app_admin());
revoke insert, update, delete on public.ai_usage from anon, authenticated;

create policy ai_access_select on public.ai_access for select to authenticated
  using (user_id = auth.uid() or public.is_app_admin());
create policy ai_access_admin on public.ai_access for all to authenticated
  using (public.is_app_admin()) with check (public.is_app_admin());

create policy claude_requests_select on public.claude_channel_requests for select to authenticated
  using (public.can_view_channel(channel_id));
revoke insert, update, delete on public.claude_channel_requests from anon, authenticated;

revoke execute on function public._can_use_claude(uuid) from public, anon, authenticated;
revoke execute on function public._can_use_claude_in_server(uuid, uuid) from public, anon, authenticated;
revoke execute on function public._claude_quota(uuid) from public, anon, authenticated;
revoke execute on function public._record_ai_usage(uuid, bigint, bigint, numeric) from public, anon, authenticated;
grant execute on function public._can_use_claude(uuid) to service_role;
grant execute on function public._can_use_claude_in_server(uuid, uuid) to service_role;
grant execute on function public._claude_quota(uuid) to service_role;
grant execute on function public._record_ai_usage(uuid, bigint, bigint, numeric) to service_role;
revoke execute on function public.my_claude_quota() from public, anon;
grant execute on function public.my_claude_quota() to authenticated;
