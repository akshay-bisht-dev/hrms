import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { MessageSquare, Play, Plus, Square, X } from 'lucide-react';
import { PRIORITY_TONE, TASK_TONE, tasksApi } from '@/services/tasks';
import { employeesApi } from '@/services/employees';
import { hms } from '@/services/work';
import { FormMessages, useFormAction } from '@/hooks/useFormAction';
import { useAuth } from '@/context/AuthContext';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, SelectField } from '@/components/ui/field';
import { errorMessage } from '@/utils/errors';

const card = 'rounded-[var(--radius-card)] border border-border bg-surface';
const fullName = (e) => [e.firstName, e.lastName].filter(Boolean).join(' ');
const VIEWS = ['mine', 'created', 'team', 'projects'];

export function TasksPage() {
  const { t } = useTranslation();
  const [view, setView] = useState('mine');
  const [open, setOpen] = useState(null);
  const [creating, setCreating] = useState(false);
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">{t('tasks.title')}</h1>
          <p className="mt-1 text-sm text-text-muted">{t('tasks.subtitle')}</p>
        </div>
        {view !== 'projects' && (
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" className="size-4" />
            {t('tasks.new')}
          </Button>
        )}
      </header>
      <div role="tablist" aria-label={t('tasks.views')} className="flex flex-wrap gap-1">
        {VIEWS.map((v) => (
          <button
            key={v}
            role="tab"
            type="button"
            aria-selected={view === v}
            onClick={() => {
              setView(v);
              setOpen(null);
            }}
            className={`rounded-[var(--radius-control)] px-3 py-2 text-sm ${view === v ? 'bg-primary-soft font-semibold text-primary-hover' : 'text-slate-700 hover:bg-surface'}`}
          >
            {t(`tasks.view.${v}`)}
          </button>
        ))}
      </div>
      {creating && <NewTask onClose={() => setCreating(false)} onCreated={(task) => setOpen(task.id)} />}
      {view === 'projects' ? (
        <Projects />
      ) : (
        <>
          <TaskList view={view} onOpen={setOpen} openId={open} />
          {open && <TaskDetail id={open} onClose={() => setOpen(null)} />}
        </>
      )}
    </div>
  );
}

