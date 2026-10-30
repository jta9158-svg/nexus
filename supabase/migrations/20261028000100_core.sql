-- =====================================================================
-- NEXUS — 0001 Núcleo: perfis, servidores, cargos, canais, convites
-- Banco: PostgreSQL (Supabase). Todas as tabelas usam RLS.
-- Convenções:
--   * Funções auxiliares usadas em políticas RLS usam auth.uid() e são
--     SECURITY DEFINER com search_path vazio (nomes totalmente qualificados).
--   * Funções internas com parâmetro de usuário começam com "_" e NÃO são
--     executáveis por anon/authenticated.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Utilitários
-- ---------------------------------------------------------------------
create or replace function public.try_uuid(p text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return p::uuid;
exception when others then
  return null;
end
$$;

create or replace function public.random_code(p_len integer default 10)
returns text
language sql
volatile
set search_path = ''
as $$
  select left(
    translate(encode(uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid()), 'base64'), '+/=', ''),
    greatest(4, least(p_len, 32))
  )
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

-- Lista oficial de permissões de cargos.
create or replace function public.all_permissions()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'admin',
    'manage_server', 'manage_channels', 'manage_roles',
    'create_invites', 'kick_members', 'ban_members',
    'send_messages', 'attach_files', 'manage_messages', 'mention_everyone',
    'connect_voice', 'speak', 'video', 'share_screen', 'move_members',
    'use_claude',
    'view_projects', 'manage_projects',
    'view_files', 'manage_files',
    'view_finance', 'manage_finance',
    'view_roblox'
  ]::text[]
$$;

-- Nomes de usuário reservados (não podem ser usados por pessoas).
create or replace function public.reserved_usernames()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['claude', 'todos', 'everyone', 'here', 'nexus', 'admin', 'sistema', 'system', 'suporte', 'support', 'anthropic']::text[]
$$;

-- ---------------------------------------------------------------------
-- Perfis (1:1 com auth.users)
-- ---------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique
    check (username ~ '^[a-z0-9_](?:[a-z0-9_.]{1,30}[a-z0-9_])$')
    check (not (username = any (public.reserved_usernames()))),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 48),
  avatar_url text check (avatar_url is null or char_length(avatar_url) <= 1000),
  bio text check (bio is null or char_length(bio) <= 300),
  accent_color text check (accent_color is null or accent_color ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Administradores do aplicativo (o operador do NEXUS). O primeiro usuário
-- cadastrado vira administrador automaticamente.
create table public.app_admins (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Configurações globais (linha única).
create table public.app_settings (
  id boolean primary key default true check (id),
  signup_open boolean not null default true,
  claude_model text not null default 'claude-sonnet-5-5',
  claude_task_model text not null default 'claude-opus-5-5',
  claude_daily_tokens_per_user integer not null default 300000 check (claude_daily_tokens_per_user >= 0),
  claude_monthly_budget_usd numeric(10, 2) not null default 50 check (claude_monthly_budget_usd >= 0),
  companion_max_concurrent_tasks integer not null default 2 check (companion_max_concurrent_tasks between 1 and 10),
  updated_at timestamptz not null default now()
);
insert into public.app_settings default values;

create trigger app_settings_touch before update on public.app_settings
  for each row execute function public.touch_updated_at();

-- Preferências pessoais (widgets da Visão Geral, notificações etc.).
create table public.user_settings (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object' and pg_column_size(data) < 32768),
  updated_at timestamptz not null default now()
);

create trigger user_settings_touch before update on public.user_settings
  for each row execute function public.touch_updated_at();

-- Cria o perfil quando alguém se cadastra.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base text;
  v_candidate text;
  v_tries integer := 0;
  v_display text;
begin
  v_base := lower(coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'username'), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'usuario'
  ));
  v_base := regexp_replace(v_base, '[^a-z0-9_.]', '', 'g');
  v_base := regexp_replace(v_base, '^[.]+|[.]+$', '', 'g');
  if char_length(v_base) < 3 then
    v_base := v_base || 'usuario';
  end if;
  v_base := left(v_base, 24);
  v_candidate := v_base;

  while v_candidate = any (public.reserved_usernames())
     or v_candidate !~ '^[a-z0-9_](?:[a-z0-9_.]{1,30}[a-z0-9_])$'
     or exists (select 1 from public.profiles p where p.username = v_candidate)
  loop
    v_tries := v_tries + 1;
    if v_tries > 25 then
      v_candidate := 'u' || left(replace(new.id::text, '-', ''), 30);
      exit;
    end if;
    v_candidate := regexp_replace(left(v_base, 24), '[.]+$', '') || (1000 + floor(random() * 9000))::integer::text;
  end loop;

  v_display := left(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), v_candidate), 48);

  insert into public.profiles (id, username, display_name)
  values (new.id, v_candidate, v_display);

  insert into public.user_settings (user_id) values (new.id);

  -- O primeiro usuário do sistema vira administrador do app.
  if not exists (select 1 from public.app_admins) then
    insert into public.app_admins (user_id) values (new.id);
  end if;

  return new;
