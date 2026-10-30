import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Download, Info, Pencil, Plus, Wallet } from 'lucide-react';
import { useApp, displayNameFor } from '../../store/app';
import { useSession } from '../../store/session';
import { toast } from '../../store/toast';
import { sb } from '../../lib/supabase';
import { currencyLabel, formatDate, formatMoney, monthRange, todayISO } from '../../lib/format';
import { hasPerm } from '../../lib/permissions';
import type { Currency, FinanceEntry, FinanceSummaryRow } from '../../types/db';
import { Badge, Button, Card, cx, EmptyState, Field, Input, Modal, Notice, Select, Spinner, Textarea } from '../ui';
import { ViewHeader } from '../layout/ViewHeader';

const CATEGORIES: Record<'receita' | 'despesa', Array<{ key: string; label: string }>> = {
  receita: [
    { key: 'roblox_robux', label: 'Robux (jogo)' },
    { key: 'roblox_devex', label: 'DevEx (conversão)' },
    { key: 'patrocinio', label: 'Patrocínio' },
    { key: 'venda', label: 'Venda' },
    { key: 'outros_receita', label: 'Outras receitas' },
  ],
  despesa: [
    { key: 'pagamento_equipe', label: 'Pagamento da equipe' },
    { key: 'ferramentas', label: 'Ferramentas e assinaturas' },
    { key: 'anuncios', label: 'Anúncios' },
    { key: 'investimento', label: 'Investimento' },
    { key: 'assets', label: 'Assets / modelos' },
    { key: 'infraestrutura', label: 'Infraestrutura (servidores, API)' },
    { key: 'impostos', label: 'Impostos' },
    { key: 'taxas', label: 'Taxas' },
    { key: 'outros', label: 'Outras despesas' },
  ],
};

const STATUS_LABEL: Record<FinanceEntry['status'], string> = {
  estimado: 'Estimado',
  pendente: 'Pendente',
  recebido: 'Recebido',
  pago: 'Pago',
  cancelado: 'Cancelado',
};

const catLabel = (k: string) => [...CATEGORIES.receita, ...CATEGORIES.despesa].find((c) => c.key === k)?.label ?? k;

