// NEXUS — @Claude nos canais de texto.
// POST { message_id } — a mensagem precisa ser da própria pessoa e mencionar @Claude.
// Responde na hora (202) e o Claude publica a resposta no canal em seguida.
import { handleError, HttpError, json, preflight, readJson, runInBackground } from '../_shared/http.ts';
import { adminClient, requireUser, rpc, userClient } from '../_shared/supabase.ts';
import { apiKey, createMessage, estimateCost, textOf } from '../_shared/anthropic.ts';
import { baseSystemPrompt, projectContext } from '../_shared/context.ts';

interface Quota {
  allowed: boolean;
  reason: string | null;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  try {
    const { user, token } = await requireUser(req);
    const { message_id } = await readJson<{ message_id: string }>(req);
    if (!message_id) throw new HttpError(400, 'Mensagem não informada.');
    const admin = adminClient();

    const { data: msg } = await admin.from('messages').select('*').eq('id', message_id).maybeSingle();
    if (!msg || msg.author_id !== user.id || !msg.channel_id) throw new HttpError(404, 'Mensagem não encontrada.');
    if (!msg.mentions_claude) throw new HttpError(400, 'A mensagem não menciona @Claude.');

    const { data: channel } = await admin.from('channels').select('id, name, server_id, claude_enabled, topic').eq('id', msg.channel_id).single();
    if (!channel?.claude_enabled) throw new HttpError(403, 'O @Claude está desativado neste canal.');
    const allowed = await rpc<boolean>(admin, '_can_use_claude_in_server', { p_server: channel.server_id, p_user: user.id });
    if (!allowed) throw new HttpError(403, 'Você não tem permissão para usar o Claude neste servidor (cargo com "Usar o Claude" em servidor do administrador).');
    const quota = (await rpc<Quota[]>(admin, '_claude_quota', { p_user: user.id }))[0];
    if (!quota?.allowed) throw new HttpError(403, quota?.reason ?? 'Claude indisponível.');
    apiKey();

    // Evita resposta duplicada para a mesma mensagem.
    const { error: dup } = await admin
      .from('claude_channel_requests')
      .insert({ message_id, channel_id: channel.id, requested_by: user.id });
    if (dup) return json({ status: 'duplicate' });

    const { data: pending } = await admin
      .from('messages')
      .insert({
        channel_id: channel.id,
        author_id: null,
        author_kind: 'claude',
        content: '',
        meta: { status: 'pending', requested_by: user.id },
        reply_to: message_id,
      })
      .select('id')
      .single();

    runInBackground(answer({ admin, token, userId: user.id, channel, messageId: message_id, replyId: pending!.id }));
    return json({ status: 'accepted', reply_id: pending!.id }, 202);
  } catch (err) {
    return handleError(err);
  }
});

async function answer(opts: {
  admin: ReturnType<typeof adminClient>;
  token: string;
  userId: string;
  channel: { id: string; name: string; server_id: string; topic: string | null };
  messageId: string;
  replyId: string;
}) {
  const { admin, token, userId, channel, messageId, replyId } = opts;
  try {
    const [{ data: server }, { data: settings }, { data: profile }, { data: recent }] = await Promise.all([
      admin.from('servers').select('name').eq('id', channel.server_id).single(),
      admin.from('app_settings').select('claude_model').single(),
      admin.from('profiles').select('display_name, username').eq('id', userId).single(),
      admin
        .from('messages')
        .select('id, author_id, author_kind, content, attachments, created_at')
        .eq('channel_id', channel.id)
        .neq('id', replyId)
        .order('created_at', { ascending: false })
        .limit(30),
    ]);
    const ids = Array.from(new Set((recent ?? []).map((m) => m.author_id).filter(Boolean)));
    const { data: people } = ids.length ? await admin.from('profiles').select('id, display_name, username').in('id', ids) : { data: [] };
    const who = (m: { author_id: string | null; author_kind: string }) =>
      m.author_kind === 'claude' ? 'Claude' : people?.find((p) => p.id === m.author_id)?.display_name ?? 'alguém';

    const transcript = (recent ?? [])
      .reverse()
      .map((m) => {
        const files = Array.isArray(m.attachments) && m.attachments.length ? ` [anexos: ${m.attachments.map((a: { name: string }) => a.name).join(', ')}]` : '';
        return `${who(m)}: ${m.content}${files}${m.id === messageId ? '   ← PEDIDO PARA VOCÊ' : ''}`;
      })
      .join('\n');

    // Contexto dos projetos do servidor (com a identidade de quem chamou).
    let context = '';
    try {
      const uc = userClient(token);
      const { data: projects } = await uc.from('projects').select('id').eq('server_id', channel.server_id).neq('status', 'arquivado').limit(3);
      for (const p of projects ?? []) context += '\n' + (await projectContext(uc, p.id));
    } catch (err) {
      console.error('contexto falhou', err);
    }

    const model = settings?.claude_model ?? 'claude-sonnet-5-5';
    const system = baseSystemPrompt(
      profile ?? { display_name: 'Pessoa', username: 'usuario' },
      [
        `\nVocê está no canal #${channel.name} do servidor "${server?.name ?? ''}" no NEXUS, respondendo a quem te chamou com @Claude.`,
        'Várias pessoas leem o canal. Seja breve (até ~12 linhas, salvo se pedirem detalhes), use o nome das pessoas quando fizer sentido e não repita a pergunta.',
        'Você só vê as mensagens recentes deste canal e o contexto abaixo.',
        context ? `\n# Contexto dos projetos\n${context}` : '',
      ].join('\n'),
    );

    const res = await createMessage({
      model,
      max_tokens: 2000,
      system,
      messages: [{ role: 'user', content: `Mensagens recentes do canal #${channel.name}:\n\n${transcript}\n\nResponda ao pedido marcado.` }],
    });
    const text = textOf(res.content) || 'Não consegui gerar uma resposta agora.';
    await admin.from('messages').update({ content: text.slice(0, 4000), meta: { status: 'done', requested_by: userId, model: res.model } }).eq('id', replyId);
    await admin.rpc('_record_ai_usage', {
      p_user: userId,
      p_input: res.usage.input_tokens,
      p_output: res.usage.output_tokens,
      p_cost: estimateCost(res.model, res.usage.input_tokens, res.usage.output_tokens),
    });
    await admin.from('claude_channel_requests').update({ status: 'respondido', reply_message_id: replyId }).eq('message_id', messageId);
  } catch (err) {
    const message = err instanceof HttpError ? err.message : 'O Claude não conseguiu responder agora.';
    console.error('claude-channel falhou', err);
    await admin.from('messages').update({ meta: { status: 'error', requested_by: userId, error: message } }).eq('id', replyId);
    await admin.from('claude_channel_requests').update({ status: 'erro', error: message }).eq('message_id', messageId);
  }
}
