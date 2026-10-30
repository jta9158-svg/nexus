-- =====================================================================
-- NEXUS — Situação real da NEXUS IA (API do Claude)
-- O servidor guarda o resultado da última verificação ("ok", "sem créditos"
-- ou "erro") para o app mostrar a verdade e não chamar a IA para a call
-- quando ela não consegue responder.
-- =====================================================================
alter table public.app_settings
  add column if not exists ai_status text check (ai_status is null or ai_status in ('ok', 'sem_creditos', 'erro')),
  add column if not exists ai_status_message text check (ai_status_message is null or char_length(ai_status_message) <= 500),
  add column if not exists ai_checked_at timestamptz;