end
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Disponibilidade de nome de usuário (usado no cadastro, inclusive por anon).
create or replace function public.username_available(p_username text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select lower(p_username) ~ '^[a-z0-9_](?:[a-z0-9_.]{1,30}[a-z0-9_])$'
     and not (lower(p_username) = any (public.reserved_usernames()))
     and not exists (select 1 from public.profiles p where p.username = lower(p_username))
$$;

create or replace function public.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.app_admins a where a.user_id = auth.uid())
$$;

-- ---------------------------------------------------------------------
-- Servidores, cargos e membros
-- ---------------------------------------------------------------------
create table public.servers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 64),
  description text check (description is null or char_length(description) <= 500),
  icon_url text check (icon_url is null or char_length(icon_url) <= 1000),
  banner_url text check (banner_url is null or char_length(banner_url) <= 1000),
  owner_id uuid not null references public.profiles (id) on delete restrict,
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index servers_owner_idx on public.servers (owner_id);
create index servers_public_idx on public.servers (is_public) where is_public;

create trigger servers_touch before update on public.servers
  for each row execute function public.touch_updated_at();

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.servers (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 32),
  color text check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  position integer not null default 0,
  permissions text[] not null default '{}'::text[] check (permissions <@ public.all_permissions()),
  is_default boolean not null default false,
  hoist boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, server_id)
);

create unique index roles_one_default_per_server on public.roles (server_id) where is_default;
create index roles_server_idx on public.roles (server_id);

