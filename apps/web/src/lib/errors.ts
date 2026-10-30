// Mensagens de erro claras em português.
const MAP: Array<[RegExp, string]> = [
  [/invalid login credentials/i, 'E-mail ou senha incorretos.'],
  [/email not confirmed/i, 'Confirme seu e-mail antes de entrar (veja sua caixa de entrada e o spam).'],
  [/user already registered|already been registered/i, 'Este e-mail já tem uma conta. Tente entrar ou recuperar a senha.'],
  [/password should be at least|weak password|password is too weak/i, 'Senha fraca. Use pelo menos 8 caracteres, misturando letras e números.'],
  [/email address not authorized|not authorized to send/i, 'O servidor ainda não está enviando e-mails para este endereço. Peça ao administrador do NEXUS para configurar o envio de e-mails (SMTP).'],
  [/error sending (recovery|confirmation|magic link) email|smtp/i, 'O servidor não conseguiu enviar o e-mail agora. Tente mais tarde ou fale com o administrador do NEXUS.'],
  [/rate limit|too many requests|over_email_send_rate_limit/i, 'Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.'],
  [/signups not allowed|signup is disabled/i, 'Novos cadastros estão desativados neste servidor.'],
  [/row-level security|permission denied|42501/i, 'Você não tem permissão para fazer isso.'],
  [/jwt expired|invalid jwt|session.*expired/i, 'Sua sessão expirou. Entre novamente.'],
  [/failed to fetch|networkerror|network request failed|load failed/i, 'Sem conexão com o servidor. Verifique sua internet.'],
  [/duplicate key value.*username/i, 'Este nome de usuário já está em uso.'],
  [/duplicate key/i, 'Esse item já existe.'],
  [/violates check constraint.*username/i, 'Nome de usuário inválido: use 3 a 32 letras minúsculas, números, "_" ou ".".'],
  [/violates check constraint/i, 'Algum dado está fora do formato aceito.'],
  [/payload too large|exceeded the maximum allowed size|entity too large/i, 'O arquivo é grande demais para este servidor.'],
  [/mime type .* is not supported/i, 'Tipo de arquivo não permitido aqui.'],
];

export function friendlyError(err: unknown): string {
  if (!err) return 'Algo deu errado.';
  const raw =
    typeof err === 'string'
      ? err
      : (err as { message?: string }).message || (err as { error_description?: string }).error_description || String(err);
  for (const [re, msg] of MAP) {
    if (re.test(raw)) return msg;
  }
  // Mensagens do banco do NEXUS já são escritas em português.
  return raw.length > 300 ? raw.slice(0, 300) + '…' : raw;
}
