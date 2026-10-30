// Tipos das tabelas do banco (espelham supabase/migrations).

export interface Profile {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  accent_color: string | null;
  created_at: string;
}

export interface AppSettings {
  signup_open: boolean;
  claude_model: string;
  claude_task_model: string;
  claude_daily_tokens_per_user: number;
  claude_monthly_budget_usd: number;
  companion_max_concurrent_tasks: number;
  voice_agent_ready?: boolean;
}

export interface Server {
  id: string;
  name: string;
  description: string | null;
  icon_url: string | null;
  banner_url: string | null;
  owner_id: string;
  is_public: boolean;
  created_at: string;
}

export interface Role {
  id: string;
  server_id: string;
  name: string;
  color: string | null;
  position: number;
  permissions: string[];
  is_default: boolean;
  hoist: boolean;
}

export interface Member {
  server_id: string;
  user_id: string;
  nickname: string | null;
  joined_at: string;
}

export interface MemberRole {
  server_id: string;
  user_id: string;
  role_id: string;
}

export type ChannelKind = 'text' | 'voice';

export interface Channel {
  id: string;
  server_id: string;
  name: string;
  kind: ChannelKind;
  topic: string | null;
  position: number;
  is_private: boolean;
  user_limit: number | null;
  claude_enabled: boolean;
  created_at: string;
}

export interface Invite {
  code: string;
  server_id: string;
  created_by: string | null;
  max_uses: number | null;
  uses: number;
  expires_at: string | null;
  created_at: string;
}

export interface Attachment {
  path: string;
  name: string;
  size: number;
  type: string;
  width?: number;
  height?: number;
}

export interface Message {
  id: string;
  channel_id: string | null;
  server_id: string | null;
  dm_thread_id: string | null;
  author_id: string | null;
  author_kind: 'user' | 'claude' | 'system';
  content: string;
  attachments: Attachment[];
  mentions: string[];
  mentions_claude: boolean;
  mentions_everyone: boolean;
  reply_to: string | null;
  meta: { status?: 'pending' | 'done' | 'error'; requested_by?: string; model?: string; error?: string } & Record<string, unknown>;
  edited_at: string | null;
  created_at: string;
  /** Somente no cliente: mensagem ainda sendo enviada. */
  _pending?: boolean;
  _failed?: boolean;
}

export interface DmThread {
  id: string;
  is_group: boolean;
  name: string | null;
  created_at: string;
  last_message_at: string | null;
  participants: string[];
  hidden: boolean;
}

export interface NotificationRow {
  id: string;
  user_id: string;
  kind: 'mention' | 'dm' | 'invite' | 'task' | 'question' | 'claude' | 'system';
  title: string;
  body: string | null;
  link: {
    server_id?: string;
    channel_id?: string;
    dm_thread_id?: string;
    message_id?: string;
    task_id?: string;
    question_id?: string;
  };
  read_at: string | null;
  created_at: string;
}

export interface UnreadRow {
  target_id: string;
  kind: 'channel' | 'dm';
  server_id: string | null;
  unread: number;
  mentions: number;
}

