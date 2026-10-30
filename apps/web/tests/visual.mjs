// Teste VISUAL do app com um servidor Supabase SIMULADO (dados de exemplo só
// para conferir o layout). Não é usado pelo app real.
// Uso: npx vite build --mode visual && node tests/visual.mjs [pasta-de-saida]
// (o modo "visual" não lê o .env.production, então o app usa o servidor simulado)
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, '..', 'dist');
const out = resolve(process.argv[2] || join(here, '..', '..', '..', 'tmp-screens'));
const SB = 'https://demo-nexus.supabase.co';

// ---------------------------------------------------------------- dados
const now = Date.now();
const iso = (minAgo) => new Date(now - minAgo * 60000).toISOString();
const ME = '11111111-1111-4111-8111-111111111111';
const MAT = '22222222-2222-4222-8222-222222222222';
const MAR = '33333333-3333-4333-8333-333333333333';
const JUR = '44444444-4444-4444-8444-444444444444';
const S1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ch = (n, id) => `cccccccc-cccc-4ccc-8ccc-${String(id).padStart(12, '0')}`;
const R = (id) => `dddddddd-dddd-4ddd-8ddd-${String(id).padStart(12, '0')}`;

const profiles = [
  { id: ME, username: 'joseadriano', display_name: 'JoseAdriano', avatar_url: null, bio: null, accent_color: null, created_at: iso(90000) },
  { id: MAT, username: 'matheus', display_name: 'Matheus', avatar_url: null, bio: null, accent_color: null, created_at: iso(80000) },
  { id: MAR, username: 'marina', display_name: 'Marina', avatar_url: null, bio: null, accent_color: null, created_at: iso(70000) },
  { id: JUR, username: 'jurassic', display_name: 'Jurassic', avatar_url: null, bio: null, accent_color: null, created_at: iso(60000) },
];
const server = { id: S1, name: 'ALPHA - Templo da Magia', description: null, icon_url: null, banner_url: null, owner_id: ME, is_public: false, system_channel_id: null, welcome_messages: true, created_at: iso(90000) };
const K = (id) => `ffffffff-ffff-4fff-8fff-${String(id).padStart(12, '0')}`;
const categories = [
  { id: K(1), server_id: S1, name: 'Informações', position: 0, created_at: iso(90000) },
  { id: K(2), server_id: S1, name: 'Canais de texto', position: 1, created_at: iso(90000) },
  { id: K(3), server_id: S1, name: 'Canais de voz', position: 2, created_at: iso(90000) },
];
const textNames = ['geral', 'anúncios', 'desenvolvimento', 'ideias', 'bugs', 'equipe'];
const voiceNames = [['Geral', 8], ['Call da Equipe', 12], ['Trabalho', 6], ['Reuniões', 4]];
const channels = [
  ...textNames.map((n, i) => ({ id: ch(n, i + 1), server_id: S1, category_id: n === 'anúncios' ? K(1) : K(2), name: n, kind: 'text', topic: n === 'geral' ? 'Chat da equipe, mensagens, arquivos e comunicação.' : null, position: i, is_private: false, user_limit: null, claude_enabled: true, created_at: iso(90000) })),
  ...voiceNames.map(([n, lim], i) => ({ id: ch(n, 20 + i), server_id: S1, category_id: K(3), name: n, kind: 'voice', topic: null, position: 10 + i, is_private: false, user_limit: lim, claude_enabled: true, created_at: iso(90000) })),
];
const GERAL = channels[0].id;
const roles = [
  { id: R(1), server_id: S1, name: '@todos', color: null, position: 0, permissions: ['send_messages', 'attach_files', 'connect_voice', 'speak', 'video', 'share_screen', 'create_invites', 'view_projects', 'view_files', 'view_roblox'], is_default: true, hoist: false },
  { id: R(2), server_id: S1, name: 'Desenvolvedor', color: '#22C55E', position: 50, permissions: ['manage_projects', 'use_claude'], is_default: false, hoist: true },
  { id: R(3), server_id: S1, name: 'Scripter', color: '#38BDF8', position: 40, permissions: ['manage_projects'], is_default: false, hoist: true },
];
const members = [ME, MAT, MAR, JUR].map((u, i) => ({ server_id: S1, user_id: u, nickname: null, joined_at: iso(90000 - i * 100), profiles: profiles[i] }));
const memberRoles = [
  { server_id: S1, user_id: MAT, role_id: R(2) },
  { server_id: S1, user_id: MAR, role_id: R(2) },
  { server_id: S1, user_id: JUR, role_id: R(3) },
];
const msg = (id, author, content, minAgo, extra = {}) => ({
  id: `eeeeeeee-eeee-4eee-8eee-${String(id).padStart(12, '0')}`,
  channel_id: GERAL, server_id: S1, dm_thread_id: null, author_id: author, author_kind: 'user', content,
  attachments: [], mentions: [], mentions_claude: false, mentions_everyone: false, reply_to: null, meta: {}, edited_at: null, created_at: iso(minAgo), ...extra,
});
const joinMsg = { ...{ id: 'eeeeeeee-eeee-4eee-8eee-000000000099', channel_id: GERAL, server_id: S1, dm_thread_id: null, author_id: JUR, author_kind: 'system', content: 'entrou no servidor.', attachments: [], mentions: [], mentions_claude: false, mentions_everyone: false, reply_to: null, meta: { type: 'join' }, edited_at: null, created_at: iso(1490) } };
const messages = [
  msg(1, ME, 'Galera, acabei de finalizar o sistema de combate do ALPHA.\nFalta só ajustar alguns efeitos e a UI mobile.\n@matheus dá uma olhada no mapa quando puder.', 1500, { mentions: [MAT] }),
  msg(2, MAT, 'Beleza, vi aqui! O mapa tá insano, vou ajustar a iluminação e te mando o print ainda hoje.', 1497),
  msg(3, MAR, 'Já adicionei as novas roupas e efeitos. Tá tudo na pasta do projeto.', 1495, { attachments: [{ path: 'c/x/y/roupas_e_efeitos.zip', name: 'roupas_e_efeitos.zip', size: 18874368, type: 'application/zip' }] }),
  msg(4, ME, 'Boa! Agora só falta o trailer mesmo kkkk\n\nVamos deixar surreal. 👋', 1492),
  msg(5, null, '✦ Resumo do projeto ALPHA:\n\n- [x] Todos os poderes funcionando\n- [x] UI completa\n- [x] Sistema de inventário e loja\n- [x] Falta revisar o mapa inicial e katana/manopla\n\nQuer que eu organize uma task list com as próximas etapas?', 200, { author_kind: 'claude', meta: { status: 'done' } }),
];
messages.splice(3, 0, joinMsg);
const notifications = [
  { id: 'n1', user_id: ME, kind: 'mention', title: 'Matheus mencionou você em #geral', body: 'O mapa tá insano', link: { server_id: S1, channel_id: GERAL }, read_at: null, created_at: iso(30) },
];
const quota = { allowed: true, daily_limit: 300000, used_today: 1200, remaining: 298800, month_cost_usd: 0.42, month_budget_usd: 50, reason: null };
const projects = [{ id: 'p1', server_id: S1, name: 'ALPHA — Templo da Magia', description: 'RPG de magia com skills de água, vento, raio e espadas.', status: 'ativo', color: null, roblox_place_id: 1234567890, roblox_universe_id: null, created_by: ME, created_at: iso(5000), updated_at: iso(60) }];
const tasks = [
  { id: 't1', project_id: 'p1', server_id: S1, title: 'Revisar mapa inicial', description: null, kind: 'tarefa', status: 'em_andamento', priority: 'alta', assignee_id: MAT, due_date: null, labels: [], position: 0, created_by: ME, created_by_kind: 'user', created_at: iso(300), updated_at: iso(60), completed_at: null },
  { id: 't2', project_id: 'p1', server_id: S1, title: 'Katana/manopla: ajustar hitbox', description: null, kind: 'bug', status: 'a_fazer', priority: 'critica', assignee_id: JUR, due_date: null, labels: [], position: 0, created_by: ME, created_by_kind: 'user', created_at: iso(300), updated_at: iso(60), completed_at: null },
  { id: 't3', project_id: 'p1', server_id: S1, title: 'UI mobile do combate', description: null, kind: 'melhoria', status: 'a_fazer', priority: 'media', assignee_id: MAR, due_date: null, labels: [], position: 0, created_by: ME, created_by_kind: 'claude', created_at: iso(300), updated_at: iso(60), completed_at: null },
  { id: 't4', project_id: 'p1', server_id: S1, title: 'Sistema de inventário e loja', description: null, kind: 'tarefa', status: 'concluida', priority: 'media', assignee_id: ME, due_date: null, labels: [], position: 0, created_by: ME, created_by_kind: 'user', created_at: iso(3000), updated_at: iso(600), completed_at: iso(600) },
];

