-- =====================================================================
-- NEXUS — 0005 Gestão financeira e dados do Roblox
-- Regras importantes:
--   * Nada é inventado: cada valor tem origem ("source") e data.
--   * Receita bruta, taxas, pendente, estimado e recebido são separados.
--   * Importações usam "external_ref" para nunca duplicar lançamentos.
-- =====================================================================

create table public.finance_entries (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.servers (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  kind text not null check (kind in ('receita', 'despesa')),
  category text not null default 'outros' check (category in (
    -- receitas
    'roblox_robux', 'roblox_devex', 'patrocinio', 'venda', 'outros_receita',
    -- despesas
    'pagamento_equipe', 'ferramentas', 'anuncios', 'investimento', 'assets', 'impostos', 'taxas', 'infraestrutura',
    'outros'
  )),
  description text check (description is null or char_length(description) <= 300),
  amount numeric(14, 2) not null check (amount >= 0),
  gross_amount numeric(14, 2) check (gross_amount is null or gross_amount >= 0),
  fee_amount numeric(14, 2) check (fee_amount is null or fee_amount >= 0),
  currency text not null default 'BRL' check (currency in ('BRL', 'USD', 'ROBUX')),
  status text not null check (status in ('estimado', 'pendente', 'recebido', 'pago', 'cancelado')),
  occurred_on date not null default current_date,
  payee_id uuid references public.profiles (id) on delete set null,
  source text not null default 'manual' check (source in ('manual', 'roblox_import', 'csv_import')),
  external_ref text,
  notes text check (notes is null or char_length(notes) <= 2000),
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (kind = 'receita' and status in ('estimado', 'pendente', 'recebido', 'cancelado'))
    or (kind = 'despesa' and status in ('estimado', 'pendente', 'pago', 'cancelado'))
  ),
  check (source = 'manual' or external_ref is not null)
);

create unique index finance_entries_dedupe on public.finance_entries (server_id, source, external_ref)
  where external_ref is not null;
create index finance_entries_server_idx on public.finance_entries (server_id, occurred_on desc);
create index finance_entries_project_idx on public.finance_entries (project_id) where project_id is not null;

create trigger finance_entries_touch before update on public.finance_entries
  for each row execute function public.touch_updated_at();

