-- =====================================================================
-- NEXUS — Servidores no estilo Discord
--  * Cada pessoa cria o próprio servidor; só entra quem tem o LINK de convite
--    (não existe mais lista de servidores públicos).
--  * PIN de entrada opcional por servidor (link + PIN), com limite de tentativas.
--  * Categorias de canais (criar, renomear, mover canais, reorganizar).
--  * Canal de mensagens do sistema e aviso de "entrou no servidor".
--  * Modelos ao criar servidor (Estúdio, Amigos, Jogos, Estudo, Do zero).
--  * Chave do administrador: calls em servidores de outras pessoas.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Sem servidores públicos: entrar só por convite
-- ---------------------------------------------------------------------
alter table public.servers
  add column if not exists system_channel_id uuid,
  add column if not exists welcome_messages boolean not null default true;

update public.servers set is_public = false where is_public;

-- Força servidor privado e confere o canal de sistema (precisa ser um canal
-- de texto do próprio servidor).
create or replace function public.servers_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.is_public := false;
  if new.system_channel_id is not null
     and (tg_op = 'INSERT' or new.system_channel_id is distinct from old.system_channel_id) then
    if not exists (
      select 1 from public.channels c
      where c.id = new.system_channel_id and c.server_id = new.id and c.kind = 'text'
    ) then
      raise exception 'Escolha um canal de texto deste servidor.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists servers_before_write on public.servers;
create trigger servers_before_write
  before insert or update on public.servers
  for each row execute function public.servers_before_write();

drop policy if exists servers_select on public.servers;
create policy servers_select on public.servers for select to authenticated
  using (public.is_server_member(id));

grant update (system_channel_id, welcome_messages) on public.servers to authenticated;

drop function if exists public.join_public_server(uuid);
drop function if exists public.public_servers(text);