// ---------------------------------------------------------------- servidor estático
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const http = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  let p = join(dist, decodeURIComponent(url.pathname));
  if (url.pathname.endsWith('/')) p = join(p, 'index.html');
  try {
    const body = await readFile(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('404');
  }
});
await new Promise((r) => http.listen(4319, r));

// ---------------------------------------------------------------- mock do Supabase
function b64url(o) {
  return Buffer.from(JSON.stringify(o)).toString('base64url');
}
const jwt = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: ME, role: 'authenticated', exp: Math.floor(now / 1000) + 86400 })}.assinatura`;
const session = {
  access_token: jwt,
  refresh_token: 'r',
  expires_in: 86400,
  expires_at: Math.floor(now / 1000) + 86400,
  token_type: 'bearer',
  user: { id: ME, email: 'jose@exemplo.com', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: iso(90000) },
};

function tableData(table, params, opts = {}) {
  const eq = (k) => (params.get(k) || '').replace(/^eq\./, '');
  switch (table) {
    case 'profiles':
      return params.get('id')?.startsWith('eq.') ? profiles.filter((p) => p.id === eq('id')) : profiles;
    case 'app_settings':
      return [{ signup_open: true, claude_model: 'claude-sonnet-5-5', claude_task_model: 'claude-opus-5-5', claude_daily_tokens_per_user: 300000, claude_monthly_budget_usd: 50, companion_max_concurrent_tasks: 2, voice_agent_ready: true, calls_everyone: true, claude_admin_only: true }];
    case 'server_members':
      if (params.get('user_id')) return [{ joined_at: iso(90000), servers: { ...server, services_enabled: opts.services ?? true } }];
      return members;
    case 'channels':
      return channels;
    case 'channel_categories':
      return categories;
    case 'invites':
      return [{ code: 'aB3dE5fG7h', server_id: S1, created_by: ME, max_uses: null, uses: 3, expires_at: null, created_at: iso(100) }];
    case 'server_join_pins':
      return [{ pin: '482913' }];
    case 'roles':
      return roles;
    case 'member_roles':
      return memberRoles;
    case 'projects':
      return projects;
    case 'project_tasks':
      return tasks;
    case 'roblox_experiences':
      return [{ id: 'rx1', server_id: S1, project_id: 'p1', universe_id: 4567891230, root_place_id: 1234567890, name: 'ALPHA - Templo da Magia', added_by: ME, created_at: iso(5000) }];
    case 'roblox_stats':
      return [{ id: 1, universe_id: 4567891230, name: 'ALPHA - Templo da Magia', playing: 37, visits: 128450, favorites: 3120, max_players: 20, source: 'games.roblox.com/v1/games', fetched_at: iso(4) }];
    case 'notifications':
      return notifications;
    case 'dm_participants':
      return [];
    case 'messages':
      return [...messages].reverse();
    case 'companion_settings':
      return [{ user_id: ME, mode: 'hibrido', max_concurrent_tasks: 2, voice_enabled: false, transcript_retention_days: 0 }];
    case 'companion_tasks':
      return [{ id: 'ct1', owner_id: ME, server_id: S1, project_id: 'p1', title: 'Analisar scripts de combate do ALPHA', instructions: 'Encontre bugs e proponha correções.', status: 'executando', blocked_reason: null, progress: 45, progress_note: 'Lendo Scripts/Combate/Skills.lua', priority: 'alta', required_scopes: ['acessar_arquivos'], resource_key: null, result: null, error: null, steps: 6, max_steps: 30, attempts: 1, input_tokens: 0, output_tokens: 0, created_at: iso(20), started_at: iso(19), finished_at: null, heartbeat_at: iso(1), updated_at: iso(1) }];
    case 'companion_questions':
      return [{ id: 'q1', task_id: 'ct1', owner_id: ME, question: 'Encontrei duas soluções possíveis para o bug da hitbox da katana. Qual comportamento você prefere?', options: ['Hitbox por raycast (mais preciso)', 'Hitbox por região (mais leve no celular)'], urgency: 'media', route: 'notificacao', blocking: true, status: 'pendente', answer: null, created_at: iso(3), answered_at: null }];
    case 'companion_permissions':
      return [{ user_id: ME, scope: 'acessar_arquivos', granted: true, updated_at: iso(100) }];
    case 'activity_log':
      return [{ id: 1, server_id: S1, project_id: 'p1', actor_id: MAT, actor_kind: 'user', action: 'task.status', entity_type: 'task', entity_id: 't1', summary: '"Revisar mapa inicial": A fazer → Em andamento', details: {}, created_at: iso(60) }];
    case 'user_settings':
      return [{ data: {} }];
    case 'ai_conversations':
      return [];
    case 'friendships':
      return [
        { id: 'f1', requester: MAT, addressee: ME, status: 'aceita', created_at: iso(3000), responded_at: iso(2990) },
        { id: 'f2', requester: JUR, addressee: ME, status: 'pendente', created_at: iso(30), responded_at: null },
      ];
    case 'user_blocks':
      return [];
    default:
      return [];
  }
}

function rpcData(fn, opts) {
  switch (fn) {
    case 'unread_summary':
      return [{ target_id: channels[2].id, kind: 'channel', server_id: S1, unread: 3, mentions: 0 }];
    case 'my_claude_quota':
      return [quota];
    case 'my_permissions':
      return opts.admin ? ['admin'] : ['send_messages', 'attach_files', 'connect_voice', 'speak', 'video', 'share_screen', 'create_invites', 'view_projects', 'view_files', 'view_roblox', 'use_claude'];
    case 'is_app_admin':
      return !!opts.admin;
    case 'mark_read':
      return null;
    case 'send_friend_request':
      return { ok: true, status: 'enviado', user_id: MAR };
    case 'preview_invite':
      return [{ server_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Grupo dos Amigos', description: 'Jogos, memes e calls toda sexta.', icon_url: null, banner_url: null, member_count: 12, valid: true, reason: null, requires_pin: true, already_member: false }];
    default:
      return null;
  }
}

async function mockSupabase(page, opts = { admin: true }) {
  // Nunca falar com um servidor de verdade: o build precisa ser o de teste
  // (npx vite build --mode visual), sem o endereço do .env.production.
  await page.route(
    (u) => u.hostname.endsWith('.supabase.co') && u.origin !== SB,
    async (route) => {
      console.error(`ERRO: o app tentou acessar um servidor real (${new URL(route.request().url()).hostname}). Gere o build com: npx vite build --mode visual`);
      process.exitCode = 1;
      await route.abort();
    },
  );
  await page.route(`${SB}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const single = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
    let body = null;
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      body = rpcData(url.pathname.split('/').pop(), opts);
      if (single && Array.isArray(body)) body = body[0] ?? null;
    } else if (url.pathname.startsWith('/rest/v1/')) {
      const data = tableData(url.pathname.split('/').pop(), url.searchParams, opts);
      body = single ? data[0] ?? null : data;
    } else if (url.pathname.startsWith('/auth/v1/user')) {
      body = session.user;
    } else if (url.pathname === '/functions/v1/livekit-token' && (req.postDataJSON() ?? {}).action === 'participants') {
      // Quem está nas calls segundo a LiveKit (sem presença em tempo real no teste)
      body = { channels: { [channels[6].id]: [{ identity: MAR, name: 'Marina', agent: false }, { identity: 'agent-AJ_teste', name: 'NEXUS IA', agent: true }] } };
    } else {
      body = {};
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

// ---------------------------------------------------------------- capturas
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const shots = [
  { name: 'desktop-chat', viewport: { width: 1536, height: 1024 }, deviceScaleFactor: 1 },
  { name: 'ipad-chat', ...devices['iPad Pro 11'] },
  { name: 'iphone-chat', ...devices['iPhone 15 Pro'] },
  { name: 'android-chat', ...devices['Pixel 7'] },
];

for (const s of shots) {
  const { name, ...ctxOpts } = s;
  const ctx = await browser.newContext({ ...ctxOpts, locale: 'pt-BR', colorScheme: 'dark' });
  await ctx.addInitScript(
    ({ url, sess, server }) => {
      localStorage.setItem('nexus.serverConfig.v1', JSON.stringify({ supabaseUrl: url, supabaseAnonKey: 'sb_publishable_teste' }));
      localStorage.setItem('nexus.auth.v1', JSON.stringify(sess));
      localStorage.setItem('nexus.lastServer.v1', server);
      localStorage.setItem('nexus.installDismissed', '1');
    },
    { url: SB, sess: session, server: S1 },
  );
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await mockSupabase(page);
  await page.goto('http://localhost:4319/index.html');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(out, `${name}.png`) });
  if (name === 'desktop-chat') {
    // Outras telas no desktop
    // A IA não aparece dentro dos servidores (só no Início, para o administrador)
    const voiceList = page.getByLabel('Na call Geral').first();
    const inCallText = (await voiceList.count()) ? await voiceList.innerText() : '';
    console.log(`call: embaixo do canal de voz aparece ${/Marina/.test(inCallText) ? 'Marina' : 'NINGUÉM (erro)'}${/NEXUS IA/.test(inCallText) ? ' + NEXUS IA (só o administrador vê)' : ''}`);
    const iaInServer = await page.locator('nav, aside, div').getByRole('button', { name: /^NEXUS IA$|^NEXUS Companion$/ }).count();
    console.log(`servidor: NEXUS IA na barra do servidor ${iaInServer ? 'VISÍVEL (erro)' : 'escondida'}`);
    for (const [label, click] of [
      ['desktop-projetos', 'Projetos'],
      ['desktop-roblox', 'Faturamento Roblox'],
    ]) {
      await page.getByRole('button', { name: click }).first().click();
      await page.waitForTimeout(1200);
      await page.screenshot({ path: join(out, `${label}.png`) });
    }
    await page.getByRole('button', { name: 'Início e mensagens privadas' }).click();
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: 'NEXUS Companion' }).first().click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: join(out, 'desktop-companion.png') });
    await page.getByRole('tab', { name: /Modo e voz/ }).or(page.getByRole('button', { name: /Modo e voz/ })).first().click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(out, 'desktop-companion-modo.png'), fullPage: true });
    await page.getByRole('button', { name: 'ALPHA - Templo da Magia' }).first().click();
    await page.waitForTimeout(1200);
    // Estilo Discord: menu do servidor, convite com PIN, configurações, criar servidor, entrar com link + PIN
    await page.getByRole('button', { name: /Canais de texto/ }).first().waitFor({ timeout: 3000 }).catch(() => {});
    await page.locator('[aria-haspopup="menu"]').first().click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(out, 'desktop-menu-servidor.png') });
    await page.getByRole('menuitem', { name: 'Convidar pessoas' }).click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(out, 'desktop-convite.png') });
    const pinShown = await page.getByText('482913').count();
    await page.keyboard.press('Escape');
    await page.locator('[aria-haspopup="menu"]').first().click();
    await page.getByRole('menuitem', { name: 'Configurações do servidor' }).click();
    await page.waitForTimeout(600);
    await page.getByRole('tab', { name: 'Convites' }).or(page.getByRole('button', { name: 'Convites', exact: true })).first().click();
    await page.waitForTimeout(900);
    await page.screenshot({ path: join(out, 'desktop-config-convites.png'), fullPage: true });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Adicionar um servidor' }).click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(out, 'desktop-criar-servidor.png') });
    await page.getByRole('button', { name: /^Jogos/ }).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(out, 'desktop-criar-servidor-nome.png') });
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      location.hash = 'convite=aB3dE5fG7h';
    });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(out, 'desktop-entrar-pin.png') });
    const pinField = await page.getByLabel('PIN do servidor').count();
    await page.keyboard.press('Escape');
    console.log(`discord: PIN no convite ${pinShown ? 'visível' : 'NÃO visível'} · campo de PIN ao entrar ${pinField ? 'visível' : 'NÃO visível'}`);
    await page.getByRole('button', { name: 'Início e mensagens privadas' }).click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: join(out, 'desktop-inicio.png') });
    // Amigos: lista, pedidos pendentes, adicionar pelo nick e perfil com "Aceitar"
    await page.getByRole('button', { name: /^Amigos/ }).first().click();
    await page.waitForTimeout(900);
    await page.screenshot({ path: join(out, 'desktop-amigos.png') });
    await page.getByRole('tab', { name: /Pendentes/ }).or(page.getByRole('button', { name: /^Pendentes/ })).first().click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(out, 'desktop-amigos-pendentes.png') });
    await page.getByRole('button', { name: /Jurassic/ }).first().click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(out, 'desktop-perfil-pedido.png') });
    const acceptBtn = await page.getByRole('button', { name: 'Aceitar' }).count();
    await page.keyboard.press('Escape');
    await page.getByRole('tab', { name: 'Adicionar amigo' }).or(page.getByRole('button', { name: 'Adicionar amigo' })).first().click();
    await page.waitForTimeout(400);
    await page.getByLabel('Nome de usuário').fill('marina');
    await page.getByRole('button', { name: 'Enviar pedido de amizade' }).click();
    await page.waitForTimeout(900);
    await page.screenshot({ path: join(out, 'desktop-amigos-adicionar.png') });
    const sent = await page.getByText(/Pedido enviado para @marina/).count();
    console.log(`amigos: pedido pelo nick ${sent ? 'enviado' : 'NÃO enviado'} · botão Aceitar no perfil ${acceptBtn ? 'visível' : 'NÃO visível'}`);
  }
  if (name === 'iphone-chat') {
    await page.getByRole('button', { name: 'Abrir menu' }).first().click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(out, 'iphone-menu.png') });
    // Celular: sem "Início" na barra de baixo; o controle mostra as conversas privadas na própria gaveta
    const inicioTab = await page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('button', { name: 'Início' }).count();
    await page.getByRole('button', { name: 'Início e mensagens privadas' }).first().click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(out, 'iphone-controle-privado.png') });
    const dmList = await page.getByRole('dialog', { name: 'Menu' }).getByText('Mensagens privadas').isVisible();
    const overview = await page.getByRole('button', { name: 'Visão geral' }).count();
    console.log(`celular: aba Início ${inicioTab ? 'VISÍVEL (erro)' : 'removida'} · controle mostra conversas privadas ${dmList ? 'sim' : 'NÃO'} · Visão geral ${overview ? 'VISÍVEL (erro)' : 'escondida'}`);
    await page.getByRole('button', { name: /^Amigos/ }).first().click();
    await page.waitForTimeout(900);
    await page.screenshot({ path: join(out, 'iphone-amigos.png') });
  }
  console.log(`${name}: ${errors.length ? 'ERROS: ' + errors.join(' | ') : 'ok'}`);
  await ctx.close();
}

