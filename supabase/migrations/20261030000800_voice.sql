-- =====================================================================
-- NEXUS — 0008 Claude na call (voz em tempo real)
-- O agente de voz roda na LiveKit Cloud e só entra numa sala quando alguém
-- autorizado chama. Nada de gravação: não guardamos áudio nem transcrição.
-- =====================================================================

-- Preferências de voz de cada pessoa (valem quando ELA chama o Claude)
alter table public.companion_settings
  add column if not exists voice_option text not null default 'voz1'
    check (voice_option in ('voz1', 'voz2')),
  add column if not exists voice_speed text not null default 'normal'
    check (voice_speed in ('lenta', 'normal', 'rapida')),
  add column if not exists voice_greeting boolean not null default true;

grant update (voice_option, voice_speed, voice_greeting) on public.companion_settings to authenticated;

-- O servidor marca quando o agente de voz estiver publicado e pronto.
alter table public.app_settings
  add column if not exists voice_agent_ready boolean not null default false;

-- Sessões do Claude nas calls (quem chamou, onde, quando saiu)
create table public.voice_sessions (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.servers (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  room text not null,
  inviter_id uuid references public.profiles (id) on delete set null,
  dispatch_id text,
  status text not null default 'chamando' check (status in ('chamando', 'na_call', 'encerrada', 'falhou')),
  ended_reason text check (ended_reason is null or char_length(ended_reason) <= 300),
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

-- No máximo um Claude por canal de voz
create unique index voice_sessions_one_active on public.voice_sessions (channel_id)
  where status in ('chamando', 'na_call');
create index voice_sessions_server_idx on public.voice_sessions (server_id, started_at desc);

alter table public.voice_sessions enable row level security;
create policy voice_sessions_select on public.voice_sessions for select to authenticated
  using (public.can_view_channel(channel_id));
revoke insert, update, delete on public.voice_sessions from anon, authenticated;

-- Quem pode chamar o Claude para uma call? Devolve o motivo quando não pode.
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
    return 'O serviço de voz do Claude ainda não foi ativado pelo administrador do NEXUS.';
  end if;
  if not public._can_join_voice(p_channel, p_user) then
    return 'Você não tem permissão para entrar nesta call.';
  end if;
  if not public._can_use_claude_in_server(v_server, p_user) then
    return 'Seu cargo neste servidor não permite usar o Claude.';
  end if;
  if not public._companion_has_scope(p_user, 'ouvir_call') or not public._companion_has_scope(p_user, 'falar_call') then
    return 'Libere "Ouvir calls" e "Falar nas calls" em Claude Companion → Permissões antes de chamar o Claude.';
  end if;
  return null;
end
$$;

-- Quem pode tirar o Claude da call: quem chamou ou quem move membros/administra.
create or replace function public._voice_can_remove(p_channel uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.voice_sessions v
    where v.channel_id = p_channel
      and v.status in ('chamando', 'na_call')
      and (v.inviter_id = p_user or public._has_server_perm(v.server_id, p_user, 'move_members'))
  )
$$;

revoke execute on function public._voice_invite_check(uuid, uuid) from public, anon, authenticated;
revoke execute on function public._voice_can_remove(uuid, uuid) from public, anon, authenticated;
grant execute on function public._voice_invite_check(uuid, uuid) to service_role;
grant execute on function public._voice_can_remove(uuid, uuid) to service_role;

-- Tempo real: a interface vê quando o Claude entra/sai
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.voice_sessions;
  end if;
end
$$;