-- ---------------------------------------------------------------------
-- 2. PIN de entrada (só quem gerencia o servidor vê e troca)
-- ---------------------------------------------------------------------
create table if not exists public.server_join_pins (
  server_id uuid primary key references public.servers (id) on delete cascade,
  pin text not null check (pin ~ '^[0-9]{4,8}$'),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

create or replace function public.join_pins_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end
$$;

drop trigger if exists join_pins_before_write on public.server_join_pins;
create trigger join_pins_before_write
  before insert or update on public.server_join_pins
  for each row execute function public.join_pins_before_write();

alter table public.server_join_pins enable row level security;
create policy join_pins_select on public.server_join_pins for select to authenticated
  using (public.has_server_perm(server_id, 'manage_server'));
create policy join_pins_insert on public.server_join_pins for insert to authenticated
  with check (public.has_server_perm(server_id, 'manage_server'));
create policy join_pins_update on public.server_join_pins for update to authenticated
  using (public.has_server_perm(server_id, 'manage_server'))
  with check (public.has_server_perm(server_id, 'manage_server'));
create policy join_pins_delete on public.server_join_pins for delete to authenticated
  using (public.has_server_perm(server_id, 'manage_server'));
revoke all on public.server_join_pins from anon, authenticated;
grant select, delete on public.server_join_pins to authenticated;
grant insert (server_id, pin) on public.server_join_pins to authenticated;
grant update (pin) on public.server_join_pins to authenticated;

-- Tentativas erradas de PIN (só o sistema lê e escreve).
create table if not exists public.join_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  server_id uuid not null references public.servers (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists join_attempts_lookup_idx on public.join_attempts (user_id, server_id, created_at desc);
alter table public.join_attempts enable row level security;
revoke all on public.join_attempts from anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Prévia do convite (funciona antes do login, como no Discord)
-- ---------------------------------------------------------------------
drop function if exists public.preview_invite(text);
create function public.preview_invite(p_code text)
returns table (
  server_id uuid,
  name text,
  description text,
  icon_url text,
  banner_url text,
  member_count bigint,
  valid boolean,
  reason text,
  requires_pin boolean,
  already_member boolean
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
         end,
         exists (select 1 from public.server_join_pins p where p.server_id = s.id),
         auth.uid() is not null and exists (
           select 1 from public.server_members m where m.server_id = s.id and m.user_id = auth.uid()
         )
  from public.invites i
  join public.servers s on s.id = i.server_id
  where i.code = btrim(coalesce(p_code, ''))
$$;

revoke execute on function public.preview_invite(text) from public;
grant execute on function public.preview_invite(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Entrar no servidor: link + PIN (quando o servidor tiver PIN)
--    Devolve { ok, server_id?, reason?, needs_pin?, locked?, already_member? }
--    Erros viram resposta (e não exceção) para que as tentativas erradas
--    fiquem registradas e o limite funcione.
-- ---------------------------------------------------------------------
create or replace function public.join_server(p_code text, p_pin text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_inv public.invites%rowtype;
  v_pin text;
  v_fails integer;
  v_left integer;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'Faça login para entrar no servidor.');
  end if;
  select * into v_inv from public.invites where code = btrim(coalesce(p_code, '')) for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'Convite inválido ou apagado. Peça um link novo.');
  end if;
  if exists (select 1 from public.server_members m where m.server_id = v_inv.server_id and m.user_id = v_uid) then
    return jsonb_build_object('ok', true, 'server_id', v_inv.server_id, 'already_member', true);
  end if;
  if exists (select 1 from public.server_bans b where b.server_id = v_inv.server_id and b.user_id = v_uid) then
    return jsonb_build_object('ok', false, 'reason', 'Você foi banido deste servidor.');
  end if;
  if v_inv.expires_at is not null and v_inv.expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'Este convite expirou. Peça um link novo.');
  end if;
  if v_inv.max_uses is not null and v_inv.uses >= v_inv.max_uses then
    return jsonb_build_object('ok', false, 'reason', 'Este convite atingiu o limite de usos. Peça um link novo.');
  end if;

  select p.pin into v_pin from public.server_join_pins p where p.server_id = v_inv.server_id;
  if v_pin is not null then
    delete from public.join_attempts a where a.user_id = v_uid and a.created_at < now() - interval '1 day';
    select count(*) into v_fails
    from public.join_attempts a
    where a.user_id = v_uid and a.server_id = v_inv.server_id and a.created_at > now() - interval '15 minutes';
    if v_fails >= 5 then
      return jsonb_build_object('ok', false, 'needs_pin', true, 'locked', true,
        'reason', 'Muitas tentativas com PIN errado. Espere 15 minutos e tente de novo.');
    end if;
    if p_pin is null or btrim(p_pin) = '' then
      return jsonb_build_object('ok', false, 'needs_pin', true, 'reason', 'Este servidor pede um PIN para entrar.');
    end if;
    if btrim(p_pin) <> v_pin then
      insert into public.join_attempts (user_id, server_id) values (v_uid, v_inv.server_id);
      v_left := 4 - v_fails;
      return jsonb_build_object('ok', false, 'needs_pin', true, 'locked', v_left <= 0,
        'reason', case when v_left <= 0
                       then 'PIN incorreto. Espere 15 minutos e tente de novo.'
                       else format('PIN incorreto. Você ainda tem %s tentativa(s).', v_left) end);
    end if;
  end if;

  insert into public.server_members (server_id, user_id)
  values (v_inv.server_id, v_uid)
  on conflict do nothing;
  if found then
    update public.invites set uses = uses + 1 where code = v_inv.code;
  end if;
  delete from public.join_attempts a where a.user_id = v_uid and a.server_id = v_inv.server_id;
  return jsonb_build_object('ok', true, 'server_id', v_inv.server_id);
end
$$;

revoke execute on function public.join_server(text, text) from public, anon;
grant execute on function public.join_server(text, text) to authenticated;

-- Versões antigas do app usam esta função: continua funcionando, mas um
-- servidor com PIN exige a versão nova (que pede o PIN).
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
  if exists (select 1 from public.server_members m where m.server_id = v_inv.server_id and m.user_id = v_uid) then
    return v_inv.server_id;
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
  if exists (select 1 from public.server_join_pins p where p.server_id = v_inv.server_id) then
    raise exception 'Este servidor pede um PIN de entrada. Atualize o NEXUS para a versão mais recente para entrar.'
      using errcode = '42501';
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

-- ---------------------------------------------------------------------
-- 5. Categorias de canais
-- ---------------------------------------------------------------------
create table if not exists public.channel_categories (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.servers (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 32),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  unique (id, server_id)
);
create index if not exists channel_categories_server_idx on public.channel_categories (server_id, position);

alter table public.channels add column if not exists category_id uuid;
alter table public.channels drop constraint if exists channels_category_fk;
-- A categoria precisa ser do mesmo servidor; apagar a categoria deixa os
-- canais "sem categoria" (como no Discord).
alter table public.channels add constraint channels_category_fk
  foreign key (category_id, server_id) references public.channel_categories (id, server_id)
  on delete set null (category_id);
create index if not exists channels_category_idx on public.channels (category_id);

alter table public.channel_categories enable row level security;
create policy categories_select on public.channel_categories for select to authenticated
  using (public.is_server_member(server_id));
create policy categories_insert on public.channel_categories for insert to authenticated
  with check (public.has_server_perm(server_id, 'manage_channels'));
create policy categories_update on public.channel_categories for update to authenticated
  using (public.has_server_perm(server_id, 'manage_channels'))
  with check (public.has_server_perm(server_id, 'manage_channels'));
create policy categories_delete on public.channel_categories for delete to authenticated
  using (public.has_server_perm(server_id, 'manage_channels'));
revoke all on public.channel_categories from anon, authenticated;
grant select, delete on public.channel_categories to authenticated;
grant insert (server_id, name, position) on public.channel_categories to authenticated;
grant update (name, position) on public.channel_categories to authenticated;

grant update (category_id) on public.channels to authenticated;

-- Reorganizar canais e categorias de uma vez (arrastar e soltar).
-- p_categories: [{id, position}] · p_channels: [{id, position, category_id|null}]
create or replace function public.save_channel_layout(p_server uuid, p_categories jsonb, p_channels jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public._has_server_perm(p_server, auth.uid(), 'manage_channels') then
    raise exception 'Sem permissão para organizar os canais.' using errcode = '42501';
  end if;
  if jsonb_array_length(coalesce(p_categories, '[]'::jsonb)) > 200
     or jsonb_array_length(coalesce(p_channels, '[]'::jsonb)) > 500 then
    raise exception 'Lista grande demais.' using errcode = '22023';
  end if;

  update public.channel_categories c
  set position = (x ->> 'position')::integer
  from jsonb_array_elements(coalesce(p_categories, '[]'::jsonb)) as x
  where c.id = public.try_uuid(x ->> 'id') and c.server_id = p_server;

  update public.channels ch
  set position = (x ->> 'position')::integer,
      category_id = public.try_uuid(nullif(x ->> 'category_id', ''))
  from jsonb_array_elements(coalesce(p_channels, '[]'::jsonb)) as x
  where ch.id = public.try_uuid(x ->> 'id') and ch.server_id = p_server;
end
$$;

revoke execute on function public.save_channel_layout(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.save_channel_layout(uuid, jsonb, jsonb) to authenticated;

-- Servidores que já existem: "Canais de texto" e "Canais de voz" (nada muda
-- de lugar) e o #geral vira o canal de mensagens do sistema.
do $$
declare
  r record;
  v_text uuid;
  v_voice uuid;
begin
  for r in select s.id from public.servers s loop
    if not exists (select 1 from public.channel_categories c where c.server_id = r.id) then
      insert into public.channel_categories (server_id, name, position) values (r.id, 'Canais de texto', 0) returning id into v_text;
      insert into public.channel_categories (server_id, name, position) values (r.id, 'Canais de voz', 1) returning id into v_voice;
      update public.channels
      set category_id = case when kind = 'text' then v_text else v_voice end
      where server_id = r.id and category_id is null;
    end if;
    update public.servers s
    set system_channel_id = coalesce(
      (select c.id from public.channels c where c.server_id = r.id and c.kind = 'text' and c.name = 'geral' and not c.is_private limit 1),
      (select c.id from public.channels c where c.server_id = r.id and c.kind = 'text' and not c.is_private order by c.position limit 1)
    )
    where s.id = r.id and s.system_channel_id is null;
  end loop;
end
$$;

-- Tempo real para as categorias
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.channel_categories;
    exception when duplicate_object then
      null;
    end;
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- 6. Aviso de "entrou no servidor" no canal de mensagens do sistema
-- ---------------------------------------------------------------------
create or replace function public.welcome_new_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_on boolean;
  v_channel uuid;
begin
  select s.owner_id, s.welcome_messages, s.system_channel_id
  into v_owner, v_on, v_channel
  from public.servers s where s.id = new.server_id;
  if not found or not v_on or v_channel is null or v_owner = new.user_id then
    return new;
  end if;
  if not exists (select 1 from public.channels c where c.id = v_channel and c.server_id = new.server_id and c.kind = 'text') then
    return new;
  end if;
  insert into public.messages (channel_id, author_id, author_kind, content, meta)
  values (v_channel, new.user_id, 'system', 'entrou no servidor.', jsonb_build_object('type', 'join'));
  return new;
end
$$;

drop trigger if exists server_members_welcome on public.server_members;
create trigger server_members_welcome
  after insert on public.server_members
  for each row execute function public.welcome_new_member();

revoke execute on function public.welcome_new_member() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 7. Criar servidor com modelos (como no Discord)
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

  insert into public.servers (name, description, owner_id)
  values (btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''), v_uid)
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

-- ---------------------------------------------------------------------
-- 8. Calls em servidores de outras pessoas (chave do administrador)
--    Ligado = como no Discord. Desligado = calls só nos servidores do
--    administrador (para não gastar a franquia gratuita da LiveKit).
-- ---------------------------------------------------------------------
alter table public.app_settings
  add column if not exists calls_everyone boolean not null default true;

create or replace function public._calls_allowed(p_server uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select a.calls_everyone from public.app_settings a limit 1), true)
      or exists (
        select 1 from public.servers s
        join public.app_admins ad on ad.user_id = s.owner_id
        where s.id = p_server
      )
$$;

revoke execute on function public._calls_allowed(uuid) from public, anon, authenticated;
grant execute on function public._calls_allowed(uuid) to service_role;

-- ---------------------------------------------------------------------
-- 9. Claude só para o administrador do NEXUS (padrão: ligado)
--    Ninguém mais vê nem usa o Claude (chat, Companion, @Claude, voz).
--    Desligando, volta a regra antiga: cargos com "Usar o Claude" nos
--    servidores do administrador e pessoas liberadas individualmente.
-- ---------------------------------------------------------------------
alter table public.app_settings
  add column if not exists claude_admin_only boolean not null default true;

create or replace function public._claude_admin_only()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select s.claude_admin_only from public.app_settings s limit 1), true)
$$;

revoke execute on function public._claude_admin_only() from public, anon, authenticated;
grant execute on function public._claude_admin_only() to service_role;

create or replace function public._can_use_claude(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user is not null and (
    exists (select 1 from public.app_admins a where a.user_id = p_user)
    or (
      not public._claude_admin_only()
      and (
        exists (select 1 from public.ai_access x where x.user_id = p_user)
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
    )
  )
$$;

create or replace function public._can_use_claude_in_server(p_server uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public._has_server_perm(p_server, p_user, 'use_claude')
     and (
       exists (select 1 from public.app_admins a where a.user_id = p_user)
       or (
         not public._claude_admin_only()
         and (
           exists (select 1 from public.servers s join public.app_admins a on a.user_id = s.owner_id where s.id = p_server)
           or exists (select 1 from public.ai_access x where x.user_id = p_user)
         )
       )
     )
$$;