// Pessoa comum (não é a administradora): o Claude não aparece em lugar nenhum.
{
  const ctx = await browser.newContext({ viewport: { width: 1536, height: 1024 }, deviceScaleFactor: 1, locale: 'pt-BR', colorScheme: 'dark' });
  await ctx.addInitScript(
    ({ url, sess, server }) => {
      localStorage.setItem('nexus.serverConfig.v1', JSON.stringify({ supabaseUrl: url, supabaseAnonKey: 'sb_publishable_teste' }));
      localStorage.setItem('nexus.auth.v1', JSON.stringify(sess));
      localStorage.setItem('nexus.lastServer.v1', server);
      localStorage.setItem('nexus.installDismissed', '1');
    },
    { url: SB, sess: session, server: S1 },
  );
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await mockSupabase(page, { admin: false, services: false });
  await page.goto('http://localhost:4319/index.html');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(out, 'desktop-membro.png') });
  // (uma resposta antiga da IA no canal continua visível; o que some são os acessos à IA)
  const memberVoice = page.getByLabel('Na call Geral').first();
  const memberVoiceText = (await memberVoice.count()) ? await memberVoice.innerText() : '';
  console.log(`call (pessoa comum): ${/Marina/.test(memberVoiceText) ? 'vê a Marina na call' : 'NÃO vê quem está na call (erro)'} · IA na lista ${/NEXUS IA/.test(memberVoiceText) ? 'VISÍVEL (erro)' : 'escondida'}`);
  const claudeItems = await page.getByRole('button', { name: /^NEXUS IA$|^NEXUS Companion$|Perguntar à NEXUS IA|Chamar a NEXUS IA/ }).count();
  const services = await page.getByText(/Faturamento Roblox|^Serviços$/).count();
  console.log(`desktop-membro: ${errors.length ? 'ERROS: ' + errors.join(' | ') : 'ok'} · IA ${claudeItems ? 'VISÍVEL (erro)' : 'escondida'} · Serviços ${services ? 'VISÍVEIS (erro)' : 'escondidos (servidor que não é de jogos)'}`);
  await ctx.close();
}