create table public.finance_budgets (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.servers (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
  category text not null default 'geral',
  amount numeric(14, 2) not null check (amount >= 0),
  currency text not null default 'BRL' check (currency in ('BRL', 'USD', 'ROBUX')),
  period_start date not null,
  period_end date not null,
  notes text,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  check (period_end >= period_start)
);

create index finance_budgets_server_idx on public.finance_budgets (server_id, period_start);

create or replace function public.finance_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public._log_activity(new.server_id, new.project_id, auth.uid(), 'user', 'finance.created', 'finance', new.id,
      'Lançou ' || new.kind || ' de ' || new.currency || ' ' || new.amount::text || ' (' || new.status || ')');
    return new;
  elsif tg_op = 'UPDATE' then
    if new.status is distinct from old.status or new.amount is distinct from old.amount then
      perform public._log_activity(new.server_id, new.project_id, auth.uid(), 'user', 'finance.updated', 'finance', new.id,
        'Atualizou lançamento: ' || old.status || ' ' || old.amount::text || ' → ' || new.status || ' ' || new.amount::text);
    end if;
    return new;
  else
    if not exists (select 1 from public.servers sv where sv.id = old.server_id) then
      return old;
    end if;
    perform public._log_activity(old.server_id, (select p.id from public.projects p where p.id = old.project_id), auth.uid(), 'user', 'finance.deleted', 'finance', old.id,
      'Excluiu lançamento de ' || old.currency || ' ' || old.amount::text);
    return old;
  end if;
end
$$;

create trigger finance_audit_ins after insert on public.finance_entries
  for each row execute function public.finance_audit();
create trigger finance_audit_upd after update on public.finance_entries
  for each row execute function public.finance_audit();
create trigger finance_audit_del after delete on public.finance_entries
  for each row execute function public.finance_audit();

-- Resumo por moeda no período (respeita RLS: security invoker).
create or replace function public.finance_summary(
  p_server uuid,
  p_from date,
  p_to date,
  p_project uuid default null
)
returns table (
  currency text,
  receita_recebida numeric,
  receita_pendente numeric,
  receita_estimada numeric,
  receita_bruta numeric,
  taxas numeric,
  despesa_paga numeric,
  despesa_pendente numeric,
  despesa_estimada numeric,
  resultado_recebido numeric,
  resultado_previsto numeric,
  lancamentos bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    e.currency,
    coalesce(sum(e.amount) filter (where e.kind = 'receita' and e.status = 'recebido'), 0),
    coalesce(sum(e.amount) filter (where e.kind = 'receita' and e.status = 'pendente'), 0),
    coalesce(sum(e.amount) filter (where e.kind = 'receita' and e.status = 'estimado'), 0),
    coalesce(sum(coalesce(e.gross_amount, e.amount)) filter (where e.kind = 'receita' and e.status <> 'cancelado'), 0),
    coalesce(sum(e.fee_amount) filter (where e.kind = 'receita' and e.status <> 'cancelado'), 0),
    coalesce(sum(e.amount) filter (where e.kind = 'despesa' and e.status = 'pago'), 0),
    coalesce(sum(e.amount) filter (where e.kind = 'despesa' and e.status = 'pendente'), 0),
    coalesce(sum(e.amount) filter (where e.kind = 'despesa' and e.status = 'estimado'), 0),
    coalesce(sum(e.amount) filter (where e.kind = 'receita' and e.status = 'recebido'), 0)
      - coalesce(sum(e.amount) filter (where e.kind = 'despesa' and e.status = 'pago'), 0),
    coalesce(sum(e.amount) filter (where e.kind = 'receita' and e.status <> 'cancelado'), 0)
      - coalesce(sum(e.amount) filter (where e.kind = 'despesa' and e.status <> 'cancelado'), 0),
    count(*)
  from public.finance_entries e
  where e.server_id = p_server
    and e.occurred_on between p_from and p_to
    and (p_project is null or e.project_id = p_project)
  group by e.currency
  order by e.currency
$$;

-- ---------------------------------------------------------------------
-- Roblox
-- ---------------------------------------------------------------------

-- Experiências (jogos) vinculadas a um servidor do NEXUS.
create table public.roblox_experiences (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.servers (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  universe_id bigint not null check (universe_id > 0),
  root_place_id bigint check (root_place_id is null or root_place_id > 0),
  name text,
  added_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (server_id, universe_id)
);

-- Coletas de métricas públicas (jogadores online, visitas, favoritos).
-- Gravadas somente pelo servidor, com a origem e o horário da coleta.
create table public.roblox_stats (
  id bigint generated always as identity primary key,
  universe_id bigint not null,
  name text,
  playing integer,
  visits bigint,
  favorites bigint,
  max_players integer,
  source text not null,
  fetched_at timestamptz not null default now()
);

create index roblox_stats_universe_idx on public.roblox_stats (universe_id, fetched_at desc);

-- Conta Roblox conectada via OAuth 2.0 (dados privados do dono).
create table public.roblox_accounts (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  roblox_user_id bigint not null,
  roblox_username text,
  roblox_display_name text,
  scopes text[] not null default '{}'::text[],
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Tokens ficam em um esquema que a API pública não expõe.
create schema if not exists private;
revoke all on schema private from public;

create table private.roblox_tokens (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create or replace function public._can_view_roblox_universe(p_universe bigint, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.roblox_experiences x
    where x.universe_id = p_universe
      and public._has_server_perm(x.server_id, p_user, 'view_roblox')
  )
$$;

create or replace function public.can_view_roblox_universe(p_universe bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public._can_view_roblox_universe(p_universe, auth.uid())
$$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.finance_entries enable row level security;
alter table public.finance_budgets enable row level security;
alter table public.roblox_experiences enable row level security;
alter table public.roblox_stats enable row level security;
alter table public.roblox_accounts enable row level security;
alter table private.roblox_tokens enable row level security;

create policy finance_select on public.finance_entries for select to authenticated
  using (public.has_server_perm(server_id, 'view_finance'));
create policy finance_insert on public.finance_entries for insert to authenticated
  with check (public.has_server_perm(server_id, 'manage_finance') and created_by = auth.uid());
create policy finance_update on public.finance_entries for update to authenticated
  using (public.has_server_perm(server_id, 'manage_finance'))
  with check (public.has_server_perm(server_id, 'manage_finance'));
create policy finance_delete on public.finance_entries for delete to authenticated
  using (public.has_server_perm(server_id, 'manage_finance'));
revoke update on public.finance_entries from anon, authenticated;
grant update (project_id, category, description, amount, gross_amount, fee_amount, currency, status, occurred_on, payee_id, notes)
  on public.finance_entries to authenticated;

create policy budgets_select on public.finance_budgets for select to authenticated
  using (public.has_server_perm(server_id, 'view_finance'));
create policy budgets_write on public.finance_budgets for all to authenticated
  using (public.has_server_perm(server_id, 'manage_finance'))
  with check (public.has_server_perm(server_id, 'manage_finance'));

create policy roblox_exp_select on public.roblox_experiences for select to authenticated
  using (public.has_server_perm(server_id, 'view_roblox'));
create policy roblox_exp_insert on public.roblox_experiences for insert to authenticated
  with check (public.has_server_perm(server_id, 'manage_projects') and added_by = auth.uid());
create policy roblox_exp_update on public.roblox_experiences for update to authenticated
  using (public.has_server_perm(server_id, 'manage_projects'))
  with check (public.has_server_perm(server_id, 'manage_projects'));
create policy roblox_exp_delete on public.roblox_experiences for delete to authenticated
  using (public.has_server_perm(server_id, 'manage_projects'));
revoke update on public.roblox_experiences from anon, authenticated;
grant update (project_id, name, root_place_id) on public.roblox_experiences to authenticated;

create policy roblox_stats_select on public.roblox_stats for select to authenticated
  using (public.can_view_roblox_universe(universe_id));
revoke insert, update, delete on public.roblox_stats from anon, authenticated;

create policy roblox_accounts_own on public.roblox_accounts for select to authenticated
  using (user_id = auth.uid());
create policy roblox_accounts_delete on public.roblox_accounts for delete to authenticated
  using (user_id = auth.uid());
revoke insert, update on public.roblox_accounts from anon, authenticated;

revoke all on private.roblox_tokens from public, anon, authenticated;

revoke execute on function public._can_view_roblox_universe(bigint, uuid) from public, anon, authenticated;
grant execute on function public._can_view_roblox_universe(bigint, uuid) to service_role;

grant usage on schema private to service_role;
grant select, insert, update, delete on private.roblox_tokens to service_role;

-- Acesso aos tokens só pelo servidor (Edge Functions com service role).
create or replace function public._roblox_get_token(p_user uuid)
returns table (access_token text, refresh_token text, expires_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select t.access_token, t.refresh_token, t.expires_at from private.roblox_tokens t where t.user_id = p_user
$$;

create or replace function public._roblox_save_token(p_user uuid, p_access text, p_refresh text, p_expires timestamptz)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into private.roblox_tokens (user_id, access_token, refresh_token, expires_at, updated_at)
  values (p_user, p_access, p_refresh, p_expires, now())
  on conflict (user_id) do update set
    access_token = excluded.access_token,
    refresh_token = coalesce(excluded.refresh_token, private.roblox_tokens.refresh_token),
    expires_at = excluded.expires_at,
    updated_at = now()
$$;

create or replace function public._roblox_delete_token(p_user uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from private.roblox_tokens where user_id = p_user
$$;

revoke execute on function public._roblox_get_token(uuid) from public, anon, authenticated;
revoke execute on function public._roblox_save_token(uuid, text, text, timestamptz) from public, anon, authenticated;
revoke execute on function public._roblox_delete_token(uuid) from public, anon, authenticated;
grant execute on function public._roblox_get_token(uuid) to service_role;
grant execute on function public._roblox_save_token(uuid, text, text, timestamptz) to service_role;
grant execute on function public._roblox_delete_token(uuid) to service_role;

-- Desconectar a conta Roblox apaga também os tokens.
create or replace function public.roblox_accounts_after_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from private.roblox_tokens where user_id = old.user_id;
  return old;
end
$$;

create trigger roblox_accounts_cleanup after delete on public.roblox_accounts
  for each row execute function public.roblox_accounts_after_delete();
