// Testes reais do banco do NEXUS (PostgreSQL 18 via PGlite).
// Aplica as migrações sobre um ambiente que imita o Supabase e verifica
// as regras de acesso (RLS) com usuários diferentes.
// Uso: cd supabase/tests && npm install && node run.mjs
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, '..', 'migrations');

const db = new PGlite();
let passed = 0;
let failed = 0;
const failures = [];

function ok(cond, name, extra) {
  if (cond) {
    passed++;
    console.log(`  ✔ ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  ✘ ${name}${extra !== undefined ? ' → ' + JSON.stringify(extra) : ''}`);
  }
}

async function asUser(user, sql, params = [], role = 'authenticated') {
  await db.exec('begin');
  try {
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify(user ? { sub: user, role } : { role }),
    ]);
    await db.exec(`set local role ${role}`);
    const res = await db.query(sql, params);
    await db.exec('commit');
    return res;
  } catch (err) {
    await db.exec('rollback');
    throw err;
  }
}

async function denied(user, sql, params = []) {
  try {
    await asUser(user, sql, params);
    return false;
  } catch (err) {
    return err.message || true;
  }
}

async function service(sql, params = []) {
  return asUser(null, sql, params, 'service_role');
}

async function topic(user, t) {
  await db.exec('begin');
  try {
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: user, role: 'authenticated' })]);
    await db.query(`select set_config('realtime.topic', $1, true)`, [t]);
    await db.exec('set local role authenticated');
    const r = await db.query(`select public.realtime_topic_allowed(realtime.topic()) as ok`);
    await db.exec('commit');
    return r.rows[0].ok;
  } catch (e) {
    await db.exec('rollback');
    throw e;
  }
}

const one = (r) => r.rows[0];

