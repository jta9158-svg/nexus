-- =====================================================================
-- NEXUS — Amigos (como no Discord) e bloqueio
--  * Pedido de amizade pelo nome de usuário; a outra pessoa aceita ou recusa.
--  * Amigos podem conversar no privado mesmo sem servidor em comum.
--  * Bloquear: desfaz a amizade, impede pedidos e mensagens privadas.
-- =====================================================================

create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester uuid not null references public.profiles (id) on delete cascade,
  addressee uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pendente' check (status in ('pendente', 'aceita')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (requester <> addressee)
);
create unique index if not exists friendships_pair_idx
  on public.friendships (least(requester, addressee), greatest(requester, addressee));
create index if not exists friendships_addressee_idx on public.friendships (addressee);
create index if not exists friendships_requester_idx on public.friendships (requester);

alter table public.friendships enable row level security;
create policy friendships_select on public.friendships for select to authenticated
  using (auth.uid() = requester or auth.uid() = addressee);
revoke all on public.friendships from anon, authenticated;
grant select on public.friendships to authenticated;

create table if not exists public.user_blocks (
  blocker uuid not null references public.profiles (id) on delete cascade,
  blocked uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  check (blocker <> blocked)
);
alter table public.user_blocks enable row level security;
create policy blocks_select on public.user_blocks for select to authenticated
  using (blocker = auth.uid());
revoke all on public.user_blocks from anon, authenticated;
grant select on public.user_blocks to authenticated;

-- Avisos de amizade
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('mention', 'dm', 'invite', 'task', 'question', 'claude', 'system', 'friend'));

create or replace function public._is_blocked_between(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_blocks b
    where (b.blocker = p_a and b.blocked = p_b) or (b.blocker = p_b and b.blocked = p_a)
  )
$$;

create or replace function public._are_friends(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.friendships f
    where f.status = 'aceita'
      and ((f.requester = p_a and f.addressee = p_b) or (f.requester = p_b and f.addressee = p_a))
  )
$$;