// App do Windows aberto por um link nexus://convite/CODIGO: o convite aparece sozinho.
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1, locale: 'pt-BR', colorScheme: 'dark' });
  await ctx.addInitScript(
    ({ url, sess, server }) => {
      localStorage.setItem('nexus.serverConfig.v1', JSON.stringify({ supabaseUrl: url, supabaseAnonKey: 'sb_publishable_teste' }));
      localStorage.setItem('nexus.auth.v1', JSON.stringify(sess));
      localStorage.setItem('nexus.lastServer.v1', server);
      localStorage.setItem('nexus.installDismissed', '1');
      let pending = 'nexus://convite/aB3dE5fG7h';
      window.nexusDesktop = {
        isDesktop: true,
        platform: 'win32',
        version: '9.9.9',
        window: { minimize() {}, toggleMaximize() {}, close() {}, isMaximized: async () => false, onMaximizedChange: () => () => {} },
        updates: { check: async () => {}, install() {}, onStatus: (cb) => (cb({ state: 'downloaded', version: '9.9.9' }), () => {}) },
        screenShare: { onPickRequest: () => () => {}, respondPick() {} },
        notify() {},
        setBadgeCount() {},
        openExternal() {},
        getLaunchAtStartup: async () => false,
        setLaunchAtStartup: async () => false,
        onDeepLink: () => () => {},
        takeDeepLink: async () => {
          const u = pending;
          pending = null;
          return u;
        },
      };
    },
    { url: SB, sess: session, server: S1 },
  );
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await mockSupabase(page);
  await page.goto('http://localhost:4319/index.html');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(out, 'windows-link-convite.png') });
  const modal = await page.getByText('Entrar em um servidor').count();
  const banner = await page.getByText('Reiniciar e atualizar').count();
  console.log(`windows-link-convite: ${errors.length ? 'ERROS: ' + errors.join(' | ') : 'ok'} · convite pelo link nexus:// ${modal ? 'abriu' : 'NÃO abriu'} · aviso de atualização ${banner ? 'visível' : 'NÃO visível'}`);
  await ctx.close();
}