export interface Project {
  id: string;
  server_id: string;
  name: string;
  description: string | null;
  status: 'planejamento' | 'ativo' | 'pausado' | 'lancado' | 'arquivado';
  color: string | null;
  roblox_place_id: number | null;
  roblox_universe_id: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type TaskStatus = 'a_fazer' | 'em_andamento' | 'em_revisao' | 'concluida' | 'cancelada';
export type TaskPriority = 'baixa' | 'media' | 'alta' | 'critica';
export type TaskKind = 'tarefa' | 'bug' | 'melhoria';

export interface ProjectTask {
  id: string;
  project_id: string;
  server_id: string;
  title: string;
  description: string | null;
  kind: TaskKind;
  status: TaskStatus;
  priority: TaskPriority;
  assignee_id: string | null;
  due_date: string | null;
  labels: string[];
  position: number;
  created_by: string | null;
  created_by_kind: 'user' | 'claude';
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface ProjectVersion {
  id: string;
  project_id: string;
  server_id: string;
  version: string;
  notes: string | null;
  status: 'planejada' | 'em_teste' | 'publicada' | 'revertida';
  released_at: string | null;
  created_by: string | null;
  created_at: string;
}

export interface ActivityRow {
  id: number;
  server_id: string;
  project_id: string | null;
  actor_id: string | null;
  actor_kind: 'user' | 'claude' | 'system';
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  summary: string;
  details: Record<string, unknown>;
  created_at: string;
}

export type FileKind = 'arquivo' | 'imagem' | 'modelo3d' | 'documento' | 'referencia' | 'link' | 'ideia' | 'cronograma' | 'script';

export interface FileRow {
  id: string;
  server_id: string;
  project_id: string | null;
  folder: string;
  name: string;
  kind: FileKind;
  storage_path: string | null;
  url: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  description: string | null;
  tags: string[];
  visibility: 'servidor' | 'privado';
  uploaded_by: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export type Currency = 'BRL' | 'USD' | 'ROBUX';

export interface FinanceEntry {
  id: string;
  server_id: string;
  project_id: string | null;
  kind: 'receita' | 'despesa';
  category: string;
  description: string | null;
  amount: number;
  gross_amount: number | null;
  fee_amount: number | null;
  currency: Currency;
  status: 'estimado' | 'pendente' | 'recebido' | 'pago' | 'cancelado';
  occurred_on: string;
  payee_id: string | null;
  source: 'manual' | 'roblox_import' | 'csv_import';
  external_ref: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

export interface FinanceSummaryRow {
  currency: Currency;
  receita_recebida: number;
  receita_pendente: number;
  receita_estimada: number;
  receita_bruta: number;
  taxas: number;
  despesa_paga: number;
  despesa_pendente: number;
  despesa_estimada: number;
  resultado_recebido: number;
  resultado_previsto: number;
  lancamentos: number;
}

export interface RobloxExperience {
  id: string;
  server_id: string;
  project_id: string | null;
  universe_id: number;
  root_place_id: number | null;
  name: string | null;
  added_by: string | null;
  created_at: string;
}

export interface RobloxStat {
  id: number;
  universe_id: number;
  name: string | null;
  playing: number | null;
  visits: number | null;
  favorites: number | null;
  max_players: number | null;
  source: string;
  fetched_at: string;
}

export interface AiConversation {
  id: string;
  owner_id: string;
  title: string;
  server_id: string | null;
  project_id: string | null;
  model: string | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface AiMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  attachments: Array<{ name: string; type: string; size: number }>;
  status: 'streaming' | 'done' | 'error' | 'cancelled';
  error: string | null;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  created_at: string;
}

export interface ClaudeQuota {
  allowed: boolean;
  daily_limit: number;
  used_today: number;
  remaining: number;
  month_cost_usd: number;
  month_budget_usd: number;
  reason: string | null;
}

export type CompanionMode = 'quando_chamado' | 'participante_ativo' | 'segundo_plano' | 'hibrido';

export interface CompanionSettings {
  user_id: string;
  mode: CompanionMode;
  max_concurrent_tasks: number;
  voice_enabled: boolean;
  transcript_retention_days: number;
  voice_option?: 'voz1' | 'voz2';
  voice_speed?: 'lenta' | 'normal' | 'rapida';
  voice_greeting?: boolean;
}

export interface VoiceSession {
  id: string;
  server_id: string;
  channel_id: string;
  room: string;
  inviter_id: string | null;
  status: 'chamando' | 'na_call' | 'encerrada' | 'falhou';
  ended_reason: string | null;
  started_at: string;
  ended_at: string | null;
}

export type CompanionTaskStatus =
  | 'aguardando'
  | 'executando'
  | 'aguardando_confirmacao'
  | 'bloqueada'
  | 'concluida'
  | 'falhou'
  | 'cancelada';

export interface CompanionTask {
  id: string;
  owner_id: string;
  server_id: string | null;
  project_id: string | null;
  title: string;
  instructions: string;
  status: CompanionTaskStatus;
  blocked_reason: string | null;
  progress: number;
  progress_note: string | null;
  priority: 'baixa' | 'media' | 'alta';
  required_scopes: string[];
  resource_key: string | null;
  result: string | null;
  error: string | null;
  steps: number;
  max_steps: number;
  attempts: number;
  input_tokens: number;
  output_tokens: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  heartbeat_at: string | null;
  updated_at: string;
}

export interface CompanionQuestion {
  id: string;
  task_id: string | null;
  owner_id: string;
  question: string;
  options: string[];
  urgency: 'baixa' | 'media' | 'alta';
  route: 'call' | 'notificacao' | 'chat_tarefas' | 'pendencias';
  blocking: boolean;
  status: 'pendente' | 'respondida' | 'descartada';
  answer: string | null;
  created_at: string;
  answered_at: string | null;
}

export interface CompanionLog {
  id: number;
  owner_id: string;
  task_id: string | null;
  level: 'info' | 'aviso' | 'erro';
  event: string;
  message: string;
  details: Record<string, unknown>;
  created_at: string;
}

export interface CompanionPermission {
  user_id: string;
  scope: string;
  granted: boolean;
  updated_at: string;
}

/** Estado publicado no canal de presença do servidor. */
export interface PresenceState {
  user_id: string;
  status: 'online' | 'idle' | 'dnd';
  voice: null | {
    channel_id: string;
    muted: boolean;
    deafened: boolean;
    video: boolean;
    screen: boolean;
  };
  device: string;
  at: number;
}