function TaskList({ view, onOpen, openId }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [openOnly, setOpenOnly] = useState(true);
  const list = useQuery({
    queryKey: ['tasks', 'list', view, openOnly],
    queryFn: () => tasksApi.list({ view, open: openOnly ? 'true' : '' }),
  });
  const timer = useMutation({
    mutationFn: ({ id, running }) => (running ? tasksApi.stopTimer() : tasksApi.startTimer(id)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['work'] });
    },
  });
  const rows = list.data?.data ?? [];
  const today = new Date().toISOString().slice(0, 10);
  return (
    <section aria-label={t(`tasks.view.${view}`)} className={card}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4"
            checked={openOnly}
            onChange={(e) => setOpenOnly(e.target.checked)}
          />
          {t('tasks.openOnly')}
        </label>
        <span className="text-xs text-text-muted">{t('tasks.count', { count: rows.length })}</span>
      </div>
      {timer.isError && (
        <div className="px-5 pt-4">
          <Alert tone="error">{errorMessage(timer.error, t)}</Alert>
        </div>
      )}
      {list.isError && (
        <div className="p-5">
          <Alert tone="error">{errorMessage(list.error, t)}</Alert>
        </div>
      )}
      {list.isSuccess && rows.length === 0 && (
        <p className="p-5 text-sm text-text-muted">{t('tasks.none')}</p>
      )}
      <ul className="divide-y divide-slate-100">
        {rows.map((task) => (
          <li
            key={task.id}
            data-testid={`task-${task.title}`}
            className={`flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm ${openId === task.id ? 'bg-primary-soft/40' : ''}`}
          >
            <button
              type="button"
              className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-start"
              onClick={() => onOpen(task.id)}
              aria-label={t('tasks.openTask', { title: task.title })}
            >
              <span className="font-medium hover:underline">{task.title}</span>
              <span className="text-xs text-text-muted">
                {[
                  task.project?.code,
                  task.assignees.map((a) => a.name).join(', '),
                  task.dueDate ? t('tasks.due', { date: task.dueDate }) : null,
                  task.actualMin ? t('tasks.spent', { time: hms(task.actualMin * 60) }) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </button>
            <div className="flex flex-wrap items-center gap-2">
              {task.dueDate && task.dueDate < today && !['COMPLETED', 'CANCELLED'].includes(task.status) && (
                <Badge tone="danger">{t('tasks.overdue')}</Badge>
              )}
              <Badge tone={PRIORITY_TONE[task.priority]}>{t(`tasks.priority.${task.priority}`)}</Badge>
              <Badge tone={TASK_TONE[task.status]} withDot>
                {t(`tasks.status.${task.status}`)}
              </Badge>
              {view === 'mine' && ['ASSIGNED', 'IN_PROGRESS', 'ON_HOLD'].includes(task.status) && (
                <Button
                  size="sm"
                  variant={task.timerRunning ? 'primary' : 'secondary'}
                  disabled={timer.isPending}
                  onClick={() => timer.mutate({ id: task.id, running: task.timerRunning })}
                  aria-label={
                    task.timerRunning
                      ? t('tasks.stopTimerFor', { title: task.title })
                      : t('tasks.startTimerFor', { title: task.title })
                  }
                >
                  {task.timerRunning ? (
                    <Square aria-hidden="true" className="size-4" />
                  ) : (
                    <Play aria-hidden="true" className="size-4" />
                  )}
                  {task.timerRunning ? t('tasks.stopTimer') : t('tasks.startTimer')}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function TaskDetail({ id, onClose }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const task = useQuery({
    queryKey: ['tasks', 'one', id],
    queryFn: () => tasksApi.get(id),
    refetchOnMount: 'always', // status and allowed moves change as others act on the task
  });
  const [note, setNote] = useState('');
  const [comment, setComment] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['tasks'] });
  const move = useMutation({
    mutationFn: (status) => tasksApi.move(id, status, note.trim() || undefined),
    onSuccess: () => {
      setNote('');
      refresh();
    },
  });
  const say = useMutation({
    mutationFn: () => tasksApi.comment(id, comment),
    onSuccess: () => {
      setComment('');
      refresh();
    },
  });
  if (task.isPending) return <p role="status">{t('common.loading')}</p>;
  if (task.isError) return <Alert tone="error">{errorMessage(task.error, t)}</Alert>;
  const x = task.data;
  const when = (iso) =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  return (
    <section
      aria-label={t('tasks.detail', { title: x.title })}
      className="rounded-[var(--radius-card)] border border-primary/40 bg-surface"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">{x.title}</h2>
          <div className="flex flex-wrap items-center gap-2 text-sm text-text-muted">
            <Badge tone={TASK_TONE[x.status]} withDot>
              {t(`tasks.status.${x.status}`)}
            </Badge>
            {x.requiresApproval && <Badge tone="info">{t('tasks.needsApproval')}</Badge>}
            {x.project && <span>{x.project.name}</span>}
            <span>{x.assignees.map((a) => a.name).join(', ')}</span>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label={t('common.close')}>
          <X aria-hidden="true" className="size-4" />
        </Button>
      </div>
      <div className="flex flex-col gap-4 p-5 text-sm">
        {x.description && <p className="whitespace-pre-wrap">{x.description}</p>}
        <dl className="grid gap-3 sm:grid-cols-4">
          {[
            ['priority', t(`tasks.priority.${x.priority}`)],
            ['dueDate', x.dueDate ?? '—'],
            ['estimate', x.estimateMin ? hms(x.estimateMin * 60) : '—'],
            ['spent', hms(x.actualMin * 60)],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-text-muted">{t(`tasks.field.${k}`)}</dt>
              <dd className="font-medium">{v}</dd>
            </div>
          ))}
        </dl>
        {x.you.allowedMoves.length > 0 && (
          <div className="flex flex-col gap-2">
            <Field label={t('tasks.moveNote')} value={note} onChange={(e) => setNote(e.target.value)} />
            <div className="flex flex-wrap gap-2">
              {x.you.allowedMoves.map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={s === 'CANCELLED' ? 'ghost' : 'secondary'}
                  disabled={move.isPending}
                  onClick={() => move.mutate(s)}
                >
                  {t(`tasks.moveTo.${s}`)}
                </Button>
              ))}
            </div>
          </div>
        )}
        {move.isError && <Alert tone="error">{errorMessage(move.error, t)}</Alert>}
        <div className="flex flex-col gap-2">
          <h3 className="flex items-center gap-2 font-semibold">
            <MessageSquare aria-hidden="true" className="size-4" />
            {t('tasks.comments')}
          </h3>
          {x.comments.length === 0 && <p className="text-text-muted">{t('tasks.noComments')}</p>}
          <ul className="flex flex-col gap-2">
            {x.comments.map((c) => (
              <li key={c.id} className="rounded-[var(--radius-control)] bg-bg px-3 py-2">
                <div className="text-xs text-text-muted">
                  {c.author?.name} · {when(c.createdAt)}
                </div>
                <div className="whitespace-pre-wrap">{c.body}</div>
              </li>
            ))}
          </ul>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (comment.trim()) say.mutate();
            }}
          >
            <Field
              className="min-w-64 flex-1"
              label={t('tasks.addComment')}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
            <Button type="submit" size="sm" disabled={say.isPending || !comment.trim()}>
              {t('tasks.send')}
            </Button>
          </form>
        </div>
      </div>
    </section>
  );
}

function NewTask({ onClose, onCreated }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { scopeOf } = useAuth();
  const canAssignOthers = Boolean(scopeOf('task.assign'));
  const projects = useQuery({ queryKey: ['projects'], queryFn: tasksApi.projects });
  const people = useQuery({
    queryKey: ['employees', 'pick-all'],
    queryFn: () => employeesApi.list({ limit: 200 }),
    enabled: canAssignOthers,
  });
  const [form, setForm] = useState({
    title: '',
    description: '',
    projectId: '',
    priority: 'MEDIUM',
    dueDate: '',
    estimate: '',
    requiresApproval: false,
    assigneeId: '',
  });
  const set = (k) => (e) =>
    setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = useFormAction(
    () =>
      tasksApi.create({
        title: form.title,
        ...(form.description ? { description: form.description } : {}),
        ...(form.projectId ? { projectId: form.projectId } : {}),
        priority: form.priority,
        ...(form.dueDate ? { dueDate: form.dueDate } : {}),
        ...(form.estimate ? { estimateMin: Math.round(Number(form.estimate) * 60) } : {}),
        requiresApproval: form.requiresApproval,
        assigneeIds: form.assigneeId ? [form.assigneeId] : [],
      }),
    (task) => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      onCreated(task);
      onClose();
      return null;
    },
  );
  return (
    <section
      aria-label={t('tasks.new')}
      className="rounded-[var(--radius-card)] border border-primary/40 bg-surface"
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save.run();
        }}
        className="grid gap-4 p-5 sm:grid-cols-3"
      >
        <h2 className="text-base font-semibold sm:col-span-3">{t('tasks.new')}</h2>
        <div className="sm:col-span-3">
          <FormMessages action={save} />
        </div>
        <Field
          className="sm:col-span-2"
          label={t('tasks.f.title')}
          value={form.title}
          error={save.errors.title}
          onChange={set('title')}
        />
        <SelectField
          label={t('tasks.f.project')}
          value={form.projectId}
          error={save.errors.projectId}
          onChange={set('projectId')}
        >
          <option value="">{t('tasks.f.noProject')}</option>
          {(projects.data?.data ?? [])
            .filter((p) => ['PLANNED', 'ACTIVE'].includes(p.status))
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} · {p.name}
              </option>
            ))}
        </SelectField>
        {canAssignOthers ? (
          <SelectField
            label={t('tasks.f.assignee')}
            value={form.assigneeId}
            error={save.errors.assigneeIds}
            onChange={set('assigneeId')}
          >
            <option value="">{t('tasks.f.me')}</option>
            {(people.data?.data ?? []).map((e) => (
              <option key={e.id} value={e.id}>
                {fullName(e)} · {e.employeeCode}
              </option>
            ))}
          </SelectField>
        ) : (
          <Field label={t('tasks.f.assignee')} value={t('tasks.f.me')} readOnly />
        )}
        <SelectField label={t('tasks.f.priority')} value={form.priority} onChange={set('priority')}>
          {['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map((p) => (
            <option key={p} value={p}>
              {t(`tasks.priority.${p}`)}
            </option>
          ))}
        </SelectField>
        <Field
          label={t('tasks.f.dueDate')}
          type="date"
          value={form.dueDate}
          error={save.errors.dueDate}
          onChange={set('dueDate')}
        />
        <Field
          label={t('tasks.f.estimate')}
          type="number"
          min="0.25"
          step="0.25"
          value={form.estimate}
          error={save.errors.estimateMin}
          onChange={set('estimate')}
        />
        <label className="flex items-center gap-2 self-end pb-3 text-sm sm:col-span-2">
          <input
            type="checkbox"
            className="size-4"
            checked={form.requiresApproval}
            onChange={set('requiresApproval')}
          />
          {t('tasks.f.requiresApproval')}
        </label>
        <div className="flex flex-col gap-1.5 sm:col-span-3">
          <label htmlFor="task-description" className="text-sm font-medium">
            {t('tasks.f.description')}
          </label>
          <textarea
            id="task-description"
            rows={3}
            value={form.description}
            onChange={set('description')}
            className="rounded-[var(--radius-control)] border border-border-strong bg-surface px-3 py-2 text-sm"
          />
        </div>
        <div className="flex gap-2 sm:col-span-3">
          <Button type="submit" disabled={save.pending}>
            {t('tasks.create')}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </div>
      </form>
    </section>
  );
}