// Convite aberto antes do login: mostra o servidor e já abre em "Criar conta".
{
  const ctx = await browser.newContext({ ...devices['iPhone 15 Pro'], locale: 'pt-BR', colorScheme: 'dark' });
  await ctx.addInitScript(({ url }) => {
    localStorage.setItem('nexus.serverConfig.v1', JSON.stringify({ supabaseUrl: url, supabaseAnonKey: 'sb_publishable_teste' }));
  }, { url: SB });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await mockSupabase(page);
  await page.goto('http://localhost:4319/index.html#convite=aB3dE5fG7h');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: join(out, 'iphone-convite-login.png') });
  const banner = await page.getByText('Você foi convidado para entrar em').count();
  console.log(`iphone-convite-login: ${errors.length ? 'ERROS: ' + errors.join(' | ') : 'ok'} · convite ${banner ? 'visível' : 'NÃO visível'}`);
  await ctx.close();
}

// Tela de login (sem sessão) nos celulares e tablets: deve mostrar como instalar.
// "ipad-safari-mac" imita o iPadOS 13+, que se identifica como Mac.
const macSafariUA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
for (const s of [
  { name: 'ipad-login', ...devices['iPad Pro 11'] },
  { name: 'ipad-safari-mac-login', viewport: { width: 834, height: 1194 }, deviceScaleFactor: 2, hasTouch: true, isMobile: false, userAgent: macSafariUA },
  { name: 'iphone-login', ...devices['iPhone 15 Pro'] },
  { name: 'android-login', ...devices['Pixel 7'] },
]) {
  const { name, ...ctxOpts } = s;
  const ctx = await browser.newContext({ ...ctxOpts, locale: 'pt-BR', colorScheme: 'dark' });
  await ctx.addInitScript(({ url }) => {
    localStorage.setItem('nexus.serverConfig.v1', JSON.stringify({ supabaseUrl: url, supabaseAnonKey: 'sb_publishable_teste' }));
  }, { url: SB });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await mockSupabase(page);
  await page.goto('http://localhost:4319/index.html');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: join(out, `${name}.png`) });
  const hint = await page.getByText(/Tela de Início|Instalar/i).count();
  console.log(`${name}: ${errors.length ? 'ERROS: ' + errors.join(' | ') : 'ok'} · dica de instalação ${hint ? 'visível' : 'NÃO encontrada'}`);
  await ctx.close();
}
await browser.close();
http.close();
console.log('Capturas em', out);
