-- =====================================================================
-- NEXUS — 0002 Mensagens: canais, mensagens privadas, notificações,
-- leitura, busca
-- =====================================================================

create table public.dm_threads (
  id uuid primary key default gen_random_uuid(),
  is_group boolean not null default false,
  name text check (name is null or char_length(btrim(name)) between 1 and 64),
  pair_key text unique, -- "uuidA:uuidB" (ordenado) para conversas 1:1
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz,
  check (is_group or pair_key is not null)
);

create table public.dm_participants (
  thread_id uuid not null references public.dm_threads (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  hidden boolean not null default false,
  primary key (thread_id, user_id)
);

create index dm_participants_user_idx on public.dm_participants (user_id);

create or replace function public._is_dm_participant(p_thread uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user is not null and exists (
    select 1 from public.dm_participants d where d.thread_id = p_thread and d.user_id = p_user
  )
$$;

create or replace function public.is_dm_participant(p_thread uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public._is_dm_participant(p_thread, auth.uid())
$$;

-- ---------------------------------------------------------------------
-- Mensagens (canais de texto e conversas privadas)
-- ---------------------------------------------------------------------
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid references public.channels (id) on delete cascade,
  server_id uuid references public.servers (id) on delete cascade,
  dm_thread_id uuid references public.dm_threads (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  author_kind text not null default 'user' check (author_kind in ('user', 'claude', 'system')),
  content text not null default '' check (char_length(content) <= 4000),
  attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 10),
  mentions uuid[] not null default '{}'::uuid[],
  mentions_claude boolean not null default false,
  mentions_everyone boolean not null default false,
  reply_to uuid references public.messages (id) on delete set null,
  meta jsonb not null default '{}'::jsonb,
  edited_at timestamptz,
  created_at timestamptz not null default now(),
  search tsvector generated always as (to_tsvector('portuguese'::regconfig, content)) stored,
  check ((channel_id is null) <> (dm_thread_id is null))
);

create index messages_channel_idx on public.messages (channel_id, created_at desc) where channel_id is not null;
create index messages_dm_idx on public.messages (dm_thread_id, created_at desc) where dm_thread_id is not null;
create index messages_server_idx on public.messages (server_id, created_at desc) where server_id is not null;
create index messages_search_idx on public.messages using gin (search);
create index messages_mentions_idx on public.messages using gin (mentions);

-- Antes de inserir: completa servidor, extrai menções, valida conteúdo.
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
    and new.content ~* '(^|[^a-z0-9_.@])@claude([^a-z0-9_]|$)';

  new.mentions_everyone := new.channel_id is not null
    and new.author_kind = 'user'
    and new.content ~* '(^|[^a-z0-9_.@])@(todos|everyone)([^a-z0-9_]|$)'
    and public._has_server_perm(new.server_id, new.author_id, 'mention_everyone');

  return new;
end
$$;

create trigger messages_before_insert
  before insert on public.messages
  for each row execute function public.messages_before_write();

create trigger messages_before_update
  before update on public.messages
  for each row execute function public.messages_before_write();

-- ---------------------------------------------------------------------
-- Notificações
-- ---------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('mention', 'dm', 'invite', 'task', 'question', 'claude', 'system')),
  title text not null check (char_length(title) <= 200),
  body text check (body is null or char_length(body) <= 500),
  link jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;

-- Função interna para criar notificações (usada por gatilhos e pelo servidor).
create or replace function public._notify(
  p_user uuid,
  p_kind text,
  p_title text,
  p_body text,
  p_link jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (user_id, kind, title, body, link)
  values (p_user, p_kind, left(p_title, 200), left(p_body, 500), coalesce(p_link, '{}'::jsonb))
$$;

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
    case new.author_kind when 'claude' then 'Claude' else 'Sistema' end
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

create trigger messages_after_insert
  after insert on public.messages
  for each row execute function public.messages_after_insert();

-- ---------------------------------------------------------------------
-- Estado de leitura (não lidas)
-- ---------------------------------------------------------------------
create table public.read_states (
  user_id uuid not null references public.profiles (id) on delete cascade,
  target_id uuid not null, -- id do canal ou da conversa privada
  last_read_at timestamptz not null default now(),
  primary key (user_id, target_id)
);

create or replace function public.mark_read(p_target uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.read_states (user_id, target_id, last_read_at)
  select auth.uid(), p_target, now()
  where auth.uid() is not null
    and (public._can_view_channel(p_target, auth.uid()) or public._is_dm_participant(p_target, auth.uid()))
  on conflict (user_id, target_id) do update set last_read_at = excluded.last_read_at
$$;

create or replace function public.unread_summary()
returns table (target_id uuid, kind text, server_id uuid, unread integer, mentions integer)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select auth.uid() as uid
  ),
  chans as (
    select c.id, c.server_id, coalesce(rs.last_read_at, sm.joined_at) as since
    from public.server_members sm
    join public.channels c on c.server_id = sm.server_id and c.kind = 'text'
    left join public.read_states rs on rs.user_id = sm.user_id and rs.target_id = c.id
    where sm.user_id = (select uid from me)
      and public._can_view_channel(c.id, sm.user_id)
  ),
  dms as (
    select d.thread_id as id, coalesce(rs.last_read_at, d.joined_at) as since
    from public.dm_participants d
    left join public.read_states rs on rs.user_id = d.user_id and rs.target_id = d.thread_id
    where d.user_id = (select uid from me)
  )
  select c.id, 'channel'::text, c.server_id, x.unread, x.mentions
  from chans c
  cross join lateral (
    select count(*)::integer as unread,
           (count(*) filter (where (select uid from me) = any (q.mentions) or q.mentions_everyone))::integer as mentions
    from (
      select m.mentions, m.mentions_everyone
      from public.messages m
      where m.channel_id = c.id
        and m.created_at > c.since
        and m.author_id is distinct from (select uid from me)
      order by m.created_at desc
      limit 100
    ) q
  ) x
  where x.unread > 0
  union all
  select d.id, 'dm'::text, null::uuid, x.unread, x.unread
  from dms d
  cross join lateral (
    select count(*)::integer as unread
    from (
      select 1
      from public.messages m
      where m.dm_thread_id = d.id
        and m.created_at > d.since
        and m.author_id is distinct from (select uid from me)
      limit 100
    ) q
  ) x
  where x.unread > 0
$$;

-- ---------------------------------------------------------------------
-- Mensagens privadas
-- ---------------------------------------------------------------------
create or replace function public.open_dm(p_user uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_key text;
  v_thread uuid;
begin
  if v_uid is null then
    raise exception 'Faça login.' using errcode = '28000';
  end if;
  if p_user is null or p_user = v_uid then
    raise exception 'Escolha outra pessoa para conversar.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_user) then
    raise exception 'Pessoa não encontrada.' using errcode = 'P0002';
  end if;

  v_key := least(v_uid::text, p_user::text) || ':' || greatest(v_uid::text, p_user::text);
  select t.id into v_thread from public.dm_threads t where t.pair_key = v_key;

  if v_thread is null then
    -- Só é possível iniciar conversa com quem divide pelo menos um servidor.
    if not public.shares_server_with(p_user) then
      raise exception 'Vocês precisam participar de um servidor em comum para conversar.' using errcode = '42501';
    end if;
    insert into public.dm_threads (is_group, pair_key, created_by)
    values (false, v_key, v_uid)
    returning id into v_thread;
    insert into public.dm_participants (thread_id, user_id) values (v_thread, v_uid), (v_thread, p_user);
  else
    update public.dm_participants set hidden = false where thread_id = v_thread and user_id = v_uid;
  end if;

  return v_thread;
end
$$;

create or replace function public.create_group_dm(p_users uuid[], p_name text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_thread uuid;
  v_user uuid;
  v_users uuid[];
begin
  if v_uid is null then
    raise exception 'Faça login.' using errcode = '28000';
  end if;
  select array_agg(distinct u) into v_users from unnest(p_users) u where u is not null and u <> v_uid;
  if v_users is null or array_length(v_users, 1) < 2 then
    raise exception 'Um grupo precisa de pelo menos 3 pessoas (contando você).' using errcode = 'P0001';
  end if;
  if array_length(v_users, 1) > 9 then
    raise exception 'Grupos privados aceitam no máximo 10 pessoas.' using errcode = 'P0001';
  end if;
  foreach v_user in array v_users loop
    if not public.shares_server_with(v_user) then
      raise exception 'Todas as pessoas precisam participar de um servidor em comum com você.' using errcode = '42501';
    end if;
  end loop;

  insert into public.dm_threads (is_group, name, created_by)
  values (true, nullif(btrim(coalesce(p_name, '')), ''), v_uid)
  returning id into v_thread;

  insert into public.dm_participants (thread_id, user_id)
  select v_thread, u from unnest(v_users || v_uid) u;

  return v_thread;
end
$$;

create or replace function public.hide_dm(p_thread uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.dm_participants set hidden = true
  where thread_id = p_thread and user_id = auth.uid()
$$;

-- ---------------------------------------------------------------------
-- Busca de mensagens (respeita RLS: security invoker)
-- ---------------------------------------------------------------------
create or replace function public.search_messages(p_query text, p_server uuid default null, p_limit integer default 30)
returns setof public.messages
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
  select m.*
  from public.messages m, q
  where q.tsq is not null
    and m.search @@ to_tsquery('portuguese'::regconfig, q.tsq)
    and (p_server is null or m.server_id = p_server)
  order by m.created_at desc
  limit least(greatest(coalesce(p_limit, 30), 1), 100)
$$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.dm_threads enable row level security;
alter table public.dm_participants enable row level security;
alter table public.messages enable row level security;
alter table public.notifications enable row level security;
alter table public.read_states enable row level security;

create policy dm_threads_select on public.dm_threads for select to authenticated
  using (public.is_dm_participant(id));
create policy dm_threads_update on public.dm_threads for update to authenticated
  using (is_group and public.is_dm_participant(id))
  with check (is_group and public.is_dm_participant(id));
revoke insert, update, delete on public.dm_threads from anon, authenticated;
grant update (name) on public.dm_threads to authenticated;

create policy dm_participants_select on public.dm_participants for select to authenticated
  using (public.is_dm_participant(thread_id));
create policy dm_participants_leave on public.dm_participants for delete to authenticated
  using (user_id = auth.uid() and exists (select 1 from public.dm_threads t where t.id = thread_id and t.is_group));
revoke insert, update on public.dm_participants from anon, authenticated;

create policy messages_select on public.messages for select to authenticated
  using (
    (channel_id is not null and public.can_view_channel(channel_id))
    or (dm_thread_id is not null and public.is_dm_participant(dm_thread_id))
  );

create policy messages_insert on public.messages for insert to authenticated
  with check (
    author_id = auth.uid()
    and author_kind = 'user'
    and (
      (channel_id is not null
        and public.can_send_in_channel(channel_id)
        and (jsonb_array_length(attachments) = 0
             or public.has_server_perm((select c.server_id from public.channels c where c.id = channel_id), 'attach_files')))
      or (dm_thread_id is not null and public.is_dm_participant(dm_thread_id))
    )
  );

create policy messages_update on public.messages for update to authenticated
  using (author_id = auth.uid() and author_kind = 'user')
  with check (author_id = auth.uid() and author_kind = 'user');

create policy messages_delete on public.messages for delete to authenticated
  using (
    (author_id = auth.uid() and author_kind = 'user')
    or (server_id is not null and public.has_server_perm(server_id, 'manage_messages'))
  );

revoke insert, update on public.messages from anon, authenticated;
grant insert (channel_id, dm_thread_id, author_id, content, attachments, reply_to) on public.messages to authenticated;
grant update (content) on public.messages to authenticated;

create policy notifications_select on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notifications_delete on public.notifications for delete to authenticated
  using (user_id = auth.uid());
revoke insert, update on public.notifications from anon, authenticated;
grant update (read_at) on public.notifications to authenticated;

create policy read_states_own on public.read_states for select to authenticated
  using (user_id = auth.uid());
revoke insert, update, delete on public.read_states from anon, authenticated;

-- ---------------------------------------------------------------------
-- Privilégios de execução
-- ---------------------------------------------------------------------
revoke execute on function public._is_dm_participant(uuid, uuid) from public, anon, authenticated;
revoke execute on function public._notify(uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public._is_dm_participant(uuid, uuid) to service_role;
grant execute on function public._notify(uuid, text, text, text, jsonb) to service_role;

revoke execute on function public.open_dm(uuid) from public, anon;
revoke execute on function public.create_group_dm(uuid[], text) from public, anon;
revoke execute on function public.hide_dm(uuid) from public, anon;
revoke execute on function public.mark_read(uuid) from public, anon;
revoke execute on function public.unread_summary() from public, anon;
grant execute on function public.open_dm(uuid) to authenticated;
grant execute on function public.create_group_dm(uuid[], text) to authenticated;
grant execute on function public.hide_dm(uuid) to authenticated;
grant execute on function public.mark_read(uuid) to authenticated;
grant execute on function public.unread_summary() to authenticated;