function EntryModal({ serverId, entry, open, onClose }: { serverId: string; entry: FinanceEntry | null; open: boolean; onClose: () => void }) {
  const me = useSession((s) => s.userId);
  const projects = useApp((s) => s.projects[serverId]) ?? [];
  const members = useApp((s) => s.members[serverId]) ?? [];
  const [kind, setKind] = useState<'receita' | 'despesa'>('receita');
  const [category, setCategory] = useState('roblox_robux');
  const [amount, setAmount] = useState('');
  const [gross, setGross] = useState('');
  const [fee, setFee] = useState('');
  const [currency, setCurrency] = useState<Currency>('BRL');
  const [status, setStatus] = useState<FinanceEntry['status']>('recebido');
  const [date, setDate] = useState(todayISO());
  const [project, setProject] = useState('');
  const [payee, setPayee] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setKind(entry?.kind ?? 'receita');
    setCategory(entry?.category ?? 'roblox_robux');
    setAmount(entry ? String(entry.amount) : '');
    setGross(entry?.gross_amount != null ? String(entry.gross_amount) : '');
    setFee(entry?.fee_amount != null ? String(entry.fee_amount) : '');
    setCurrency(entry?.currency ?? 'BRL');
    setStatus(entry?.status ?? 'recebido');
    setDate(entry?.occurred_on ?? todayISO());
    setProject(entry?.project_id ?? '');
    setPayee(entry?.payee_id ?? '');
    setDescription(entry?.description ?? '');
  }, [open, entry]);

  const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(/\./g, '').replace(',', '.')));

  const save = async () => {
    const a = num(amount);
    if (a === null || Number.isNaN(a) || a < 0) return toast.warn('Informe um valor válido');
    setBusy(true);
    const payload = {
      kind,
      category,
      amount: a,
      gross_amount: num(gross),
      fee_amount: num(fee),
      currency,
      status,
      occurred_on: date,
      project_id: project || null,
      payee_id: payee || null,
      description: description.trim() || null,
    };
    const res = entry
      ? await sb().from('finance_entries').update(payload).eq('id', entry.id)
      : await sb().from('finance_entries').insert({ ...payload, server_id: serverId, created_by: me });
    setBusy(false);
    if (res.error) return toast.error(res.error);
    onClose();
  };

  const remove = async () => {
    if (!entry || !confirm('Excluir este lançamento?')) return;
    const { error } = await sb().from('finance_entries').delete().eq('id', entry.id);
    if (error) return toast.error(error);
    onClose();
  };

  const statuses: FinanceEntry['status'][] = kind === 'receita' ? ['recebido', 'pendente', 'estimado', 'cancelado'] : ['pago', 'pendente', 'estimado', 'cancelado'];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={entry ? 'Editar lançamento' : 'Novo lançamento'}
      size="lg"
      footer={
        <>
          {entry ? (
            <Button variant="ghost" className="mr-auto !text-danger" onClick={() => void remove()}>
              Excluir
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => void save()} loading={busy}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-[#0d1118] border border-line">
          {(['receita', 'despesa'] as const).map((k) => (
            <button
              key={k}
              onClick={() => {
                setKind(k);
                setCategory(CATEGORIES[k][0].key);
                setStatus(k === 'receita' ? 'recebido' : 'pago');
              }}
              className={cx('h-9 rounded-lg text-sm font-medium', kind === k ? (k === 'receita' ? 'bg-success/20 text-success' : 'bg-danger/20 text-danger') : 'text-fg-2')}
            >
              {k === 'receita' ? 'Receita' : 'Despesa'}
            </button>
          ))}
        </div>
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Valor líquido">
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0,00" />
          </Field>
          <Field label="Moeda">
            <Select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
              {(['BRL', 'USD', 'ROBUX'] as Currency[]).map((c) => (
                <option key={c} value={c}>
                  {currencyLabel(c)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Situação">
            <Select value={status} onChange={(e) => setStatus(e.target.value as FinanceEntry['status'])}>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {kind === 'receita' ? (
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Valor bruto (opcional)" hint="Antes das taxas.">
              <Input value={gross} onChange={(e) => setGross(e.target.value)} inputMode="decimal" />
            </Field>
            <Field label="Taxas (opcional)" hint="Ex.: comissão do Roblox, taxa de câmbio.">
              <Input value={fee} onChange={(e) => setFee(e.target.value)} inputMode="decimal" />
            </Field>
          </div>
        ) : null}
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Categoria">
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES[kind].map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Data">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Projeto">
            <Select value={project} onChange={(e) => setProject(e.target.value)}>
              <option value="">Geral</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {kind === 'despesa' && category === 'pagamento_equipe' ? (
          <Field label="Quem recebeu">
            <Select value={payee} onChange={(e) => setPayee(e.target.value)}>
              <option value="">—</option>
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {displayNameFor(m.user_id, serverId)}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field label="Descrição">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
        </Field>
      </div>
    </Modal>
  );
}

function MonthlyChart({ entries, currency }: { entries: FinanceEntry[]; currency: Currency }) {
  const months = useMemo(() => {
    const out: Array<{ key: string; label: string; income: number; expense: number }> = [];
    for (let i = 5; i >= 0; i--) {
      const r = monthRange(-i);
      const key = r.from.slice(0, 7);
      out.push({ key, label: new Intl.DateTimeFormat('pt-BR', { month: 'short' }).format(new Date(r.from + 'T12:00:00')).replace('.', ''), income: 0, expense: 0 });
    }
    for (const e of entries) {
      if (e.currency !== currency) continue;
      const m = out.find((x) => x.key === e.occurred_on.slice(0, 7));
      if (!m) continue;
      if (e.kind === 'receita' && e.status === 'recebido') m.income += Number(e.amount);
      if (e.kind === 'despesa' && e.status === 'pago') m.expense += Number(e.amount);
    }
    return out;
  }, [entries, currency]);
  const max = Math.max(1, ...months.flatMap((m) => [m.income, m.expense]));
  return (
    <div>
      <div className="flex items-end gap-3 h-40 pt-2">
        {months.map((m) => (
          <div key={m.key} className="flex-1 flex flex-col items-center gap-1.5 h-full">
            <div className="flex-1 w-full flex items-end justify-center gap-1">
              <div className="w-1/3 max-w-5 rounded-t bg-success/80" style={{ height: `${(m.income / max) * 100}%` }} title={`Recebido: ${formatMoney(m.income, currency)}`} />
              <div className="w-1/3 max-w-5 rounded-t bg-danger/70" style={{ height: `${(m.expense / max) * 100}%` }} title={`Pago: ${formatMoney(m.expense, currency)}`} />
            </div>
            <span className="text-[11px] text-fg-3 capitalize">{m.label}</span>
          </div>
        ))}
      </div>
      <div className="flex gap-4 text-[12px] text-fg-3 mt-2">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-success/80" /> Receita recebida
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-danger/70" /> Despesa paga
        </span>
      </div>
    </div>
  );
}

export function FinanceView({ serverId }: { serverId: string }) {
  const perms = useApp((s) => s.myPerms[serverId]);
  const projects = useApp((s) => s.projects[serverId]) ?? [];
  const canManage = hasPerm(perms, 'manage_finance');
  const [period, setPeriod] = useState<'mes' | 'mes_passado' | 'tri' | 'ano'>('mes');
  const [project, setProject] = useState('');
  const [summary, setSummary] = useState<FinanceSummaryRow[] | null>(null);
  const [entries, setEntries] = useState<FinanceEntry[]>([]);
  const [modal, setModal] = useState<{ open: boolean; entry: FinanceEntry | null }>({ open: false, entry: null });
  const [chartCurrency, setChartCurrency] = useState<Currency>('BRL');

  const range = useMemo(() => {
    if (period === 'mes') return monthRange(0);
    if (period === 'mes_passado') return monthRange(-1);
    if (period === 'tri') return { from: monthRange(-2).from, to: monthRange(0).to, label: 'últimos 3 meses' };
    const y = new Date().getFullYear();
    return { from: `${y}-01-01`, to: `${y}-12-31`, label: String(y) };
  }, [period]);

  const load = useCallback(async () => {
    setSummary(null);
    const [s, e] = await Promise.all([
      sb().rpc('finance_summary', { p_server: serverId, p_from: range.from, p_to: range.to, p_project: project || null }),
      sb()
        .from('finance_entries')
        .select('*')
        .eq('server_id', serverId)
        .gte('occurred_on', monthRange(-5).from)
        .order('occurred_on', { ascending: false })
        .limit(1000),
    ]);
    if (s.error) toast.error(s.error);
    setSummary((s.data ?? []) as FinanceSummaryRow[]);
    setEntries((e.data ?? []) as FinanceEntry[]);
  }, [serverId, range, project]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = entries.filter((e) => e.occurred_on >= range.from && e.occurred_on <= range.to && (!project || e.project_id === project));

  const exportCsv = () => {
    const header = ['data', 'tipo', 'categoria', 'descricao', 'valor', 'bruto', 'taxas', 'moeda', 'situacao', 'projeto', 'origem'];
    const rows = visible.map((e) => [
      e.occurred_on,
      e.kind,
      catLabel(e.category),
      (e.description ?? '').replace(/"/g, '""'),
      String(e.amount).replace('.', ','),
      e.gross_amount != null ? String(e.gross_amount).replace('.', ',') : '',
      e.fee_amount != null ? String(e.fee_amount).replace('.', ',') : '',
      e.currency,
      STATUS_LABEL[e.status],
      projects.find((p) => p.id === e.project_id)?.name ?? '',
      e.source,
    ]);
    const csv = [header, ...rows].map((r) => r.map((c) => `"${c}"`).join(';')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `nexus-financas-${range.from}-a-${range.to}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <ViewHeader
        icon={<Wallet className="size-5" />}
        title="Finanças"
        subtitle={`Período: ${range.label}`}
        actions={
          canManage ? (
            <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setModal({ open: true, entry: null })}>
              <span className="hidden sm:inline">Lançamento</span>
            </Button>
          ) : null
        }
      />
      <div className="flex-1 overflow-y-auto nx-scroll">
        <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-4">
          <div className="flex flex-wrap gap-2 items-center">
            <Select value={period} onChange={(e) => setPeriod(e.target.value as typeof period)} className="!w-auto">
              <option value="mes">Este mês</option>
              <option value="mes_passado">Mês passado</option>
              <option value="tri">Últimos 3 meses</option>
              <option value="ano">Este ano</option>
            </Select>
            <Select value={project} onChange={(e) => setProject(e.target.value)} className="!w-auto">
              <option value="">Todos os projetos</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
            <Button size="sm" variant="secondary" icon={<Download className="size-4" />} onClick={exportCsv} disabled={!visible.length} className="ml-auto">
              Exportar CSV
            </Button>
          </div>

          <Notice tone="info">
            <span className="flex items-start gap-2">
              <Info className="size-4 mt-0.5 shrink-0" />
              <span>
                Os valores vêm só dos lançamentos registrados aqui. <b>Recebido</b> é dinheiro que entrou de fato; <b>pendente</b> e <b>estimado</b> ainda não. A importação
                automática de Robux depende de uma integração oficial do Roblox (ver docs) — nada é estimado pelo app.
              </span>
            </span>
          </Notice>

          {summary === null ? (
            <div className="flex justify-center py-10">
              <Spinner className="size-6" />
            </div>
          ) : summary.length === 0 ? (
            <EmptyState icon={<Wallet className="size-10" />} title="Nenhum lançamento no período" action={canManage ? <Button onClick={() => setModal({ open: true, entry: null })}>Registrar o primeiro</Button> : null}>
              Registre receitas (Robux, DevEx, patrocínios) e despesas (equipe, ferramentas, anúncios) para ver o resultado real.
            </EmptyState>
          ) : (
            summary.map((s) => (
              <Card key={s.currency} className="p-4 sm:p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold">{currencyLabel(s.currency)}</h3>
                  <span className="text-[12px] text-fg-3">{s.lancamentos} lançamentos</span>
                </div>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <Stat label="Receita recebida" value={formatMoney(s.receita_recebida, s.currency)} tone="success" icon={<ArrowUpRight className="size-4" />} />
                  <Stat label="A receber (pendente)" value={formatMoney(s.receita_pendente, s.currency)} />
                  <Stat label="Despesas pagas" value={formatMoney(s.despesa_paga, s.currency)} tone="danger" icon={<ArrowDownRight className="size-4" />} />
                  <Stat label="Resultado recebido" value={formatMoney(s.resultado_recebido, s.currency)} tone={Number(s.resultado_recebido) >= 0 ? 'success' : 'danger'} strong />
                  <Stat label="Receita bruta" value={formatMoney(s.receita_bruta, s.currency)} />
                  <Stat label="Taxas" value={formatMoney(s.taxas, s.currency)} />
                  <Stat label="Estimado (não recebido)" value={formatMoney(s.receita_estimada, s.currency)} />
                  <Stat label="Resultado previsto" value={formatMoney(s.resultado_previsto, s.currency)} hint="Inclui pendentes e estimados" />
                </div>
              </Card>
            ))
          )}

          <Card className="p-4 sm:p-5">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold">Últimos 6 meses</h3>
              <Select value={chartCurrency} onChange={(e) => setChartCurrency(e.target.value as Currency)} className="!w-auto !h-8 text-[13px]">
                {(['BRL', 'USD', 'ROBUX'] as Currency[]).map((c) => (
                  <option key={c} value={c}>
                    {currencyLabel(c)}
                  </option>
                ))}
              </Select>
            </div>
            <MonthlyChart entries={entries} currency={chartCurrency} />
          </Card>

          <Card className="overflow-hidden">
            <div className="px-4 sm:px-5 py-3 border-b border-line-soft font-semibold">Lançamentos do período</div>
            {visible.length === 0 ? (
              <p className="p-6 text-sm text-fg-3 text-center">Nada por aqui.</p>
            ) : (
              <div className="overflow-x-auto nx-scroll">
                <table className="w-full text-sm">
                  <thead className="text-[12px] text-fg-3 text-left">
                    <tr className="border-b border-line-soft">
                      <th className="px-4 py-2 font-medium">Data</th>
                      <th className="px-4 py-2 font-medium">Descrição</th>
                      <th className="px-4 py-2 font-medium">Categoria</th>
                      <th className="px-4 py-2 font-medium">Situação</th>
                      <th className="px-4 py-2 font-medium text-right">Valor</th>
                      <th className="px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((e) => (
                      <tr key={e.id} className="border-b border-line-soft last:border-0 hover:bg-raised/30">
                        <td className="px-4 py-2.5 whitespace-nowrap text-fg-2">{formatDate(e.occurred_on + 'T12:00:00')}</td>
                        <td className="px-4 py-2.5">
                          {e.description || <span className="text-fg-3">—</span>}
                          {e.source !== 'manual' ? <Badge className="ml-2">{e.source === 'roblox_import' ? 'Roblox' : 'CSV'}</Badge> : null}
                        </td>
                        <td className="px-4 py-2.5 text-fg-2 whitespace-nowrap">{catLabel(e.category)}</td>
                        <td className="px-4 py-2.5">
                          <Badge tone={e.status === 'recebido' || e.status === 'pago' ? 'success' : e.status === 'cancelado' ? 'neutral' : 'warn'}>{STATUS_LABEL[e.status]}</Badge>
                        </td>
                        <td className={cx('px-4 py-2.5 text-right tabular-nums whitespace-nowrap font-medium', e.kind === 'receita' ? 'text-success' : 'text-danger')}>
                          {e.kind === 'receita' ? '+' : '−'} {formatMoney(e.amount, e.currency)}
                        </td>
                        <td className="px-2 py-2.5">
                          {canManage ? (
                            <button className="size-8 rounded-lg text-fg-3 hover:text-fg hover:bg-raised flex items-center justify-center" onClick={() => setModal({ open: true, entry: e })} aria-label="Editar">
                              <Pencil className="size-4" />
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      </div>
      <EntryModal
        serverId={serverId}
        entry={modal.entry}
        open={modal.open}
        onClose={() => {
          setModal({ open: false, entry: null });
          void load();
        }}
      />
    </div>
  );
}

function Stat({ label, value, tone, icon, strong, hint }: { label: string; value: string; tone?: 'success' | 'danger'; icon?: React.ReactNode; strong?: boolean; hint?: string }) {
  return (
    <div className="rounded-xl border border-line-soft bg-[#11161f] p-3" title={hint}>
      <div className="text-[12px] text-fg-3 flex items-center gap-1">
        {icon}
        {label}
      </div>
      <div className={cx('mt-1 tabular-nums', strong ? 'text-xl font-bold' : 'text-[17px] font-semibold', tone === 'success' && 'text-success', tone === 'danger' && 'text-danger')}>{value}</div>
      {hint ? <div className="text-[11px] text-fg-3">{hint}</div> : null}
    </div>
  );
}

void formatDate;