create table public.server_members (
  server_id uuid not null references public.servers (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  nickname text check (nickname is null or char_length(btrim(nickname)) between 1 and 32),
  joined_at timestamptz not null default now(),
  primary key (server_id, user_id)
);

create index server_members_user_idx on public.server_members (user_id);

create table public.member_roles (
  server_id uuid not null,
  user_id uuid not null,
  role_id uuid not null,
  assigned_at timestamptz not null default now(),
  primary key (server_id, user_id, role_id),
  foreign key (server_id, user_id) references public.server_members (server_id, user_id) on delete cascade,
  foreign key (role_id, server_id) references public.roles (id, server_id) on delete cascade
);

create index member_roles_role_idx on public.member_roles (role_id);

create table public.server_bans (
  server_id uuid not null references public.servers (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  banned_by uuid references public.profiles (id) on delete set null,
  reason text check (reason is null or char_length(reason) <= 300),
  created_at timestamptz not null default now(),
  primary key (server_id, user_id)
);

-- ---------------------------------------------------------------------
-- Canais
-- ---------------------------------------------------------------------
create table public.channels (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.servers (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 48),
  kind text not null check (kind in ('text', 'voice')),
  topic text check (topic is null or char_length(topic) <= 300),
  position integer not null default 0,
  is_private boolean not null default false,
  user_limit integer check (user_limit is null or user_limit between 1 and 99),
  claude_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, server_id)
);

create index channels_server_idx on public.channels (server_id, position);

-- Quem pode acessar um canal privado (por cargo ou por pessoa).
create table public.channel_access (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels (id) on delete cascade,
  role_id uuid references public.roles (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  check ((role_id is null) <> (user_id is null)),
  unique nulls not distinct (channel_id, role_id, user_id)
);

create index channel_access_channel_idx on public.channel_access (channel_id);

-- ---------------------------------------------------------------------
-- Convites
-- ---------------------------------------------------------------------
create table public.invites (
  code text primary key default public.random_code(10) check (code ~ '^[A-Za-z0-9]{4,32}$'),
  server_id uuid not null references public.servers (id) on delete cascade,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  max_uses integer check (max_uses is null or max_uses between 1 and 1000),
  uses integer not null default 0,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create index invites_server_idx on public.invites (server_id);

-- ---------------------------------------------------------------------
-- Funções de permissão
-- ---------------------------------------------------------------------
create or replace function public._is_server_member(p_server uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user is not null and exists (
    select 1 from public.server_members m where m.server_id = p_server and m.user_id = p_user
  )
$$;

create or replace function public._user_permissions(p_server uuid, p_user uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_user is null then '{}'::text[]
    when exists (select 1 from public.servers s where s.id = p_server and s.owner_id = p_user)
      then public.all_permissions()
    when not exists (select 1 from public.server_members m where m.server_id = p_server and m.user_id = p_user)
      then '{}'::text[]
    else coalesce((
      select array_agg(distinct q.p)
      from (
        select unnest(r.permissions) as p
        from public.roles r
        where r.server_id = p_server and r.is_default
        union all
        select unnest(r.permissions)
        from public.member_roles mr
        join public.roles r on r.id = mr.role_id
        where mr.server_id = p_server and mr.user_id = p_user
      ) q
    ), '{}'::text[])
  end
$$;

create or replace function public._has_server_perm(p_server uuid, p_user uuid, p_perm text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_perm = any (perms) or 'admin' = any (perms)
  from (select public._user_permissions(p_server, p_user) as perms) x
$$;

-- Versão por colunas: usada nas políticas para funcionar também com a linha
-- recém-inserida (INSERT ... RETURNING), que ainda não é visível em consultas.
create or replace function public._can_view_channel_cols(p_channel uuid, p_server uuid, p_private boolean, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public._is_server_member(p_server, p_user)
     and (
       not p_private
       or public._has_server_perm(p_server, p_user, 'manage_channels')
       or exists (
         select 1 from public.channel_access a
         where a.channel_id = p_channel
           and (
             a.user_id = p_user
             or a.role_id in (select r.id from public.roles r where r.server_id = p_server and r.is_default)
             or a.role_id in (
               select mr.role_id from public.member_roles mr
               where mr.server_id = p_server and mr.user_id = p_user
             )
           )
       )
     )
$$;

create or replace function public._can_view_channel(p_channel uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select public._can_view_channel_cols(c.id, c.server_id, c.is_private, p_user)
    from public.channels c
    where c.id = p_channel
  ), false)
$$;

create or replace function public.can_view_channel_cols(p_channel uuid, p_server uuid, p_private boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public._can_view_channel_cols(p_channel, p_server, p_private, auth.uid())
$$;

-- Versões públicas (sempre para o usuário logado).
create or replace function public.is_server_member(p_server uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public._is_server_member(p_server, auth.uid())
$$;

create or replace function public.my_permissions(p_server uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select public._user_permissions(p_server, auth.uid())
$$;

create or replace function public.has_server_perm(p_server uuid, p_perm text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public._has_server_perm(p_server, auth.uid(), p_perm)
$$;

create or replace function public.can_view_channel(p_channel uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public._can_view_channel(p_channel, auth.uid())
$$;

create or replace function public.can_send_in_channel(p_channel uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.channels c
    where c.id = p_channel
      and c.kind = 'text'
      and public._can_view_channel(c.id, auth.uid())
      and public._has_server_perm(c.server_id, auth.uid(), 'send_messages')
  )
$$;

create or replace function public._can_join_voice(p_channel uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.channels c
    where c.id = p_channel
      and c.kind = 'voice'
      and public._can_view_channel(c.id, p_user)
      and public._has_server_perm(c.server_id, p_user, 'connect_voice')
  )
$$;

create or replace function public.shares_server_with(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.server_members a
    join public.server_members b on b.server_id = a.server_id
    where a.user_id = auth.uid() and b.user_id = p_user
  )
$$;

-- ---------------------------------------------------------------------
-- Gatilhos de integridade
-- ---------------------------------------------------------------------

-- O dono não pode sair nem ser removido do próprio servidor.
create or replace function public.protect_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.servers s where s.id = old.server_id and s.owner_id = old.user_id) then
    raise exception 'O dono não pode sair do próprio servidor. Transfira a posse ou exclua o servidor.'
      using errcode = 'P0001';
  end if;
  return old;
end
$$;

create trigger server_members_protect_owner
  before delete on public.server_members
  for each row execute function public.protect_owner_membership();

-- O cargo padrão (@todos) não pode ser excluído (exceto junto com o servidor).
create or replace function public.protect_default_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.is_default and exists (select 1 from public.servers s where s.id = old.server_id) then
    raise exception 'O cargo padrão não pode ser excluído.' using errcode = 'P0001';
  end if;
  return old;
end
$$;

create trigger roles_protect_default
  before delete on public.roles
  for each row execute function public.protect_default_role();

-- Impede escalada: só quem tem "admin" pode criar/editar cargos com "admin"
-- e não é possível transformar outro cargo em padrão.
-- SECURITY INVOKER de propósito: dentro das funções do sistema (SECURITY
-- DEFINER) o usuário atual é o dono do banco e a verificação é pulada;
-- alterações diretas feitas pelo app (papel "authenticated") são checadas.
create or replace function public.guard_role_changes()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.is_default is distinct from old.is_default then
    raise exception 'Não é possível alterar qual cargo é o padrão.' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' and new.is_default then
    raise exception 'O cargo padrão é criado automaticamente.' using errcode = '42501';
  end if;
  if ('admin' = any (new.permissions) or (tg_op = 'UPDATE' and 'admin' = any (old.permissions)))
     and not public.has_server_perm(new.server_id, 'admin') then
    raise exception 'Somente administradores podem gerenciar cargos com permissão de administrador.'
      using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger roles_guard
  before insert or update on public.roles
  for each row execute function public.guard_role_changes();

create or replace function public.guard_member_roles()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_is_default boolean;
  v_perms text[];
  v_row record;
begin
  if current_user not in ('authenticated', 'anon') then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    v_row := old;
  else
    v_row := new;
  end if;
  select r.is_default, r.permissions into v_is_default, v_perms from public.roles r where r.id = v_row.role_id;
  if v_is_default then
    raise exception 'O cargo padrão é implícito e não precisa ser atribuído.' using errcode = '42501';
  end if;
  if 'admin' = any (v_perms) and not public.has_server_perm(v_row.server_id, 'admin') then
    raise exception 'Somente administradores podem atribuir cargos de administrador.' using errcode = '42501';
  end if;
  return coalesce(new, old);
end
$$;

create trigger member_roles_guard
  before insert or delete on public.member_roles
  for each row execute function public.guard_member_roles();

-- ---------------------------------------------------------------------
-- RPCs (operações atômicas)
-- ---------------------------------------------------------------------
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
begin
  if v_uid is null then
    raise exception 'Faça login para criar um servidor.' using errcode = '28000';
  end if;
  if (select count(*) from public.servers s where s.owner_id = v_uid) >= 25 then
    raise exception 'Limite de 25 servidores por pessoa atingido.' using errcode = 'P0001';
  end if;

  insert into public.servers (name, description, owner_id, is_public)
  values (btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''), v_uid, coalesce(p_is_public, false))
  returning id into v_sid;

  insert into public.server_members (server_id, user_id) values (v_sid, v_uid);

  insert into public.roles (server_id, name, position, permissions, is_default, hoist)
  values (v_sid, '@todos', 0,
          array['send_messages', 'attach_files', 'connect_voice', 'speak', 'video', 'share_screen',
                'create_invites', 'view_projects', 'view_files', 'view_roblox'],
          true, false);

  insert into public.roles (server_id, name, color, position, permissions)
  values (v_sid, 'Admin', '#F59E0B', 100, array['admin']);

  if coalesce(p_template, 'estudio') = 'estudio' then
    insert into public.roles (server_id, name, color, position, permissions) values
      (v_sid, 'Desenvolvedor', '#22C55E', 50, array['manage_projects', 'manage_files', 'use_claude']),
      (v_sid, 'Scripter', '#38BDF8', 40, array['manage_projects', 'use_claude']),
      (v_sid, 'Modelador', '#F472B6', 30, array['manage_files']),
      (v_sid, 'Tester', '#A78BFA', 20, array[]::text[]);

    insert into public.channels (server_id, name, kind, topic, position) values
      (v_sid, 'geral', 'text', 'Chat da equipe, mensagens, arquivos e comunicação.', 0),
      (v_sid, 'anúncios', 'text', 'Avisos importantes da equipe.', 1),
      (v_sid, 'desenvolvimento', 'text', 'Scripts, sistemas e builds.', 2),
      (v_sid, 'ideias', 'text', 'Ideias para o jogo.', 3),
      (v_sid, 'bugs', 'text', 'Relatos de bugs e correções.', 4),
      (v_sid, 'equipe', 'text', 'Organização da equipe.', 5),
      (v_sid, 'Geral', 'voice', null, 10),
      (v_sid, 'Call da Equipe', 'voice', null, 11),
      (v_sid, 'Trabalho', 'voice', null, 12),
      (v_sid, 'Reuniões', 'voice', null, 13);
  else
    insert into public.channels (server_id, name, kind, topic, position) values
      (v_sid, 'geral', 'text', 'Conversa geral.', 0),
      (v_sid, 'Geral', 'voice', null, 10);
  end if;

  return v_sid;
end
$$;

create or replace function public.preview_invite(p_code text)
returns table (
  server_id uuid,
  name text,
  description text,
  icon_url text,
  banner_url text,
  member_count bigint,
  valid boolean,
  reason text
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.name, s.description, s.icon_url, s.banner_url,
         (select count(*) from public.server_members m where m.server_id = s.id),
         (i.expires_at is null or i.expires_at > now()) and (i.max_uses is null or i.uses < i.max_uses),
         case
           when i.expires_at is not null and i.expires_at <= now() then 'Convite expirado'
           when i.max_uses is not null and i.uses >= i.max_uses then 'Convite esgotado'
           else null
         end
  from public.invites i
  join public.servers s on s.id = i.server_id
  where i.code = p_code
$$;

create or replace function public.join_server_by_invite(p_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_inv public.invites%rowtype;
begin
  if v_uid is null then
    raise exception 'Faça login para entrar no servidor.' using errcode = '28000';
  end if;
  select * into v_inv from public.invites where code = btrim(p_code) for update;
  if not found then
    raise exception 'Convite inválido.' using errcode = 'P0002';
  end if;
  if v_inv.expires_at is not null and v_inv.expires_at <= now() then
    raise exception 'Este convite expirou.' using errcode = 'P0001';
  end if;
  if v_inv.max_uses is not null and v_inv.uses >= v_inv.max_uses then
    raise exception 'Este convite atingiu o limite de usos.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.server_bans b where b.server_id = v_inv.server_id and b.user_id = v_uid) then
    raise exception 'Você foi banido deste servidor.' using errcode = '42501';
  end if;

  insert into public.server_members (server_id, user_id)
  values (v_inv.server_id, v_uid)
  on conflict do nothing;

  if found then
    update public.invites set uses = uses + 1 where code = v_inv.code;
  end if;

  return v_inv.server_id;
end
$$;

create or replace function public.join_public_server(p_server uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Faça login para entrar no servidor.' using errcode = '28000';
  end if;
  if not exists (select 1 from public.servers s where s.id = p_server and s.is_public) then
    raise exception 'Servidor não encontrado ou privado.' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.server_bans b where b.server_id = p_server and b.user_id = v_uid) then
    raise exception 'Você foi banido deste servidor.' using errcode = '42501';
  end if;
  insert into public.server_members (server_id, user_id) values (p_server, v_uid) on conflict do nothing;
  return p_server;
end
$$;

create or replace function public.public_servers(p_search text default null)
returns table (id uuid, name text, description text, icon_url text, banner_url text, member_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.name, s.description, s.icon_url, s.banner_url,
         (select count(*) from public.server_members m where m.server_id = s.id) as member_count
  from public.servers s
  where s.is_public
    and (p_search is null or s.name ilike '%' || p_search || '%')
  order by member_count desc, s.created_at desc
  limit 50
$$;

create or replace function public.leave_server(p_server uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.server_members where server_id = p_server and user_id = auth.uid();
end
$$;

create or replace function public.ban_member(p_server uuid, p_user uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public._has_server_perm(p_server, auth.uid(), 'ban_members') then
    raise exception 'Sem permissão para banir membros.' using errcode = '42501';
  end if;
  if exists (select 1 from public.servers s where s.id = p_server and s.owner_id = p_user) then
    raise exception 'O dono do servidor não pode ser banido.' using errcode = '42501';
  end if;
  if p_user = auth.uid() then
    raise exception 'Você não pode banir a si mesmo.' using errcode = '42501';
  end if;
  insert into public.server_bans (server_id, user_id, banned_by, reason)
  values (p_server, p_user, auth.uid(), p_reason)
  on conflict (server_id, user_id) do update set reason = excluded.reason, banned_by = excluded.banned_by;
  delete from public.server_members where server_id = p_server and user_id = p_user;
end
$$;

create or replace function public.transfer_server_ownership(p_server uuid, p_new_owner uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.servers s where s.id = p_server and s.owner_id = auth.uid()) then
    raise exception 'Somente o dono pode transferir o servidor.' using errcode = '42501';
  end if;
  if not public._is_server_member(p_server, p_new_owner) then
    raise exception 'O novo dono precisa ser membro do servidor.' using errcode = 'P0001';
  end if;
  update public.servers set owner_id = p_new_owner where id = p_server;
end
$$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.app_admins enable row level security;
alter table public.app_settings enable row level security;
alter table public.user_settings enable row level security;
alter table public.servers enable row level security;
alter table public.roles enable row level security;
alter table public.server_members enable row level security;
alter table public.member_roles enable row level security;
alter table public.server_bans enable row level security;
alter table public.channels enable row level security;
alter table public.channel_access enable row level security;
alter table public.invites enable row level security;

-- Perfis: visíveis para quem está logado; cada um edita o próprio.
create policy profiles_select on public.profiles for select to authenticated using (true);
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
revoke update on public.profiles from anon, authenticated;
grant update (username, display_name, avatar_url, bio, accent_color) on public.profiles to authenticated;

create policy app_admins_select on public.app_admins for select to authenticated using (true);
create policy app_admins_manage on public.app_admins for all to authenticated
  using (public.is_app_admin()) with check (public.is_app_admin());

create policy app_settings_select on public.app_settings for select to authenticated using (true);
create policy app_settings_update on public.app_settings for update to authenticated
  using (public.is_app_admin()) with check (public.is_app_admin());

create policy user_settings_own on public.user_settings for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Servidores
create policy servers_select on public.servers for select to authenticated
  using (is_public or public.is_server_member(id));
create policy servers_update on public.servers for update to authenticated
  using (public.has_server_perm(id, 'manage_server'))
  with check (public.has_server_perm(id, 'manage_server'));
create policy servers_delete on public.servers for delete to authenticated
  using (owner_id = auth.uid());
revoke insert, update on public.servers from anon, authenticated;
grant update (name, description, icon_url, banner_url, is_public) on public.servers to authenticated;

-- Cargos
create policy roles_select on public.roles for select to authenticated
  using (public.is_server_member(server_id));
create policy roles_insert on public.roles for insert to authenticated
  with check (public.has_server_perm(server_id, 'manage_roles'));
create policy roles_update on public.roles for update to authenticated
  using (public.has_server_perm(server_id, 'manage_roles'))
  with check (public.has_server_perm(server_id, 'manage_roles'));
create policy roles_delete on public.roles for delete to authenticated
  using (public.has_server_perm(server_id, 'manage_roles'));
revoke update on public.roles from anon, authenticated;
grant update (name, color, position, permissions, hoist) on public.roles to authenticated;

-- Membros
create policy members_select on public.server_members for select to authenticated
  using (public.is_server_member(server_id));
create policy members_update_self on public.server_members for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy members_delete on public.server_members for delete to authenticated
  using (user_id = auth.uid() or public.has_server_perm(server_id, 'kick_members'));
revoke insert, update on public.server_members from anon, authenticated;
grant update (nickname) on public.server_members to authenticated;

create policy member_roles_select on public.member_roles for select to authenticated
  using (public.is_server_member(server_id));
create policy member_roles_insert on public.member_roles for insert to authenticated
  with check (public.has_server_perm(server_id, 'manage_roles'));
create policy member_roles_delete on public.member_roles for delete to authenticated
  using (public.has_server_perm(server_id, 'manage_roles'));
revoke update on public.member_roles from anon, authenticated;

create policy bans_select on public.server_bans for select to authenticated
  using (public.has_server_perm(server_id, 'ban_members'));
create policy bans_delete on public.server_bans for delete to authenticated
  using (public.has_server_perm(server_id, 'ban_members'));
revoke insert, update on public.server_bans from anon, authenticated;

-- Canais
create policy channels_select on public.channels for select to authenticated
  using (public.can_view_channel_cols(id, server_id, is_private));
create policy channels_insert on public.channels for insert to authenticated
  with check (public.has_server_perm(server_id, 'manage_channels'));
create policy channels_update on public.channels for update to authenticated
  using (public.has_server_perm(server_id, 'manage_channels'))
  with check (public.has_server_perm(server_id, 'manage_channels'));
create policy channels_delete on public.channels for delete to authenticated
  using (public.has_server_perm(server_id, 'manage_channels'));
revoke update on public.channels from anon, authenticated;
grant update (name, topic, position, is_private, user_limit, claude_enabled) on public.channels to authenticated;

create policy channel_access_select on public.channel_access for select to authenticated
  using (exists (select 1 from public.channels c where c.id = channel_id and public.is_server_member(c.server_id)));
create policy channel_access_write on public.channel_access for all to authenticated
  using (exists (select 1 from public.channels c where c.id = channel_id and public.has_server_perm(c.server_id, 'manage_channels')))
  with check (exists (select 1 from public.channels c where c.id = channel_id and public.has_server_perm(c.server_id, 'manage_channels')));

-- Convites
create policy invites_select on public.invites for select to authenticated
  using (public.has_server_perm(server_id, 'create_invites'));
create policy invites_insert on public.invites for insert to authenticated
  with check (public.has_server_perm(server_id, 'create_invites') and created_by = auth.uid());
create policy invites_delete on public.invites for delete to authenticated
  using (created_by = auth.uid() or public.has_server_perm(server_id, 'manage_server'));
revoke update on public.invites from anon, authenticated;
revoke insert on public.invites from anon, authenticated;
grant insert (server_id, max_uses, expires_at, created_by) on public.invites to authenticated;

-- ---------------------------------------------------------------------
-- Privilégios de execução
-- ---------------------------------------------------------------------
revoke execute on function public._is_server_member(uuid, uuid) from public, anon, authenticated;
revoke execute on function public._user_permissions(uuid, uuid) from public, anon, authenticated;
revoke execute on function public._has_server_perm(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public._can_view_channel(uuid, uuid) from public, anon, authenticated;
revoke execute on function public._can_view_channel_cols(uuid, uuid, boolean, uuid) from public, anon, authenticated;
grant execute on function public._can_view_channel_cols(uuid, uuid, boolean, uuid) to service_role;
revoke execute on function public._can_join_voice(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public._is_server_member(uuid, uuid) to service_role;
grant execute on function public._user_permissions(uuid, uuid) to service_role;
grant execute on function public._has_server_perm(uuid, uuid, text) to service_role;
grant execute on function public._can_view_channel(uuid, uuid) to service_role;
grant execute on function public._can_join_voice(uuid, uuid) to service_role;

revoke execute on function public.create_server(text, text, boolean, text) from public, anon;
revoke execute on function public.join_server_by_invite(text) from public, anon;
revoke execute on function public.join_public_server(uuid) from public, anon;
revoke execute on function public.leave_server(uuid) from public, anon;
revoke execute on function public.ban_member(uuid, uuid, text) from public, anon;
revoke execute on function public.transfer_server_ownership(uuid, uuid) from public, anon;
grant execute on function public.create_server(text, text, boolean, text) to authenticated;
grant execute on function public.join_server_by_invite(text) to authenticated;
grant execute on function public.join_public_server(uuid) to authenticated;
grant execute on function public.leave_server(uuid) to authenticated;
grant execute on function public.ban_member(uuid, uuid, text) to authenticated;
grant execute on function public.transfer_server_ownership(uuid, uuid) to authenticated;
