export type Permission =
  | 'admin'
  | 'manage_server'
  | 'manage_channels'
  | 'manage_roles'
  | 'create_invites'
  | 'kick_members'
  | 'ban_members'
  | 'send_messages'
  | 'attach_files'
  | 'manage_messages'
  | 'mention_everyone'
  | 'connect_voice'
  | 'speak'
  | 'video'
  | 'share_screen'
  | 'move_members'
  | 'use_claude'
  | 'view_projects'
  | 'manage_projects'
  | 'view_files'
  | 'manage_files'
  | 'view_finance'
  | 'manage_finance'
  | 'view_roblox';

export interface PermissionInfo {
  key: Permission;
  label: string;
  description: string;
  group: 'Geral' | 'Mensagens' | 'Voz' | 'NEXUS IA' | 'Projetos e arquivos' | 'Finanças e Roblox';
  sensitive?: boolean;
}

export const PERMISSIONS: PermissionInfo[] = [
  { key: 'admin', label: 'Administrador', description: 'Todas as permissões. Dê só para pessoas de total confiança.', group: 'Geral', sensitive: true },
  { key: 'manage_server', label: 'Gerenciar servidor', description: 'Alterar nome, imagens e configurações do servidor.', group: 'Geral' },
  { key: 'manage_channels', label: 'Gerenciar canais', description: 'Criar, editar e excluir canais, e ver canais privados.', group: 'Geral' },
  { key: 'manage_roles', label: 'Gerenciar cargos', description: 'Criar cargos e atribuí-los (exceto administrador).', group: 'Geral' },
  { key: 'create_invites', label: 'Criar convites', description: 'Gerar links de convite para o servidor.', group: 'Geral' },
  { key: 'kick_members', label: 'Expulsar membros', description: 'Remover pessoas do servidor.', group: 'Geral' },
  { key: 'ban_members', label: 'Banir membros', description: 'Remover e impedir que a pessoa volte.', group: 'Geral' },
  { key: 'send_messages', label: 'Enviar mensagens', description: 'Escrever nos canais de texto.', group: 'Mensagens' },
  { key: 'attach_files', label: 'Enviar arquivos', description: 'Anexar imagens e arquivos nas mensagens.', group: 'Mensagens' },
  { key: 'manage_messages', label: 'Gerenciar mensagens', description: 'Apagar mensagens de outras pessoas.', group: 'Mensagens' },
  { key: 'mention_everyone', label: 'Mencionar @todos', description: 'Notificar todo mundo do servidor de uma vez.', group: 'Mensagens' },
  { key: 'connect_voice', label: 'Entrar em calls', description: 'Conectar nos canais de voz.', group: 'Voz' },
  { key: 'speak', label: 'Falar', description: 'Usar o microfone nas calls.', group: 'Voz' },
  { key: 'video', label: 'Vídeo', description: 'Ligar a câmera nas calls.', group: 'Voz' },
  { key: 'share_screen', label: 'Compartilhar tela', description: 'Transmitir a tela ou uma janela.', group: 'Voz' },
  { key: 'move_members', label: 'Mover membros', description: 'Tirar pessoas de calls.', group: 'Voz' },
  { key: 'use_claude', label: 'Usar a NEXUS IA', description: 'Chamar @NEXUS e usar o chat da NEXUS IA. O custo da API é do dono do NEXUS.', group: 'NEXUS IA', sensitive: true },
  { key: 'view_projects', label: 'Ver projetos', description: 'Ver projetos, tarefas e bugs.', group: 'Projetos e arquivos' },
  { key: 'manage_projects', label: 'Gerenciar projetos', description: 'Criar e editar projetos, tarefas e versões.', group: 'Projetos e arquivos' },
  { key: 'view_files', label: 'Ver e enviar arquivos', description: 'Acessar a área de arquivos do servidor.', group: 'Projetos e arquivos' },
  { key: 'manage_files', label: 'Gerenciar arquivos', description: 'Editar/excluir arquivos de outras pessoas e ver arquivos privados.', group: 'Projetos e arquivos' },
  { key: 'view_finance', label: 'Ver finanças', description: 'Ver receitas, despesas e relatórios.', group: 'Finanças e Roblox', sensitive: true },
  { key: 'manage_finance', label: 'Gerenciar finanças', description: 'Lançar e editar receitas e despesas.', group: 'Finanças e Roblox', sensitive: true },
  { key: 'view_roblox', label: 'Ver métricas do Roblox', description: 'Ver jogadores online e visitas dos jogos vinculados.', group: 'Finanças e Roblox' },
];

export function hasPerm(perms: string[] | undefined | null, p: Permission): boolean {
  if (!perms) return false;
  return perms.includes('admin') || perms.includes(p);
}