function Projects() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { can } = useAuth();
  const list = useQuery({ queryKey: ['projects'], queryFn: tasksApi.projects });
  const people = useQuery({
    queryKey: ['employees', 'pick-all'],
    queryFn: () => employeesApi.list({ limit: 200 }),
    enabled: can('project.manage'),
  });
  const [form, setForm] = useState({ code: '', name: '', clientName: '', ownerEmployeeId: '' });
  const save = useFormAction(
    () =>
      tasksApi.createProject({
        code: form.code,
        name: form.name,
        ...(form.clientName ? { clientName: form.clientName } : {}),
        ...(form.ownerEmployeeId ? { ownerEmployeeId: form.ownerEmployeeId } : {}),
      }),
    () => {
      setForm({ code: '', name: '', clientName: '', ownerEmployeeId: '' });
      qc.invalidateQueries({ queryKey: ['projects'] });
      return t('resource.created');
    },
  );
  const [adding, setAdding] = useState({});
  const add = useMutation({
    mutationFn: ({ id, employeeId }) => tasksApi.addMembers(id, [employeeId]),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  });
  const rows = list.data?.data ?? [];
  return (
    <>
      {can('project.manage') && (
        <section aria-label={t('tasks.projects.new')} className={card}>
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              save.run();
            }}
            className="grid gap-4 p-5 sm:grid-cols-4"
          >
            <h2 className="text-base font-semibold sm:col-span-4">{t('tasks.projects.new')}</h2>
            <div className="sm:col-span-4">
              <FormMessages action={save} />
            </div>
            <Field
              label={t('tasks.projects.code')}
              value={form.code}
              error={save.errors.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
            />
            <Field
              label={t('tasks.projects.name')}
              value={form.name}
              error={save.errors.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <Field
              label={t('tasks.projects.client')}
              value={form.clientName}
              onChange={(e) => setForm({ ...form, clientName: e.target.value })}
            />
            <SelectField
              label={t('tasks.projects.owner')}
              value={form.ownerEmployeeId}
              onChange={(e) => setForm({ ...form, ownerEmployeeId: e.target.value })}
            >
              <option value="">{t('tasks.projects.noOwner')}</option>
              {(people.data?.data ?? []).map((e) => (
                <option key={e.id} value={e.id}>
                  {fullName(e)}
                </option>
              ))}
            </SelectField>
            <div className="sm:col-span-4">
              <Button type="submit" disabled={save.pending}>
                {t('tasks.projects.create')}
              </Button>
            </div>
          </form>
        </section>
      )}
      <section aria-label={t('tasks.view.projects')} className={card}>
        {list.isSuccess && rows.length === 0 && (
          <p className="p-5 text-sm text-text-muted">{t('tasks.projects.none')}</p>
        )}
        {add.isError && (
          <div className="px-5 pt-4">
            <Alert tone="error">{errorMessage(add.error, t)}</Alert>
          </div>
        )}
        <ul className="divide-y divide-slate-100">
          {rows.map((p) => (
            <li key={p.id} className="flex flex-col gap-2 px-5 py-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">
                  {p.code} · {p.name}
                  {p.clientName ? <span className="text-text-muted"> · {p.clientName}</span> : null}
                </span>
                <div className="flex items-center gap-2">
                  <Badge tone={p.status === 'ACTIVE' ? 'success' : 'neutral'}>
                    {t(`tasks.projects.status.${p.status}`)}
                  </Badge>
                  <span className="text-xs text-text-muted">
                    {t('tasks.projects.open', { count: p.openTasks ?? 0 })}
                  </span>
                </div>
              </div>
              <span className="text-text-muted">
                {(p.members ?? []).map((m) => m.name).join(', ') || t('tasks.projects.noMembers')}
              </span>
              {can('project.manage') && (
                <div className="flex flex-wrap items-end gap-2">
                  <SelectField
                    label={t('tasks.projects.addMember')}
                    value={adding[p.id] ?? ''}
                    onChange={(e) => setAdding({ ...adding, [p.id]: e.target.value })}
                  >
                    <option value="">{t('resource.choose')}</option>
                    {(people.data?.data ?? [])
                      .filter((e) => !(p.members ?? []).some((m) => m.id === e.id))
                      .map((e) => (
                        <option key={e.id} value={e.id}>
                          {fullName(e)}
                        </option>
                      ))}
                  </SelectField>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!adding[p.id] || add.isPending}
                    onClick={() => add.mutate({ id: p.id, employeeId: adding[p.id] })}
                  >
                    {t('tasks.projects.add')}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
