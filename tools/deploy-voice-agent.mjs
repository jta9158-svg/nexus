#!/usr/bin/env node
// Publica (ou atualiza) o agente de voz do NEXUS na LiveKit Cloud — o mesmo
// processo do `lk agent create/deploy`, feito pela API oficial.
//
// Variáveis de ambiente:
//   LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET   projeto da LiveKit Cloud
//   SUPABASE_URL, NEXUS_INTERNAL_SECRET                 viram segredos do agente
//
// Uso: node tools/deploy-voice-agent.mjs            (cria na 1ª vez, depois atualiza)
//      node tools/deploy-voice-agent.mjs --status   (só mostra a situação)
import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const AGENT_DIR = resolve(here, '..', 'apps', 'voice-agent');
const CONFIG = join(AGENT_DIR, 'livekit.toml');
const AGENTS_URL = process.env.LK_AGENTS_URL || 'https://agents.livekit.cloud';
const FILES = ['agent.py', 'policy.py', 'requirements.txt', 'Dockerfile', '.dockerignore'];

const need = (k) => {
  const v = process.env[k];
  if (!v) throw new Error(`Falta a variável ${k}`);
  return v;
};

const b64url = (b) => Buffer.from(b).toString('base64url');

function token() {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ iss: need('LIVEKIT_API_KEY'), sub: 'nexus-deploy', nbf: now - 10, exp: now + 600, agent: { admin: true } }));
  const sig = createHmac('sha256', need('LIVEKIT_API_SECRET')).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

const headers = () => ({ Authorization: `Bearer ${token()}`, 'X-LIVEKIT-CLI-VERSION': '2.19.0' });

async function twirp(method, body) {
  const res = await fetch(`${AGENTS_URL}/twirp/livekit.CloudAgent/${method}`, {
    method: 'POST',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} → ${res.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}

const pick = (o, ...keys) => keys.map((k) => o?.[k]).find((v) => v !== undefined && v !== null && v !== '');

function secrets() {
  return [
    { name: 'SUPABASE_URL', value: Buffer.from(need('SUPABASE_URL')).toString('base64') },
    { name: 'NEXUS_INTERNAL_SECRET', value: Buffer.from(need('NEXUS_INTERNAL_SECRET')).toString('base64') },
  ];
}

function tarball() {
  const dir = mkdtempSync(join(tmpdir(), 'nexus-agent-'));
  const file = join(dir, 'source.tar.gz');
  execFileSync('tar', ['-czf', file, '-C', AGENT_DIR, ...FILES]);
  const data = readFileSync(file);
  rmSync(dir, { recursive: true, force: true });
  return data;
}

async function upload(presignedUrl, post, data) {
  if (post && pick(post, 'url')) {
    const form = new FormData();
    const values = pick(post, 'values') ?? {};
    for (const [k, v] of Object.entries(values)) form.append(k, v);
    form.append('file', new Blob([data], { type: 'application/gzip' }), values.key ?? 'upload.tar.gz');
    const res = await fetch(post.url, { method: 'POST', body: form });
    if (!res.ok && res.status !== 204) throw new Error(`upload → ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return;
  }
  const res = await fetch(presignedUrl, { method: 'PUT', headers: { 'Content-Type': 'application/gzip' }, body: data });
  if (!res.ok) throw new Error(`upload → ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

async function build(agentId) {
  const res = await fetch(`${AGENTS_URL}/build?agent_id=${encodeURIComponent(agentId)}`, {
    method: 'POST',
    headers: { ...headers(), 'X-LIVEKIT-BUILD-PROTOCOL': 'v2' },
  });
  if (!res.ok) throw new Error(`build → ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const decoder = new TextDecoder();
  let buffer = '';
  let lastStep = '';
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i).trim();
      buffer = buffer.slice(i + 1);
      if (!line) continue;
      if (line.startsWith('BUILD ERROR:')) throw new Error(line);
      try {
        const ev = JSON.parse(line);
        if (ev.lkQueue?.message) console.log('  fila:', ev.lkQueue.message);
        for (const v of ev.vertexes ?? ev.Vertexes ?? []) {
          const name = v.name ?? v.Name;
          if (name && name !== lastStep && (v.completed ?? v.Completed)) {
            lastStep = name;
            console.log('  ✓', name.slice(0, 110));
          }
          if (v.error ?? v.Error) console.log('  ✗', name, v.error ?? v.Error);
        }
      } catch {
        // linha que não é JSON: ignora
      }
    }
  }
}

function savedId() {
  if (!existsSync(CONFIG)) return null;
  const m = /id\s*=\s*"([^"]+)"/.exec(readFileSync(CONFIG, 'utf8'));
  return m ? m[1] : null;
}

function saveId(agentId) {
  const subdomain = new URL(need('LIVEKIT_URL').replace(/^ws/, 'http')).hostname.split('.')[0];
  writeFileSync(CONFIG, `[project]\n  subdomain = "${subdomain}"\n\n[agent]\n  id = "${agentId}"\n`);
}

async function status(agentId) {
  const r = await twirp('ListAgents', agentId ? { agent_id: agentId } : {});
  for (const a of r.agents ?? []) {
    console.log(`agente ${pick(a, 'agent_id', 'agentId')} versão ${pick(a, 'version')}`);
    for (const d of pick(a, 'agent_deployments', 'agentDeployments') ?? []) {
      console.log(`  ${pick(d, 'server_region', 'serverRegion', 'region')}: ${pick(d, 'status')} (réplicas ${pick(d, 'replicas') ?? 0})`);
    }
  }
  return r;
}

async function main() {
  const id = savedId();
  if (process.argv.includes('--status')) {
    await status(id);
    return;
  }
  const data = tarball();
  console.log(`Código do agente: ${(data.length / 1024).toFixed(1)} KB`);
  if (!id) {
    const r = await twirp('CreateAgent', { secrets: secrets(), regions: [] });
    const agentId = pick(r, 'agent_id', 'agentId');
    saveId(agentId);
    console.log('Agente criado:', agentId, 'regiões:', (pick(r, 'server_regions', 'serverRegions') ?? []).join(', '));
    await upload(pick(r, 'presigned_url', 'presignedUrl'), pick(r, 'presigned_post_request', 'presignedPostRequest'), data);
    await build(agentId);
  } else {
    const r = await twirp('DeployAgent', { agent_id: id, secrets: secrets() });
    if (r.success === false) throw new Error(r.message || 'falha ao atualizar');
    await upload(pick(r, 'presigned_url', 'presignedUrl'), pick(r, 'presigned_post_request', 'presignedPostRequest'), data);
    await build(id);
  }
  console.log('Build enviado. Situação:');
  await status(savedId());
}

main().catch((e) => {
  console.error('ERRO:', e.message);
  process.exit(1);
});