async function main() {
  console.log('• Preparando ambiente (imitação do Supabase)');
  await db.exec(readFileSync(resolve(here, 'bootstrap.sql'), 'utf8'));

  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    try {
      await db.exec(readFileSync(resolve(migrationsDir, f), 'utf8'));
      console.log(`  migração aplicada: ${f}`);
    } catch (err) {
      console.error(`\n✘ Falha ao aplicar ${f}: ${err.message}`);
      throw err;
    }
  }

  // ------------------------------------------------------------------
  console.log('\n• Cadastro e perfis');
  const mk = async (email, meta) =>
    one(await db.query(`insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`, [email, meta])).id;
  const A = await mk('jose@exemplo.com', { username: 'jose', display_name: 'JoseAdriano' });
  const B = await mk('matheus@exemplo.com', { username: 'matheus', display_name: 'Matheus' });
  const C = await mk('intruso@exemplo.com', { username: 'intruso', display_name: 'Intruso' });
  const D = await mk('marina@exemplo.com', { username: 'marina', display_name: 'Marina' });
  const E = await mk('claude@exemplo.com', { username: 'claude', display_name: 'Falso Claude' });
  const F = await mk('tester@exemplo.com', { username: 'tester', display_name: 'Tester' });

  const profA = one(await asUser(A, `select username, display_name from public.profiles where id = $1`, [A]));
  ok(profA.username === 'jose' && profA.display_name === 'JoseAdriano', 'perfil criado com nome de usuário e nome de exibição');
  const profE = one(await asUser(A, `select username from public.profiles where id = $1`, [E]));
  ok(profE.username !== 'claude', 'nome reservado "claude" não pode ser usado por pessoas', profE.username);
  ok(one(await asUser(A, `select public.is_app_admin() as x`)).x === true, 'primeiro usuário vira administrador do app');
  ok(one(await asUser(B, `select public.is_app_admin() as x`)).x === false, 'segundo usuário não é administrador');
  ok(one(await db.query(`select public.username_available('jose') as x`)).x === false, 'username_available detecta nome em uso');
  ok(one(await db.query(`select public.username_available('novo_nome') as x`)).x === true, 'username_available aceita nome livre');
  ok(!!(await denied(B, `update public.profiles set display_name = 'hack' where id = $1`, [A])) ||
     one(await asUser(A, `select display_name from public.profiles where id = $1`, [A])).display_name === 'JoseAdriano',
     'ninguém altera o perfil de outra pessoa');

  // ------------------------------------------------------------------
  console.log('\n• Servidores, canais e cargos');
  const S = one(await asUser(A, `select public.create_server('ALPHA - Templo da Magia', 'estudio') as id`)).id;
  const chans = (await asUser(A, `select id, name, kind from public.channels where server_id = $1 order by position`, [S])).rows;
  ok(chans.length === 10, 'servidor modelo "estúdio" cria 6 canais de texto e 4 de voz', chans.length);
  const roles = (await asUser(A, `select id, name from public.roles where server_id = $1 order by position`, [S])).rows;
  ok(roles.length === 6, 'cargos padrão criados (@todos, Admin, Desenvolvedor, Scripter, Modelador, Tester)', roles.map((r) => r.name));
  const geral = chans.find((c) => c.name === 'geral').id;
  const roleDev = roles.find((r) => r.name === 'Desenvolvedor').id;
  const roleAdmin = roles.find((r) => r.name === 'Admin').id;

  ok((await asUser(C, `select * from public.servers where id = $1`, [S])).rows.length === 0, 'quem não é membro não vê servidor privado');
  ok((await asUser(C, `select * from public.channels where server_id = $1`, [S])).rows.length === 0, 'quem não é membro não vê canais');
  ok(!!(await denied(C, `insert into public.servers (name, owner_id) values ('x', $1)`, [C])), 'servidor só é criado pela função segura');

  const code = one(await asUser(A, `insert into public.invites (server_id, created_by) values ($1, $2) returning code`, [S, A])).code;
  ok(typeof code === 'string' && code.length === 10, 'convite gerado', code);
  const prev = one(await asUser(B, `select * from public.preview_invite($1)`, [code]));
  ok(prev && prev.valid === true && prev.name === 'ALPHA - Templo da Magia', 'prévia do convite funciona');
  await asUser(B, `select public.join_server_by_invite($1)`, [code]);
  await asUser(D, `select public.join_server_by_invite($1)`, [code]);
  await asUser(F, `select public.join_server_by_invite($1)`, [code]);
  ok((await asUser(B, `select * from public.channels where server_id = $1`, [S])).rows.length === 10, 'membro convidado vê os canais');
  ok(one(await asUser(A, `select uses from public.invites where code = $1`, [code])).uses === 3, 'uso do convite contabilizado');
  ok(!!(await denied(B, `insert into public.channels (server_id, name, kind) values ($1, 'hack', 'text')`, [S])), 'membro comum não cria canais');
  ok(!!(await denied(B, `update public.servers set owner_id = $2 where id = $1`, [S, B])), 'ninguém troca o dono por update direto');

  // ------------------------------------------------------------------
  console.log('\n• Mensagens e menções');
  const m1 = one(await asUser(B, `insert into public.messages (channel_id, author_id, content) values ($1, $2, 'Beleza @jose, vi as tarefas do mapa') returning id, server_id, mentions`, [geral, B]));
  ok(m1.server_id === S, 'mensagem recebe o servidor automaticamente');
  ok(Array.isArray(m1.mentions) && m1.mentions.includes(A), 'menção @jose reconhecida', m1.mentions);
  const notifA = (await asUser(A, `select * from public.notifications where user_id = $1 and kind = 'mention'`, [A])).rows;
  ok(notifA.length === 1 && notifA[0].title.includes('#geral'), 'notificação de menção criada para o mencionado');
  ok((await asUser(C, `select * from public.notifications where user_id = $1`, [A])).rows.length === 0, 'notificações são privadas');
  ok((await asUser(C, `select * from public.messages where channel_id = $1`, [geral])).rows.length === 0, 'quem não é membro não lê mensagens');
  ok(!!(await denied(C, `insert into public.messages (channel_id, author_id, content) values ($1, $2, 'invasão')`, [geral, C])), 'quem não é membro não envia mensagens');
  ok(!!(await denied(B, `insert into public.messages (channel_id, author_id, author_kind, content) values ($1, $2, 'claude', 'fingindo')`, [geral, B])), 'pessoa não consegue se passar pelo Claude');
  ok(!!(await denied(B, `insert into public.messages (channel_id, author_id, content) values ($1, $2, 'em nome de outro')`, [geral, A])), 'pessoa não envia mensagem em nome de outra');
  const mClaude = one(await asUser(B, `insert into public.messages (channel_id, author_id, content) values ($1, $2, '@Claude qual o status do ALPHA?') returning mentions_claude`, [geral, B]));
  ok(mClaude.mentions_claude === true, '@Claude é detectado');
  await asUser(B, `update public.messages set content = 'Beleza @jose, vi as tarefas do mapa (editado)' where id = $1`, [m1.id]);
  ok(one(await asUser(A, `select edited_at from public.messages where id = $1`, [m1.id])).edited_at !== null, 'edição marca a mensagem como editada');
  const mA = one(await asUser(A, `insert into public.messages (channel_id, author_id, content) values ($1, $2, 'Mensagem do dono') returning id`, [geral, A])).id;
  await asUser(B, `delete from public.messages where id = $1`, [mA]);
  ok((await asUser(A, `select 1 from public.messages where id = $1`, [mA])).rows.length === 1, 'membro comum não apaga mensagem de outra pessoa');
  const mB2 = one(await asUser(B, `insert into public.messages (channel_id, author_id, content) values ($1, $2, 'vou apagar') returning id`, [geral, B])).id;
  await asUser(A, `delete from public.messages where id = $1`, [mB2]);
  ok((await asUser(A, `select 1 from public.messages where id = $1`, [mB2])).rows.length === 0, 'dono (moderação) apaga mensagens');
  const found = (await asUser(B, `select id from public.search_messages('taref')`)).rows;
  ok(found.some((r) => r.id === m1.id), 'busca por prefixo em português encontra mensagens', found.length);
  ok((await asUser(C, `select id from public.search_messages('tarefas')`)).rows.length === 0, 'busca não vaza mensagens para quem não tem acesso');

  // ------------------------------------------------------------------
  console.log('\n• Não lidas');
  const unreadA = (await asUser(A, `select * from public.unread_summary()`)).rows;
  const geralA = unreadA.find((r) => r.target_id === geral);
  ok(geralA && geralA.unread >= 2 && geralA.mentions >= 1, 'contador de não lidas e menções', geralA);
  await asUser(A, `select public.mark_read($1)`, [geral]);
  ok(!(await asUser(A, `select * from public.unread_summary()`)).rows.some((r) => r.target_id === geral), 'marcar como lido zera o contador');
  ok((await asUser(C, `select public.mark_read($1)`, [geral])) && (await asUser(C, `select * from public.read_states`)).rows.length === 0, 'não marca leitura de canal sem acesso');

  // ------------------------------------------------------------------
  console.log('\n• Canais privados e cargos');
  const staff = one(await asUser(A, `insert into public.channels (server_id, name, kind, is_private) values ($1, 'staff', 'text', true) returning id`, [S])).id;
  ok((await asUser(B, `select 1 from public.channels where id = $1`, [staff])).rows.length === 0, 'canal privado escondido de quem não tem acesso');
  await asUser(A, `insert into public.channel_access (channel_id, role_id) values ($1, $2)`, [staff, roleDev]);
  await asUser(A, `insert into public.member_roles (server_id, user_id, role_id) values ($1, $2, $3)`, [S, B, roleDev]);
  ok((await asUser(B, `select 1 from public.channels where id = $1`, [staff])).rows.length === 1, 'cargo com acesso libera o canal privado');
  ok((await asUser(D, `select 1 from public.channels where id = $1`, [staff])).rows.length === 0, 'outros membros continuam sem ver o canal privado');
  const mod = one(await asUser(A, `insert into public.roles (server_id, name, permissions) values ($1, 'Moderador', array['manage_roles']) returning id`, [S])).id;
  await asUser(A, `insert into public.member_roles (server_id, user_id, role_id) values ($1, $2, $3)`, [S, D, mod]);
  ok(!!(await denied(D, `insert into public.roles (server_id, name, permissions) values ($1, 'Golpe', array['admin'])`, [S])), 'quem gerencia cargos não cria cargo de administrador');
  ok(!!(await denied(D, `insert into public.member_roles (server_id, user_id, role_id) values ($1, $2, $3)`, [S, D, roleAdmin])), 'quem gerencia cargos não se dá administrador');
  ok(!!(await denied(D, `update public.roles set permissions = array['admin'] where id = $1`, [mod])), 'não dá para transformar o próprio cargo em administrador');
  ok(!(await denied(D, `insert into public.roles (server_id, name, permissions) values ($1, 'Ajudante', array['send_messages'])`, [S])), 'quem gerencia cargos cria cargos comuns');
  ok(!!(await denied(A, `delete from public.roles where server_id = $1 and is_default`, [S])), 'cargo padrão não pode ser apagado');

  // ------------------------------------------------------------------
  console.log('\n• Mensagens privadas');
  const dm = one(await asUser(B, `select public.open_dm($1) as id`, [A])).id;
  ok(!!dm, 'membros de um mesmo servidor abrem conversa privada');
  ok(one(await asUser(A, `select public.open_dm($1) as id`, [B])).id === dm, 'a mesma conversa é reaproveitada');
  ok(!!(await denied(C, `select public.open_dm($1)`, [A])), 'quem não divide servidor não consegue abrir conversa');
  await asUser(B, `insert into public.messages (dm_thread_id, author_id, content) values ($1, $2, 'oi, tudo certo?')`, [dm, B]);
  ok((await asUser(A, `select 1 from public.messages where dm_thread_id = $1`, [dm])).rows.length === 1, 'participante lê a conversa privada');
  ok((await asUser(D, `select 1 from public.messages where dm_thread_id = $1`, [dm])).rows.length === 0, 'outras pessoas não leem a conversa privada');
  ok((await asUser(A, `select 1 from public.notifications where user_id = $1 and kind = 'dm'`, [A])).rows.length === 1, 'notificação de mensagem privada');

  // ------------------------------------------------------------------
  console.log('\n• Projetos e histórico');
  const P = one(await asUser(A, `insert into public.projects (server_id, name, created_by) values ($1, 'ALPHA — Templo da Magia', $2) returning id`, [S, A])).id;
  ok((await asUser(D, `select 1 from public.projects where id = $1`, [P])).rows.length === 1, 'membros veem projetos');
  ok(!!(await denied(D, `insert into public.project_tasks (project_id, server_id, title, created_by) values ($1, $2, 'x', $3)`, [P, S, D])), 'sem "gerenciar projetos" não cria tarefas');
  const T = one(await asUser(B, `insert into public.project_tasks (project_id, server_id, title, kind, created_by) values ($1, $2, 'Revisar mapa inicial', 'tarefa', $3) returning id`, [P, S, B])).id;
  await asUser(B, `update public.project_tasks set status = 'concluida' where id = $1`, [T]);
  const t = one(await asUser(A, `select status, completed_at from public.project_tasks where id = $1`, [T]));
  ok(t.status === 'concluida' && t.completed_at, 'concluir tarefa registra a data');
  const hist = (await asUser(A, `select action, summary from public.activity_log where project_id = $1 order by id`, [P])).rows;
  ok(hist.some((h) => h.action === 'task.created') && hist.some((h) => h.action === 'task.status' && h.summary.includes('Concluída')), 'histórico de alterações registrado', hist.map((h) => h.summary));
  ok(!!(await denied(B, `insert into public.activity_log (server_id, action, summary) values ($1, 'fake', 'falso')`, [S])), 'histórico não pode ser forjado');

  // ------------------------------------------------------------------
  console.log('\n• Arquivos e storage');
  const F1 = one(await asUser(D, `insert into public.files (server_id, name, kind, url, uploaded_by) values ($1, 'Referência de armadura', 'link', 'https://exemplo.com/ref', $2) returning id`, [S, D])).id;
  ok((await asUser(B, `select 1 from public.files where id = $1`, [F1])).rows.length === 1, 'arquivo compartilhado visível à equipe');
  const F2 = one(await asUser(D, `insert into public.files (server_id, name, kind, storage_path, visibility, uploaded_by) values ($1, 'rascunho.png', 'imagem', $2, 'privado', $3) returning id`, [S, `${S}/x1/rascunho.png`, D])).id;
  ok((await asUser(F, `select 1 from public.files where id = $1`, [F2])).rows.length === 0, 'arquivo privado escondido de outros membros comuns');
  ok((await asUser(B, `select 1 from public.files where id = $1`, [F2])).rows.length === 1, 'cargo com "gerenciar arquivos" vê arquivo privado');
  ok((await asUser(A, `select 1 from public.files where id = $1`, [F2])).rows.length === 1, 'dono do servidor vê arquivo privado (moderação)');
  ok((await asUser(B, `select id from public.search_files($1, 'armadura')`, [S])).rows.length === 1, 'busca de arquivos');
  const objPath = `c/${geral}/abc/print.png`;
  ok(!(await denied(B, `insert into storage.objects (bucket_id, name, owner_id) values ('attachments', $1, $2)`, [objPath, B])), 'membro envia anexo no canal');
  ok(!!(await denied(C, `insert into storage.objects (bucket_id, name, owner_id) values ('attachments', $1, $2)`, [`c/${geral}/zzz/x.png`, C])), 'quem não é membro não envia anexo');
  ok((await asUser(D, `select 1 from storage.objects where name = $1`, [objPath])).rows.length === 1, 'membro baixa anexo do canal');
  ok((await asUser(C, `select 1 from storage.objects where name = $1`, [objPath])).rows.length === 0, 'quem não é membro não baixa anexo');
  ok(!!(await denied(B, `insert into storage.objects (bucket_id, name, owner_id) values ('avatars', $1, $2)`, [`${A}/avatar.png`, B])), 'ninguém troca o avatar de outra pessoa');

  // ------------------------------------------------------------------
  console.log('\n• Finanças');
  await asUser(A, `insert into public.finance_entries (server_id, project_id, kind, category, amount, gross_amount, fee_amount, currency, status, created_by)
                   values ($1, $2, 'receita', 'roblox_devex', 100, 130, 30, 'BRL', 'recebido', $3)`, [S, P, A]);
  await asUser(A, `insert into public.finance_entries (server_id, kind, category, amount, currency, status, created_by)
                   values ($1, 'receita', 'roblox_robux', 5000, 'ROBUX', 'pendente', $2)`, [S, A]);
  await asUser(A, `insert into public.finance_entries (server_id, kind, category, amount, currency, status, created_by)
                   values ($1, 'despesa', 'pagamento_equipe', 40, 'BRL', 'pago', $2)`, [S, A]);
  ok((await asUser(B, `select 1 from public.finance_entries`)).rows.length === 0, 'finanças escondidas de quem não tem permissão');
  const sum = (await asUser(A, `select * from public.finance_summary($1, current_date - 30, current_date)`, [S])).rows;
  const brl = sum.find((r) => r.currency === 'BRL');
  const rbx = sum.find((r) => r.currency === 'ROBUX');
  ok(brl && Number(brl.receita_recebida) === 100 && Number(brl.taxas) === 30 && Number(brl.receita_bruta) === 130 && Number(brl.resultado_recebido) === 60,
     'resumo separa recebido, bruto, taxas e resultado', brl);
  ok(rbx && Number(rbx.receita_pendente) === 5000 && Number(rbx.receita_recebida) === 0, 'Robux pendente não conta como recebido', rbx);
  ok(!!(await denied(A, `insert into public.finance_entries (server_id, kind, amount, currency, status, source, external_ref, created_by) values
                          ($1, 'receita', 1, 'ROBUX', 'recebido', 'roblox_import', 'tx-1', $2), ($1, 'receita', 1, 'ROBUX', 'recebido', 'roblox_import', 'tx-1', $2)`, [S, A])),
     'importação nunca duplica lançamentos (external_ref)');
  ok(!!(await denied(A, `insert into public.finance_entries (server_id, kind, amount, currency, status, created_by) values ($1, 'despesa', 1, 'BRL', 'recebido', $2)`, [S, A])),
     'despesa não pode ter status "recebido"');

  // ------------------------------------------------------------------
  console.log('\n• Acesso ao Claude (quem paga é o dono)');
  // Estas seções testam o modo "compartilhado" (Claude só para mim desligado).
  ok(one(await service(`select claude_admin_only from public.app_settings`)).claude_admin_only === true, 'padrão: Claude só para o administrador');
  await service(`update public.app_settings set claude_admin_only = false`);
  ok(one(await asUser(A, `select public.can_use_claude() as x`)).x === true, 'administrador usa o Claude');
  ok(one(await asUser(B, `select public.can_use_claude() as x`)).x === true, 'cargo com "usar Claude" em servidor do administrador libera');
  ok(one(await asUser(D, `select public.can_use_claude() as x`)).x === false, 'membro sem cargo não usa o Claude');
  ok(one(await asUser(C, `select public.can_use_claude() as x`)).x === false, 'pessoa de fora não usa o Claude');
  const qC = one(await asUser(C, `select * from public.my_claude_quota()`));
  ok(qC.allowed === false && /liberado/.test(qC.reason), 'cota informa o motivo do bloqueio', qC.reason);
  ok(!!(await denied(B, `insert into public.ai_messages (conversation_id, role, content) values (gen_random_uuid(), 'assistant', 'x')`)), 'respostas do Claude não podem ser forjadas pelo app');
  ok(!!(await denied(C, `select public._record_ai_usage($1, 1, 1, 0)`, [C])), 'uso só é registrado pelo servidor');
  await service(`select public._record_ai_usage($1, 1000, 500, 0.0070)`, [B]);
  const qB = one(await asUser(B, `select * from public.my_claude_quota()`));
  ok(qB.allowed === true && Number(qB.used_today) === 1500, 'uso diário contabilizado', qB);

  // ------------------------------------------------------------------
  console.log('\n• Claude Companion: tarefas, dúvidas, permissões e logs');
  const tk1 = one(await asUser(B, `select public.companion_create_task('Analisar scripts do ALPHA', 'Encontre problemas e proponha correções', $1, 'alta', array['acessar_arquivos'], 'file:combate.lua') as id`, [P])).id;
  const tk2 = one(await asUser(B, `select public.companion_create_task('Revisar o mesmo arquivo', 'Outra análise', $1, 'media', '{}', 'file:combate.lua') as id`, [P])).id;
  ok((await asUser(C, `select 1 from public.companion_tasks where id = $1`, [tk1])).rows.length === 0, 'tarefas do Claude são privadas (Teste J)');
  ok(!!(await denied(D, `select public.companion_create_task('x', 'y')`)), 'quem não tem acesso ao Claude não cria tarefas');
  ok(!!(await denied(B, `update public.companion_tasks set status = 'concluida' where id = $1`, [tk1])), 'app não marca tarefa como concluída sem o executor');
  ok(one(await service(`select public._companion_claim($1) as x`, [tk1])).x === true, 'executor inicia a 1ª tarefa');
  ok(one(await service(`select public._companion_claim($1) as x`, [tk2])).x === false, 'segunda tarefa no mesmo arquivo fica na fila (Teste H)');
  ok(/mesmo recurso/.test(one(await asUser(B, `select progress_note from public.companion_tasks where id = $1`, [tk2])).progress_note || ''), 'motivo da fila é informado');
  const q1 = one(await service(`select public._companion_ask($1, 'Encontrei duas soluções. Qual comportamento você prefere?', '["Opção A","Opção B"]', 'media', true) as id`, [tk1])).id;
  ok(one(await asUser(B, `select status from public.companion_tasks where id = $1`, [tk1])).status === 'aguardando_confirmacao', 'dúvida bloqueante pausa só a tarefa afetada (Teste E)');
  ok((await asUser(B, `select 1 from public.notifications where user_id = $1 and kind = 'question'`, [B])).rows.length === 1, 'dúvida de prioridade média vira notificação');
  ok(!!(await denied(A, `select public.companion_answer_question($1, 'Opção A')`, [q1])), 'outra pessoa não responde a dúvida (mesmo o dono do servidor)');
  await asUser(B, `select public.companion_answer_question($1, 'Opção A')`, [q1]);
  ok(one(await asUser(B, `select status from public.companion_tasks where id = $1`, [tk1])).status === 'aguardando', 'após a resposta a tarefa volta para a fila');
  ok(one(await service(`select public._companion_claim($1) as x`, [tk1])).x === true, 'tarefa retomada pelo executor');
  ok(one(await asUser(B, `select public.companion_task_action($1, 'pausar') as s`, [tk1])).s === 'bloqueada', 'pausar');
  ok(one(await asUser(B, `select public.companion_task_action($1, 'retomar') as s`, [tk1])).s === 'aguardando', 'retomar');
  ok(one(await asUser(B, `select public.companion_task_action($1, 'cancelar') as s`, [tk1])).s === 'cancelada', 'cancelar');
  ok(one(await service(`select public._companion_claim($1) as x`, [tk2])).x === true, 'recurso liberado: a tarefa da fila começa');
  ok(!!(await denied(B, `select public.companion_task_action($1, 'retomar')`, [tk2])), 'transição inválida é recusada');
  ok(!!(await denied(B, `insert into public.companion_permissions (user_id, scope, granted) values ($1, 'executar_comandos', true)`, [B])), 'permissões só mudam pela função registrada');
  await asUser(B, `select public.companion_set_permission('acessar_arquivos', true)`);
  ok(one(await service(`select public._companion_has_scope($1, 'acessar_arquivos') as x`, [B])).x === true, 'permissão concedida');
  ok(one(await service(`select public._companion_has_scope($1, 'executar_comandos') as x`, [B])).x === false, 'permissão não concedida continua negada (Teste G)');
  ok((await asUser(A, `select 1 from public.companion_permissions where user_id = $1`, [B])).rows.length === 0, 'ninguém vê as permissões de outra pessoa');
  // Modos: em "Trabalhador em segundo plano" só a dúvida que bloqueia pede atenção.
  await asUser(B, `insert into public.companion_settings default values on conflict do nothing`);
  await asUser(B, `update public.companion_settings set mode = 'segundo_plano' where user_id = $1`, [B]);
  ok(!!(await denied(B, `update public.companion_settings set mode = 'invadir' where user_id = $1`, [B])), 'modo inválido é recusado');
  const tk3 = one(await asUser(B, `select public.companion_create_task('Auditar inventário', 'Verifique a loja', $1) as id`, [P])).id;
  ok(one(await service(`select public._companion_claim($1) as x`, [tk3])).x === true, 'executor inicia a tarefa em modo segundo plano');
  const notifBefore = (await asUser(B, `select 1 from public.notifications where user_id = $1 and kind = 'question'`, [B])).rows.length;
  const qNb = one(await service(`select public._companion_ask($1, 'Sugestão: renomear a pasta Loja?', '[]', 'media', false) as id`, [tk3])).id;
  const rNb = one(await asUser(B, `select route from public.companion_questions where id = $1`, [qNb]));
  ok(rNb.route === 'pendencias' && (await asUser(B, `select 1 from public.notifications where user_id = $1 and kind = 'question'`, [B])).rows.length === notifBefore,
     'modo segundo plano: dúvida que não bloqueia vai para as pendências, sem notificar', rNb);
  ok(one(await asUser(B, `select status from public.companion_tasks where id = $1`, [tk3])).status === 'executando', 'dúvida que não bloqueia não pausa a tarefa');
  const qBl = one(await service(`select public._companion_ask($1, 'Posso apagar itens duplicados?', '["Sim","Não"]', 'alta', true) as id`, [tk3])).id;
  ok(one(await asUser(B, `select route from public.companion_questions where id = $1`, [qBl])).route === 'notificacao' &&
     (await asUser(B, `select 1 from public.notifications where user_id = $1 and kind = 'question'`, [B])).rows.length === notifBefore + 1,
     'modo segundo plano: dúvida bloqueante notifica');
  await asUser(B, `update public.companion_settings set mode = 'hibrido' where user_id = $1`, [B]);
  const qHy = one(await service(`select public._companion_ask($1, 'Prefere ícones redondos?', '[]', 'media', false) as id`, [tk3])).id;
  ok(one(await asUser(B, `select route from public.companion_questions where id = $1`, [qHy])).route === 'notificacao', 'modo híbrido: dúvida média não bloqueante notifica');
  await asUser(B, `select public.companion_task_action($1, 'cancelar')`, [tk3]);

  const logsB = (await asUser(B, `select event from public.companion_logs where owner_id = $1`, [B])).rows.map((r) => r.event);
  ok(['task.created', 'task.started', 'question.created', 'question.answered', 'task.pausar', 'task.cancelar', 'permission.granted'].every((e) => logsB.includes(e)), 'histórico registra tarefas, dúvidas e permissões', logsB);
  await asUser(B, `delete from public.companion_logs where owner_id = $1`, [B]);
  ok((await asUser(B, `select 1 from public.companion_logs`)).rows.length === 0, 'a pessoa pode excluir os próprios registros');

  // ------------------------------------------------------------------
  console.log('\n• Claude na call (voz)');
  const voice = chans.find((c) => c.kind === 'voice').id;
  const reason0 = one(await service(`select public._voice_invite_check($1, $2) as r`, [voice, B])).r;
  ok(/não foi ativado/.test(reason0 || ''), 'sem o serviço de voz ativado, ninguém chama o Claude', reason0);
  await service(`update public.app_settings set voice_agent_ready = true`);
  const reason1 = one(await service(`select public._voice_invite_check($1, $2) as r`, [voice, B])).r;
  ok(/Ouvir calls/.test(reason1 || ''), 'precisa liberar "ouvir" e "falar" antes (permissões separadas)', reason1);
  await asUser(B, `select public.companion_set_permission('ouvir_call', true)`);
  await asUser(B, `select public.companion_set_permission('falar_call', true)`);
  ok(one(await service(`select public._voice_invite_check($1, $2) as r`, [voice, B])).r === null, 'com cargo e permissões, pode chamar o Claude');
  ok(/cargo/.test(one(await service(`select public._voice_invite_check($1, $2) as r`, [voice, D])).r || ''), 'membro sem "usar o Claude" não chama');
  ok(/permissão para entrar/.test(one(await service(`select public._voice_invite_check($1, $2) as r`, [voice, C])).r || ''), 'quem não é membro não chama (Teste J)');
  ok(/não encontrado/.test(one(await service(`select public._voice_invite_check($1, $2) as r`, [geral, B])).r || ''), 'canal de texto não aceita voz');
  ok(!!(await denied(B, `select public._voice_invite_check($1, $2)`, [voice, B])), 'checagem só roda no servidor');
  const vs = one(await service(`insert into public.voice_sessions (server_id, channel_id, room, inviter_id) values ($1, $2, $3, $4) returning id`, [S, voice, `nexus-${voice}`, B])).id;
  ok(!!(await denied(B, `insert into public.voice_sessions (server_id, channel_id, room, inviter_id) values ($1, $2, $3, $4)`, [S, voice, `nexus-x`, B])), 'app não cria sessão de voz sozinho');
  ok(!!(await service(`insert into public.voice_sessions (server_id, channel_id, room, inviter_id) values ($1, $2, $3, $4)`, [S, voice, `nexus-${voice}`, A]).then(() => false).catch(() => true)), 'no máximo um Claude por canal de voz');
  ok((await asUser(D, `select 1 from public.voice_sessions where id = $1`, [vs])).rows.length === 1, 'membros veem que o Claude está na call');
  ok((await asUser(C, `select 1 from public.voice_sessions where id = $1`, [vs])).rows.length === 0, 'quem não é membro não vê');
  ok(!!(await denied(B, `update public.voice_sessions set status = 'encerrada' where id = $1`, [vs])) ||
     one(await service(`select status from public.voice_sessions where id = $1`, [vs])).status === 'chamando', 'app não altera a sessão de voz');
  ok(one(await service(`select public._voice_can_remove($1, $2) as x`, [voice, B])).x === true, 'quem chamou pode tirar o Claude');
  ok(one(await service(`select public._voice_can_remove($1, $2) as x`, [voice, F])).x === false, 'outro membro comum não tira');
  ok(one(await service(`select public._voice_can_remove($1, $2) as x`, [voice, A])).x === true, 'dono do servidor tira (moderação)');
  await asUser(B, `update public.companion_settings set voice_option = 'voz2', voice_speed = 'rapida', voice_greeting = false where user_id = $1`, [B]);
  const vset = one(await asUser(B, `select voice_option, voice_speed, voice_greeting from public.companion_settings where user_id = $1`, [B]));
  ok(vset.voice_option === 'voz2' && vset.voice_speed === 'rapida' && vset.voice_greeting === false, 'opções de voz salvas pela pessoa');
  ok(!!(await denied(B, `update public.companion_settings set voice_speed = 'turbo' where user_id = $1`, [B])), 'opção de voz inválida é recusada');
  await service(`update public.voice_sessions set status = 'encerrada', ended_at = now() where id = $1`, [vs]);

  // ------------------------------------------------------------------
  console.log('\n• Tempo real (canais privados de presença)');
  ok((await topic(B, `server:${S}`)) === true, 'membro entra no canal de presença do servidor');
  ok((await topic(C, `server:${S}`)) === false, 'quem não é membro não entra (não vê quem está online/na call)');
  ok((await topic(B, `user:${B}`)) === true && (await topic(C, `user:${B}`)) === false, 'canal pessoal só do próprio usuário');
  ok((await topic(A, `dm:${dm}`)) === true && (await topic(D, `dm:${dm}`)) === false, 'canal da conversa privada só dos participantes');

  // ------------------------------------------------------------------
  console.log('\n• Estilo Discord: criar o próprio servidor, convite, PIN, categorias');
  ok(!!(await denied(C, `select public.create_server('x', 'inexistente')`)), 'modelo de servidor desconhecido é recusado');
  const S2 = one(await asUser(C, `select public.create_server('Grupo do Intruso', 'amigos') as id`)).id;
  ok(!!S2, 'qualquer pessoa cria o próprio servidor (modelo "Amigos")');
  const cats2 = (await asUser(C, `select name from public.channel_categories where server_id = $1 order by position`, [S2])).rows.map((x) => x.name);
  ok(cats2.join('|') === 'Canais de texto|Canais de voz', 'modelo já vem com categorias', cats2);
  const ch2 = (await asUser(C, `select id, name, kind, category_id from public.channels where server_id = $1 order by position`, [S2])).rows;
  ok(ch2.length === 5 && ch2.every((x) => x.category_id), 'canais do modelo ficam dentro das categorias', ch2.length);
  const geral2 = ch2.find((x) => x.name === 'geral').id;
  const voice2 = ch2.find((x) => x.kind === 'voice').id;
  ok(one(await asUser(C, `select system_channel_id from public.servers where id = $1`, [S2])).system_channel_id === geral2, '#geral vira o canal de mensagens do sistema');
  const catsS = (await asUser(A, `select name from public.channel_categories where server_id = $1 order by position`, [S])).rows.map((x) => x.name);
  ok(catsS.join('|') === 'Informações|Canais de texto|Canais de voz', 'modelo "Estúdio de jogos" com categoria de informações', catsS);

  // "Serviços" (Faturamento Roblox, Projetos, Finanças, Arquivos) só nos servidores de jogos
  ok(one(await service(`select services_enabled from public.servers where id = $1`, [S])).services_enabled === true &&
     one(await service(`select services_enabled from public.servers where id = $1`, [S2])).services_enabled === false, 'Serviços ligados no "Estúdio de jogos" e desligados no "Amigos"');
  const S3 = one(await asUser(D, `select public.create_server('Clã do Roblox', 'jogos') as id`)).id;
  ok(one(await service(`select services_enabled from public.servers where id = $1`, [S3])).services_enabled === true, 'modelo "Jogos" também mostra os Serviços');
  await asUser(F, `update public.servers set services_enabled = true where id = $1`, [S2]);
  ok(one(await service(`select services_enabled from public.servers where id = $1`, [S2])).services_enabled === false, 'quem não é membro/gerente não liga os Serviços');
  await asUser(C, `update public.servers set services_enabled = true where id = $1`, [S2]);
  ok(one(await service(`select services_enabled from public.servers where id = $1`, [S2])).services_enabled === true, 'o dono liga os Serviços quando quiser');
  await asUser(C, `update public.servers set services_enabled = false where id = $1`, [S2]);
  await asUser(D, `delete from public.servers where id = $1`, [S3]);

  // A IA aparece como "NEXUS IA": @NEXUS chama (o @Claude continua valendo)
  ok(one(await asUser(A, `insert into public.messages (channel_id, author_id, content) values ($1, $2, '@NEXUS como está o ALPHA?') returning mentions_claude`, [geral, A])).mentions_claude === true, '@NEXUS chama a IA no canal');
  ok(one(await asUser(A, `insert into public.messages (channel_id, author_id, content) values ($1, $2, 'fala @nexusfan') returning mentions_claude`, [geral, A])).mentions_claude === false, '@nexusfan não chama a IA');
  await service(`insert into public.messages (channel_id, author_kind, content) values ($1, 'claude', 'Pronto, @matheus: revisei o mapa.')`, [geral]);
  const iaNotif = one(await asUser(B, `select title from public.notifications where user_id = $1 and kind = 'mention' order by created_at desc limit 1`, [B]));
  ok(iaNotif && iaNotif.title.startsWith('NEXUS IA mencionou você'), 'aviso de menção da IA usa o nome NEXUS IA', iaNotif);

  await asUser(C, `update public.servers set is_public = true where id = $1`, [S2]);
  ok(one(await service(`select is_public from public.servers where id = $1`, [S2])).is_public === false, 'não existe servidor público: só entra com link');
  ok((await asUser(F, `select 1 from public.servers where id = $1`, [S2])).rows.length === 0, 'quem não é membro não vê o servidor');
  ok(!!(await denied(F, `select public.join_public_server($1)`, [S2])), 'não dá para entrar sem convite');

  const code2 = one(await asUser(C, `insert into public.invites (server_id, created_by) values ($1, $2) returning code`, [S2, C])).code;
  const anonPrev = one(await asUser(null, `select * from public.preview_invite($1)`, [code2], 'anon'));
  ok(anonPrev && anonPrev.name === 'Grupo do Intruso' && anonPrev.requires_pin === false && anonPrev.valid === true, 'prévia do convite aparece antes do login', anonPrev);
  let jr = one(await asUser(F, `select public.join_server($1) as r`, [code2])).r;
  ok(jr.ok === true && jr.server_id === S2, 'quem tem o link entra no servidor', jr);
  const welcome = (await asUser(C, `select author_id, meta from public.messages where server_id = $1 and author_kind = 'system'`, [S2])).rows;
  ok(welcome.length === 1 && welcome[0].author_id === F && welcome[0].meta.type === 'join', 'aviso "entrou no servidor" no canal do sistema', welcome);
  ok(one(await asUser(F, `select public.join_server($1) as r`, [code2])).r.already_member === true, 'abrir o link de novo não duplica');
  ok(one(await asUser(F, `select already_member from public.preview_invite($1)`, [code2])).already_member === true, 'prévia sabe quem já é membro');

  ok(!!(await denied(F, `insert into public.server_join_pins (server_id, pin) values ($1, '123456')`, [S2])), 'membro comum não define PIN');
  await asUser(C, `insert into public.server_join_pins (server_id, pin) values ($1, '482913')`, [S2]);
  ok((await asUser(F, `select pin from public.server_join_pins where server_id = $1`, [S2])).rows.length === 0, 'só quem gerencia o servidor vê o PIN');
  ok(one(await asUser(C, `select pin from public.server_join_pins where server_id = $1`, [S2])).pin === '482913', 'dono vê o PIN');
  ok(!!(await denied(C, `update public.server_join_pins set pin = '12' where server_id = $1`, [S2])), 'PIN precisa ter de 4 a 8 números');
  ok(one(await asUser(E, `select requires_pin from public.preview_invite($1)`, [code2])).requires_pin === true, 'prévia avisa que o servidor pede PIN');
  jr = one(await asUser(E, `select public.join_server($1) as r`, [code2])).r;
  ok(jr.ok === false && jr.needs_pin === true, 'só com o link (sem PIN) não entra', jr);
  jr = one(await asUser(E, `select public.join_server($1, '000000') as r`, [code2])).r;
  ok(jr.ok === false && /incorreto/.test(jr.reason), 'PIN errado não entra', jr);
  ok(!!(await denied(E, `select public.join_server_by_invite($1)`, [code2])), 'app antigo (sem campo de PIN) não entra em servidor com PIN');
  for (let i = 0; i < 4; i++) await asUser(E, `select public.join_server($1, '111111')`, [code2]);
  jr = one(await asUser(E, `select public.join_server($1, '482913') as r`, [code2])).r;
  ok(jr.ok === false && jr.locked === true, 'depois de 5 erros bloqueia por 15 minutos, mesmo com o PIN certo', jr);
  ok((await asUser(E, `select 1 from public.servers where id = $1`, [S2])).rows.length === 0, 'bloqueado continua de fora');
  ok(!!(await denied(E, `select * from public.join_attempts`)), 'tentativas ficam só no servidor');
  await service(`delete from public.join_attempts where user_id = $1`, [E]); // simula os 15 minutos
  jr = one(await asUser(E, `select public.join_server($1, '482913') as r`, [code2])).r;
  ok(jr.ok === true, 'link + PIN certo entra', jr);

  const expired = one(await asUser(C, `insert into public.invites (server_id, created_by, expires_at) values ($1, $2, now() - interval '1 minute') returning code`, [S2, C])).code;
  jr = one(await asUser(D, `select public.join_server($1, '482913') as r`, [expired])).r;
  ok(jr.ok === false && /expirou/.test(jr.reason), 'link vencido não entra', jr);
  const once = one(await asUser(C, `insert into public.invites (server_id, created_by, max_uses) values ($1, $2, 1) returning code`, [S2, C])).code;
  ok(one(await asUser(D, `select public.join_server($1, '482913') as r`, [once])).r.ok === true, 'link de 1 uso funciona uma vez');
  jr = one(await asUser(A, `select public.join_server($1, '482913') as r`, [once])).r;
  ok(jr.ok === false && /limite/.test(jr.reason), 'e depois não funciona mais', jr);

  ok(!!(await denied(C, `update public.servers set system_channel_id = $1 where id = $2`, [voice2, S2])), 'canal do sistema precisa ser de texto do próprio servidor');
  await asUser(C, `update public.servers set welcome_messages = false where id = $1`, [S2]);
  await asUser(B, `select public.join_server($1, '482913')`, [code2]);
  ok((await asUser(C, `select 1 from public.messages where server_id = $1 and author_kind = 'system'`, [S2])).rows.length === 3, 'aviso de entrada pode ser desligado');

  const catNew = one(await asUser(C, `insert into public.channel_categories (server_id, name, position) values ($1, 'Eventos', 5) returning id`, [S2])).id;
  ok(!!catNew, 'quem gerencia canais cria categoria');
  ok(!!(await denied(F, `insert into public.channel_categories (server_id, name) values ($1, 'hack')`, [S2])), 'membro comum não cria categoria');
  ok((await asUser(F, `select 1 from public.channel_categories where server_id = $1`, [S2])).rows.length === 3, 'membros veem as categorias');
  ok((await asUser(B, `select 1 from public.channel_categories where server_id = $1`, [S])).rows.length === 3 &&
     (await asUser(C, `select 1 from public.channel_categories where server_id = $1`, [S])).rows.length === 0, 'quem não é membro não vê as categorias');
  await asUser(C, `select public.save_channel_layout($1, $2::jsonb, $3::jsonb)`, [S2, JSON.stringify([{ id: catNew, position: 0 }]), JSON.stringify([{ id: geral2, position: 0, category_id: catNew }])]);
  ok(one(await asUser(F, `select category_id from public.channels where id = $1`, [geral2])).category_id === catNew &&
     one(await asUser(F, `select position from public.channel_categories where id = $1`, [catNew])).position === 0, 'arrastar canal e categoria salva a nova ordem');
  ok(!!(await denied(F, `select public.save_channel_layout($1, '[]'::jsonb, $2::jsonb)`, [S2, JSON.stringify([{ id: geral2, position: 9, category_id: null }])])), 'membro comum não reorganiza canais');
  const catOfS = one(await asUser(A, `select id from public.channel_categories where server_id = $1 limit 1`, [S])).id;
  ok(!!(await denied(C, `update public.channels set category_id = $1 where id = $2`, [catOfS, geral2])), 'canal não vai para categoria de outro servidor');
  await asUser(C, `delete from public.channel_categories where id = $1`, [catNew]);
  const afterDel = one(await asUser(F, `select category_id from public.channels where id = $1`, [geral2]));
  ok(afterDel && afterDel.category_id === null, 'apagar a categoria mantém os canais (ficam sem categoria)');

  await asUser(F, `update public.server_members set nickname = 'Fera' where server_id = $1 and user_id = $2`, [S2, F]);
  ok(one(await asUser(C, `select nickname from public.server_members where server_id = $1 and user_id = $2`, [S2, F])).nickname === 'Fera', 'cada um muda o próprio apelido no servidor');
  await asUser(F, `update public.server_members set nickname = 'Hack' where server_id = $1 and user_id = $2`, [S2, C]);
  ok(one(await asUser(C, `select nickname from public.server_members where server_id = $1 and user_id = $2`, [S2, C])).nickname === null, 'ninguém muda o apelido de outra pessoa');

  await asUser(C, `select public.ban_member($1, $2, 'spam')`, [S2, F]);
  ok((await asUser(C, `select user_id from public.server_bans where server_id = $1`, [S2])).rows.length === 1, 'lista de banidos para quem pode banir');
  ok((await asUser(B, `select 1 from public.server_bans where server_id = $1`, [S2])).rows.length === 0, 'membro comum não vê os banidos');
  jr = one(await asUser(F, `select public.join_server($1, '482913') as r`, [code2])).r;
  ok(jr.ok === false && /banido/.test(jr.reason), 'banido não volta pelo link', jr);
  await asUser(C, `delete from public.server_bans where server_id = $1 and user_id = $2`, [S2, F]);
  ok(one(await asUser(F, `select public.join_server($1, '482913') as r`, [code2])).r.ok === true, 'desbanido volta com link + PIN');

  ok(one(await service(`select public._calls_allowed($1) as x`, [S2])).x === true, 'calls liberadas em qualquer servidor (padrão, como no Discord)');
  await asUser(B, `update public.app_settings set calls_everyone = false`);
  ok(one(await service(`select calls_everyone from public.app_settings`)).calls_everyone === true, 'só o administrador muda a chave das calls');
  await asUser(A, `update public.app_settings set calls_everyone = false`);
  ok(one(await service(`select public._calls_allowed($1) as x`, [S2])).x === false &&
     one(await service(`select public._calls_allowed($1) as x`, [S])).x === true, 'administrador pode limitar as calls aos servidores dele');
  await asUser(A, `update public.app_settings set calls_everyone = true`);

  console.log('\n• Claude só para o administrador');
  await asUser(B, `update public.app_settings set claude_admin_only = true`);
  ok(one(await service(`select claude_admin_only from public.app_settings`)).claude_admin_only === false, 'só o administrador muda essa chave');
  await asUser(A, `update public.app_settings set claude_admin_only = true`);
  ok(one(await service(`select public._can_use_claude($1) as x`, [B])).x === false, 'com a chave ligada, ninguém além do administrador usa o Claude (nem com cargo)');
  ok(one(await service(`select public._can_use_claude_in_server($1, $2) as x`, [S, B])).x === false, '@Claude não responde a outras pessoas');
  ok(one(await service(`select allowed from public._claude_quota($1)`, [B])).allowed === false, 'chat e tarefas do Claude bloqueados para os outros');
  ok(/./.test(one(await service(`select public._voice_invite_check($1, $2) as r`, [voice, B])).r || ''), 'outras pessoas não chamam o Claude para a call');
  ok(one(await service(`select public._can_use_claude($1) as x`, [A])).x === true &&
     one(await service(`select public._can_use_claude_in_server($1, $2) as x`, [S, A])).x === true, 'o administrador continua usando tudo');
  ok(one(await service(`select public._can_use_claude_in_server($1, $2) as x`, [S2, A])).x === false, 'nem o administrador usa o Claude em servidor dos outros sem cargo');

  await asUser(C, `select public.transfer_server_ownership($1, $2)`, [S2, B]);
  ok(one(await service(`select owner_id from public.servers where id = $1`, [S2])).owner_id === B, 'dono transfere o servidor para outro membro');

  // ------------------------------------------------------------------
  console.log('\n• Moderação e posse');
  await asUser(A, `select public.ban_member($1, $2, 'teste')`, [S, D]);
  ok((await asUser(D, `select 1 from public.servers where id = $1`, [S])).rows.length === 0, 'banido perde o acesso');
  ok(!!(await denied(D, `select public.join_server_by_invite($1)`, [code])), 'banido não volta pelo convite');
  ok(!!(await denied(A, `select public.leave_server($1)`, [S])), 'dono não sai do próprio servidor sem transferir');
  ok(!!(await denied(B, `select public.transfer_server_ownership($1, $2)`, [S, B])), 'só o dono transfere o servidor');
  await asUser(A, `delete from public.servers where id = $1`, [S]);
  ok(one(await db.query(`select count(*)::int as n from public.messages where server_id = $1`, [S])).n === 0, 'excluir o servidor remove tudo dele');

  console.log(`\nResultado: ${passed} passaram, ${failed} falharam.`);
  if (failed) {
    console.log('Falhas:\n - ' + failures.join('\n - '));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('\nErro inesperado:', err.message);
  process.exit(1);
});