-- Pode abrir conversa privada? Amigos ou servidor em comum, e sem bloqueio.
create or replace function public._can_dm(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not public._is_blocked_between(p_a, p_b)
     and (
       public._are_friends(p_a, p_b)
       or exists (
         select 1 from public.server_members x
         join public.server_members y on y.server_id = x.server_id
         where x.user_id = p_a and y.user_id = p_b
       )
     )
$$;

revoke execute on function public._is_blocked_between(uuid, uuid) from public, anon, authenticated;
revoke execute on function public._are_friends(uuid, uuid) from public, anon, authenticated;
revoke execute on function public._can_dm(uuid, uuid) from public, anon, authenticated;
grant execute on function public._is_blocked_between(uuid, uuid) to service_role;
grant execute on function public._are_friends(uuid, uuid) to service_role;
grant execute on function public._can_dm(uuid, uuid) to service_role;

-- Mandar pedido de amizade pelo nome de usuário (o "nick").
-- Devolve { ok, status: enviado | aceito | ja_amigos | ja_enviado, user_id?, reason? }
create or replace function public.send_friend_request(p_username text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_target uuid;
  v_me text;
  v_row public.friendships%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'Faça login.');
  end if;
  select p.id into v_target from public.profiles p
  where p.username = lower(btrim(regexp_replace(coalesce(p_username, ''), '^\s*@', '')));
  if v_target is null then
    return jsonb_build_object('ok', false, 'reason', 'Ninguém com esse nome de usuário. Confira como a pessoa escreveu (sem espaços).');
  end if;
  if v_target = v_uid then
    return jsonb_build_object('ok', false, 'reason', 'Esse é o seu próprio nome de usuário.');
  end if;
  if public._is_blocked_between(v_uid, v_target) then
    return jsonb_build_object('ok', false, 'reason', 'Não foi possível mandar o pedido para esta pessoa.');
  end if;
  if (select count(*) from public.friendships f where f.requester = v_uid and f.created_at > now() - interval '1 hour') >= 30 then
    return jsonb_build_object('ok', false, 'reason', 'Você mandou muitos pedidos agora. Espere um pouco.');
  end if;

  select display_name into v_me from public.profiles where id = v_uid;
  select * into v_row from public.friendships f
  where least(f.requester, f.addressee) = least(v_uid, v_target)
    and greatest(f.requester, f.addressee) = greatest(v_uid, v_target)
  for update;

  if found then
    if v_row.status = 'aceita' then
      return jsonb_build_object('ok', true, 'status', 'ja_amigos', 'user_id', v_target);
    elsif v_row.requester = v_uid then
      return jsonb_build_object('ok', true, 'status', 'ja_enviado', 'user_id', v_target);
    else
      -- A outra pessoa já tinha pedido: vira amizade na hora.
      update public.friendships set status = 'aceita', responded_at = now() where id = v_row.id;
      perform public._notify(v_target, 'friend', v_me || ' aceitou seu pedido de amizade', 'Agora vocês podem conversar no privado.',
        jsonb_build_object('friends', true, 'user_id', v_uid));
      return jsonb_build_object('ok', true, 'status', 'aceito', 'user_id', v_target);
    end if;
  end if;

  insert into public.friendships (requester, addressee) values (v_uid, v_target);
  perform public._notify(v_target, 'friend', v_me || ' quer ser seu amigo', 'Abra Amigos → Pendentes para aceitar.',
    jsonb_build_object('friends', true, 'user_id', v_uid));
  return jsonb_build_object('ok', true, 'status', 'enviado', 'user_id', v_target);
end
$$;

-- Aceitar ou recusar (só quem recebeu o pedido).
create or replace function public.respond_friend_request(p_request uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.friendships%rowtype;
  v_me text;
begin
  select * into v_row from public.friendships f where f.id = p_request for update;
  if not found or v_row.addressee is distinct from v_uid or v_row.status <> 'pendente' then
    raise exception 'Pedido não encontrado.' using errcode = 'P0002';
  end if;
  if coalesce(p_accept, false) then
    update public.friendships set status = 'aceita', responded_at = now() where id = v_row.id;
    select display_name into v_me from public.profiles where id = v_uid;
    perform public._notify(v_row.requester, 'friend', v_me || ' aceitou seu pedido de amizade', 'Agora vocês podem conversar no privado.',
      jsonb_build_object('friends', true, 'user_id', v_uid));
  else
    delete from public.friendships where id = v_row.id;
  end if;
end
$$;

-- Cancelar pedido enviado ou desfazer amizade.
create or replace function public.remove_friend(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.friendships f
  where (f.requester = auth.uid() and f.addressee = p_user) or (f.requester = p_user and f.addressee = auth.uid());
end
$$;

create or replace function public.block_user(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or p_user is null or p_user = v_uid then
    raise exception 'Escolha outra pessoa.' using errcode = 'P0001';
  end if;
  insert into public.user_blocks (blocker, blocked) values (v_uid, p_user) on conflict do nothing;
  delete from public.friendships f
  where (f.requester = v_uid and f.addressee = p_user) or (f.requester = p_user and f.addressee = v_uid);
end
$$;

create or replace function public.unblock_user(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.user_blocks where blocker = auth.uid() and blocked = p_user;
end
$$;

revoke execute on function public.send_friend_request(text) from public, anon;
revoke execute on function public.respond_friend_request(uuid, boolean) from public, anon;
revoke execute on function public.remove_friend(uuid) from public, anon;
revoke execute on function public.block_user(uuid) from public, anon;
revoke execute on function public.unblock_user(uuid) from public, anon;
grant execute on function public.send_friend_request(text) to authenticated;
grant execute on function public.respond_friend_request(uuid, boolean) to authenticated;
grant execute on function public.remove_friend(uuid) to authenticated;
grant execute on function public.block_user(uuid) to authenticated;
grant execute on function public.unblock_user(uuid) to authenticated;

-- Conversas privadas: amigos também podem conversar; bloqueio impede.
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

  if public._is_blocked_between(v_uid, p_user) then
    raise exception 'Não é possível conversar com esta pessoa.' using errcode = '42501';
  end if;

  v_key := least(v_uid::text, p_user::text) || ':' || greatest(v_uid::text, p_user::text);
  select t.id into v_thread from public.dm_threads t where t.pair_key = v_key;

  if v_thread is null then
    -- Só é possível iniciar conversa com amigos ou com quem divide um servidor.
    if not public._can_dm(v_uid, p_user) then
      raise exception 'Para conversar, vocês precisam ser amigos ou participar de um servidor em comum. Mande um pedido de amizade.' using errcode = '42501';
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
    if not public._can_dm(v_uid, v_user) then
      raise exception 'Todas as pessoas precisam ser suas amigas ou participar de um servidor em comum com você.' using errcode = '42501';
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
    -- Conversa privada (1:1): bloqueio impede mensagens nos dois sentidos.
    if new.dm_thread_id is not null and new.author_kind = 'user' and exists (
      select 1
      from public.dm_threads t
      join public.dm_participants d on d.thread_id = t.id and d.user_id <> new.author_id
      where t.id = new.dm_thread_id and not t.is_group
        and public._is_blocked_between(new.author_id, d.user_id)
    ) then
      raise exception 'Você não pode mandar mensagem para esta pessoa.' using errcode = '42501';
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

-- Tempo real: pedidos de amizade aparecem na hora
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.friendships;
    exception when duplicate_object then
      null;
    end;
  end if;
end
$$;
