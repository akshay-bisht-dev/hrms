import { useState } from 'react';
import { Navigate, useLocation, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { FileText } from 'lucide-react';
import { employeesApi, fullName, openSignedUrl, uploadDocument } from '@/services/employees';
import { orgApi } from '@/services/org';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Field, SelectField } from '@/components/ui/field';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { ApiError } from '@/services/api';
import { errorMessage } from '@/utils/errors';
import { cn } from '@/utils/cn';
import { STATUS_TONE } from './EmployeesPage';
import { useOrgList } from './EmployeeNewPage';

const card = 'rounded-[var(--radius-card)] border border-border bg-surface p-5';
const fieldErrors = (err, t) =>
  err instanceof ApiError && err.errors.length ? err.fieldErrors() : { _: errorMessage(err, t) };

/** Runs a mutation and keeps its own success / error messages next to the form. */
function useAction(fn, onDone) {
  const { t } = useTranslation();
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState(null);
  const m = useMutation({
    mutationFn: fn,
    onSuccess: (data) => {
      setErrors({});
      onDone?.(data, setNotice);
    },
    onError: (err) => {
      setNotice(null);
      setErrors(fieldErrors(err, t));
    },
  });
  return { ...m, errors, notice, setNotice };
}

function ProfileTab({ e, editable, selfOnly }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    firstName: e.firstName,
    lastName: e.lastName ?? '',
    preferredName: e.preferredName ?? '',
    workEmail: e.workEmail ?? '',
    personalEmail: e.personalEmail ?? '',
    phone: e.phone ?? '',
    dateOfBirth: e.dateOfBirth ?? '',
  });
  const [revealed, setRevealed] = useState(null);
  const { can } = useAuth();
  const save = useAction(
    () => {
      const keys = selfOnly ? ['preferredName', 'personalEmail', 'phone'] : Object.keys(form);
      return employeesApi.update(
        e.id,
        Object.fromEntries(
          keys
            .map((k) => [k, form[k] === '' ? null : form[k]])
            .filter(([k, v]) => !(k === 'firstName' && v === null)),
        ),
      );
    },
    (_d, setNotice) => {
      qc.invalidateQueries({ queryKey: ['employee', e.id] });
      setNotice(t('employees.profile.saved'));
    },
  );
  const disabled = (k) => !editable || (selfOnly && !['preferredName', 'personalEmail', 'phone'].includes(k));
  const f = (k, label, type = 'text') => (
    <Field
      key={k}
      label={label}
      type={type}
      value={form[k]}
      error={save.errors[k]}
      disabled={disabled(k)}
      onChange={(ev) => setForm({ ...form, [k]: ev.target.value })}
    />
  );
  return (
    <div className="flex flex-col gap-4">
      <form
        className={cn(card, 'grid gap-4 sm:grid-cols-2')}
        onSubmit={(ev) => {
          ev.preventDefault();
          save.mutate();
        }}
      >
        {selfOnly && (
          <Alert tone="info" className="sm:col-span-2">
            {t('employees.profile.selfNote')}
          </Alert>
        )}
        {save.notice && (
          <Alert tone="success" className="sm:col-span-2">
            {save.notice}
          </Alert>
        )}
        {save.errors._ && (
          <Alert tone="error" className="sm:col-span-2">
            {save.errors._}
          </Alert>
        )}
        {f('firstName', t('employees.f.firstName'))}
        {f('lastName', t('employees.f.lastName'))}
        {f('preferredName', t('employees.f.preferredName'))}
        {f('workEmail', t('employees.f.workEmail'), 'email')}
        {f('personalEmail', t('employees.f.personalEmail'), 'email')}
        {f('phone', t('employees.f.phone'))}
        {f('dateOfBirth', t('employees.f.dateOfBirth'), 'date')}
        {editable && (
          <div className="sm:col-span-2">
            <Button type="submit" disabled={save.isPending}>
              {t('employees.profile.save')}
            </Button>
          </div>
        )}
      </form>
      <section className={cn(card, 'grid gap-3 text-sm sm:grid-cols-2')}>
        <div>
          <div className="font-medium">
            {e.nationalId
              ? `${t('employees.f.nationalId')} (${e.nationalId.type})`
              : t('employees.f.nationalId')}
          </div>
          <div className="tabular mt-1 text-text-muted">
            {revealed ?? e.nationalId?.masked ?? t('employees.profile.nationalIdNone')}{' '}
            {e.nationalId && !revealed && can('employee.sensitive.view') && (
              <button
                type="button"
                className="text-primary hover:underline"
                onClick={async () => setRevealed((await employeesApi.revealId(e.id)).value)}
              >
                {t('employees.profile.reveal')}
              </button>
            )}
          </div>
        </div>
        <div>
          <div className="font-medium">{t('employees.profile.signIn')}</div>
          <div className="mt-1 text-text-muted">
            {e.member
              ? t('employees.profile.linked', {
                  email: e.member.email,
                  status: e.member.status.toLowerCase(),
                })
              : t('employees.profile.notLinked')}
          </div>
          {!e.member && can('members.invite') && <InviteToSignIn e={e} />}
        </div>
      </section>
    </div>
  );
}

function InviteToSignIn({ e }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const roles = useQuery({ queryKey: ['roles'], queryFn: orgApi.roles });
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(e.workEmail ?? '');
  const [roleId, setRoleId] = useState('');
  const defaultRole = roles.data?.data.find((r) => r.systemKey === 'employee')?.id ?? '';
  const send = useAction(
    () =>
      orgApi.invite({
        email,
        roleIds: [roleId || defaultRole],
        employeeId: e.id,
      }),
    (_d, setNotice) => {
      setNotice(t('employees.profile.inviteSent', { email }));
      qc.invalidateQueries({ queryKey: ['employee', e.id] });
    },
  );
  if (!open) {
    return (
      <Button size="sm" variant="secondary" className="mt-2" onClick={() => setOpen(true)}>
        {t('employees.profile.invite')}
      </Button>
    );
  }
  return (
    <form
      className="mt-3 flex flex-col gap-3"
      onSubmit={(ev) => {
        ev.preventDefault();
        send.mutate();
      }}
    >
      {send.notice && <Alert tone="success">{send.notice}</Alert>}
      {send.errors._ && <Alert tone="error">{send.errors._}</Alert>}
      <Field
        label={t('employees.profile.inviteEmail')}
        type="email"
        value={email}
        error={send.errors.email}
        onChange={(ev) => setEmail(ev.target.value)}
      />
      <SelectField
        label={t('employees.profile.inviteRole')}
        value={roleId || defaultRole}
        onChange={(ev) => setRoleId(ev.target.value)}
      >
        {(roles.data?.data ?? []).map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </SelectField>
      <div>
        <Button type="submit" size="sm" disabled={send.isPending || !email || !roles.data}>
          {t('employees.profile.inviteSend')}
        </Button>
      </div>
    </form>
  );
}

function JobTab({ e, canUpdate }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const history = useQuery({
    queryKey: ['employee', e.id, 'history'],
    queryFn: () => employeesApi.history(e.id),
  });
  const departments = useOrgList('departments');
  const designations = useOrgList('designations');
  const branches = useOrgList('branches');
  const people = useQuery({
    queryKey: ['employees', 'managers'],
    queryFn: () => employeesApi.list({ limit: 200 }),
    enabled: canUpdate,
  });
  const today = new Date().toISOString().slice(0, 10);
  const [change, setChange] = useState({
    changeReason: 'PROMOTION',
    effectiveFrom: today,
    departmentId: '__keep',
    designationId: '__keep',
    branchId: '__keep',
    managerId: '__keep',
  });
  const [status, setStatus] = useState({ status: '', effectiveDate: today, reason: '' });
  const refresh = (setNotice, msg) => {
    qc.invalidateQueries({ queryKey: ['employee', e.id] });
    qc.invalidateQueries({ queryKey: ['employees'] });
    setNotice(msg);
  };
  const job = useAction(
    () =>
      employeesApi.changeJob(e.id, {
        changeReason: change.changeReason,
        effectiveFrom: change.effectiveFrom,
        ...Object.fromEntries(
          ['departmentId', 'designationId', 'branchId', 'managerId']
            .filter((k) => change[k] !== '__keep')
            .map((k) => [k, change[k] || null]),
        ),
      }),
    (_d, setNotice) => refresh(setNotice, t('employees.job.saved')),
  );
  const st = useAction(
    () => employeesApi.changeStatus(e.id, status),
    (_d, setNotice) => refresh(setNotice, t('employees.job.saved')),
  );
  const fmt = (d) =>
    d
      ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(new Date(`${d}T00:00:00Z`))
      : '';
  const keepSelect = (k, label, opts) => (
    <SelectField
      label={label}
      value={change[k]}
      error={job.errors[k]}
      onChange={(ev) => setChange({ ...change, [k]: ev.target.value })}
    >
      <option value="__keep">{t('employees.job.noChange')}</option>
      <option value="">{k === 'managerId' ? t('employees.job.noManager') : t('resource.none')}</option>
      {opts}
    </SelectField>
  );
  const nextStatuses = {
    PREBOARDING: ['PROBATION', 'ACTIVE', 'EXITED'],
    PROBATION: ['ACTIVE', 'NOTICE', 'EXITED'],
    ACTIVE: ['NOTICE', 'EXITED'],
    NOTICE: ['ACTIVE', 'EXITED'],
    EXITED: [],
  }[e.status];

  return (
    <div className="flex flex-col gap-4">
      <section aria-label={t('employees.job.history')} className={card}>
        <h2 className="text-base font-semibold">{t('employees.job.history')}</h2>
        {history.isPending && <p className="mt-2 text-sm text-text-muted">{t('common.loading')}</p>}
        <ol className="mt-3 flex flex-col gap-3">
          {(history.data?.data ?? []).map((r) => (
            <li key={r.id} className="border-s-2 border-border ps-3 text-sm">
              <div className="font-medium">
                {t(`employees.job.reasons.${r.changeReason}`)} · {fmt(r.effectiveFrom)}
                {r.effectiveTo ? ` – ${fmt(r.effectiveTo)}` : ` · ${t('employees.job.current')}`}
              </div>
              <div className="text-text-muted">
                {[
                  r.designation,
                  r.department,
                  r.branch,
                  r.manager && `${t('employees.f.manager')}: ${r.manager}`,
                ]
                  .filter(Boolean)
                  .join(' · ') || '—'}
              </div>
            </li>
          ))}
        </ol>
      </section>

      {canUpdate && e.status !== 'EXITED' && (
        <form
          className={cn(card, 'grid gap-4 sm:grid-cols-2')}
          onSubmit={(ev) => {
            ev.preventDefault();
            job.mutate();
          }}
        >
          <h2 className="text-base font-semibold sm:col-span-2">{t('employees.job.change')}</h2>
          {job.notice && (
            <Alert tone="success" className="sm:col-span-2">
              {job.notice}
            </Alert>
          )}
          {job.errors._ && (
            <Alert tone="error" className="sm:col-span-2">
              {job.errors._}
            </Alert>
          )}
          <SelectField
            label={t('employees.job.reason')}
            value={change.changeReason}
            onChange={(ev) => setChange({ ...change, changeReason: ev.target.value })}
          >
            {['PROMOTION', 'TRANSFER', 'MANAGER_CHANGE', 'REORGANIZATION', 'CORRECTION'].map((r) => (
              <option key={r} value={r}>
                {t(`employees.job.reasons.${r}`)}
              </option>
            ))}
          </SelectField>
          <Field
            label={t('employees.job.effective')}
            type="date"
            value={change.effectiveFrom}
            error={job.errors.effectiveFrom}
            onChange={(ev) => setChange({ ...change, effectiveFrom: ev.target.value })}
          />
          {keepSelect(
            'designationId',
            t('employees.f.designation'),
            (designations.data?.data ?? []).map((x) => (
              <option key={x.id} value={x.id}>
                {x.title}
              </option>
            )),
          )}
          {keepSelect(
            'departmentId',
            t('employees.f.department'),
            (departments.data?.data ?? []).map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            )),
          )}
          {keepSelect(
            'branchId',
            t('employees.f.branch'),
            (branches.data?.data ?? []).map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            )),
          )}
          {keepSelect(
            'managerId',
            t('employees.f.manager'),
            (people.data?.data ?? [])
              .filter((p) => p.id !== e.id)
              .map((x) => <option key={x.id} value={x.id}>{`${fullName(x)} · ${x.employeeCode}`}</option>),
          )}
          <div className="sm:col-span-2">
            <Button type="submit" disabled={job.isPending}>
              {t('employees.job.save')}
            </Button>
          </div>
        </form>
      )}

      {canUpdate && nextStatuses.length > 0 && (
        <form
          className={cn(card, 'grid gap-4 sm:grid-cols-3')}
          onSubmit={(ev) => {
            ev.preventDefault();
            st.mutate();
          }}
        >
          <h2 className="text-base font-semibold sm:col-span-3">{t('employees.job.statusTitle')}</h2>
          {st.notice && (
            <Alert tone="success" className="sm:col-span-3">
              {st.notice}
            </Alert>
          )}
          {st.errors._ && (
            <Alert tone="error" className="sm:col-span-3">
              {st.errors._}
            </Alert>
          )}
          <SelectField
            label={t('employees.job.newStatus')}
            value={status.status}
            onChange={(ev) => setStatus({ ...status, status: ev.target.value })}
          >
            <option value="">{t('resource.choose')}</option>
            {nextStatuses.map((s) => (
              <option key={s} value={s}>
                {t(`employees.status.${s}`)}
              </option>
            ))}
          </SelectField>
          <Field
            label={t('employees.job.effective')}
            type="date"
            value={status.effectiveDate}
            error={st.errors.effectiveDate}
            onChange={(ev) => setStatus({ ...status, effectiveDate: ev.target.value })}
          />
          <Field
            label={t('employees.job.statusReason')}
            value={status.reason}
            error={st.errors.reason}
            onChange={(ev) => setStatus({ ...status, reason: ev.target.value })}
          />
          <div className="sm:col-span-3">
            <Button
              type="submit"
              variant={status.status === 'EXITED' ? 'destructive' : 'primary'}
              disabled={st.isPending || !status.status || !status.reason}
            >
              {t('employees.job.statusSave')}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function ContactsTab({ e, editable }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const key = ['employee', e.id, 'contacts'];
  const list = useQuery({ queryKey: key, queryFn: () => employeesApi.contacts(e.id) });
  const [form, setForm] = useState({ name: '', relationship: '', phone: '', email: '' });
  const add = useAction(
    () => employeesApi.addContact(e.id, { ...form, email: form.email || null }),
    () => {
      setForm({ name: '', relationship: '', phone: '', email: '' });
      qc.invalidateQueries({ queryKey: key });
    },
  );
  const remove = useMutation({
    mutationFn: (cid) => employeesApi.removeContact(e.id, cid),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
  return (
    <section className={card}>
      {list.isSuccess && list.data.data.length === 0 && (
        <p className="text-sm text-text-muted">{t('employees.contacts.empty')}</p>
      )}
      <ul className="divide-y divide-slate-100">
        {(list.data?.data ?? []).map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
            <span>
              <span className="font-medium">{c.name}</span> · {c.relationship} ·{' '}
              <span className="tabular">{c.phone}</span>
              {c.email ? ` · ${c.email}` : ''}
            </span>
            {editable && (
              <Button size="sm" variant="ghost" onClick={() => remove.mutate(c.id)}>
                {t('employees.contacts.remove')}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {editable && (
        <form
          className="mt-4 grid gap-3 sm:grid-cols-4 sm:items-end"
          onSubmit={(ev) => {
            ev.preventDefault();
            add.mutate();
          }}
        >
          {add.errors._ && (
            <Alert tone="error" className="sm:col-span-4">
              {add.errors._}
            </Alert>
          )}
          <Field
            label={t('employees.contacts.name')}
            value={form.name}
            error={add.errors.name}
            onChange={(ev) => setForm({ ...form, name: ev.target.value })}
          />
          <Field
            label={t('employees.contacts.relationship')}
            value={form.relationship}
            error={add.errors.relationship}
            onChange={(ev) => setForm({ ...form, relationship: ev.target.value })}
          />
          <Field
            label={t('employees.contacts.phone')}
            value={form.phone}
            error={add.errors.phone}
            onChange={(ev) => setForm({ ...form, phone: ev.target.value })}
          />
          <Field
            label={t('employees.contacts.email')}
            type="email"
            value={form.email}
            error={add.errors.email}
            onChange={(ev) => setForm({ ...form, email: ev.target.value })}
          />
          <div>
            <Button type="submit" disabled={add.isPending}>
              {t('employees.contacts.add')}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

const SCAN_TONE = { PENDING: 'info', CLEAN: 'success', FAILED: 'danger', INFECTED: 'danger' };

function DocumentsTab({ e, canUpload, canVerify }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const key = ['employee', e.id, 'documents'];
  const list = useQuery({
    queryKey: key,
    queryFn: () => employeesApi.documents(e.id),
    refetchInterval: (q) => (q.state.data?.data.some((d) => d.scanStatus === 'PENDING') ? 1500 : false),
  });
  const [file, setFile] = useState(null);
  const [category, setCategory] = useState('ID_PROOF');
  const [error, setError] = useState(null);
  const upload = useMutation({
    mutationFn: () => uploadDocument(e.id, file, category),
    onSuccess: () => {
      setFile(null);
      setError(null);
      qc.invalidateQueries({ queryKey: key });
    },
    onError: (err) => setError(errorMessage(err, t)),
  });
  const act = useMutation({
    mutationFn: async ({ action, id }) => {
      if (action === 'download') return openSignedUrl((await employeesApi.documentUrl(e.id, id)).url);
      if (action === 'verify') return employeesApi.verifyDocument(e.id, id);
      return employeesApi.deleteDocument(e.id, id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (err) => setError(errorMessage(err, t)),
  });
  const kb = (n) => `${Math.max(1, Math.round(n / 1024))} KB`;
  return (
    <section className={card}>
      {error && (
        <Alert tone="error" className="mb-3">
          {error}
        </Alert>
      )}
      {list.isSuccess && list.data.data.length === 0 && (
        <p className="text-sm text-text-muted">{t('employees.documents.empty')}</p>
      )}
      <ul className="divide-y divide-slate-100">
        {(list.data?.data ?? []).map((d) => (
          <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
            <span className="flex items-center gap-2">
              <FileText aria-hidden="true" className="size-4 text-text-muted" />
              <span className="font-medium">{d.fileName}</span>
              <span className="text-text-muted">
                {t(`employees.documents.categories.${d.category}`)} · {kb(d.sizeBytes)} ·{' '}
                {new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(
                  new Date(d.createdAt),
                )}
              </span>
              <Badge tone={SCAN_TONE[d.scanStatus]} withDot>
                {t(`employees.documents.scan.${d.scanStatus}`)}
              </Badge>
              {d.verifiedAt && <Badge tone="success">{t('employees.documents.verified')}</Badge>}
            </span>
            <span className="flex gap-1">
              {d.scanStatus === 'CLEAN' && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => act.mutate({ action: 'download', id: d.id })}
                >
                  {t('employees.documents.download')}
                </Button>
              )}
              {canVerify && d.scanStatus === 'CLEAN' && !d.verifiedAt && (
                <Button size="sm" variant="ghost" onClick={() => act.mutate({ action: 'verify', id: d.id })}>
                  {t('employees.documents.verify')}
                </Button>
              )}
              {canUpload && (
                <Button size="sm" variant="ghost" onClick={() => act.mutate({ action: 'delete', id: d.id })}>
                  {t('employees.documents.delete')}
                </Button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {canUpload && (
        <form
          className="mt-4 grid gap-3 sm:grid-cols-[200px_1fr_auto] sm:items-end"
          onSubmit={(ev) => {
            ev.preventDefault();
            upload.mutate();
          }}
        >
          <SelectField
            label={t('employees.documents.category')}
            value={category}
            onChange={(ev) => setCategory(ev.target.value)}
          >
            {[
              'ID_PROOF',
              'ADDRESS_PROOF',
              'EDUCATION',
              'EMPLOYMENT',
              'CONTRACT',
              'TAX',
              'MEDICAL',
              'OTHER',
            ].map((c) => (
              <option key={c} value={c}>
                {t(`employees.documents.categories.${c}`)}
              </option>
            ))}
          </SelectField>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            {t('employees.documents.file')}
            <input
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.docx"
              onChange={(ev) => setFile(ev.target.files?.[0] ?? null)}
              className="text-sm font-normal"
            />
          </label>
          <Button type="submit" disabled={!file || upload.isPending}>
            {upload.isPending ? t('employees.documents.uploading') : t('employees.documents.upload')}
          </Button>
        </form>
      )}
    </section>
  );
}

function BankTab({ e, canManage }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const key = ['employee', e.id, 'bank'];
  const list = useQuery({ queryKey: key, queryFn: () => employeesApi.bank(e.id) });
  const [form, setForm] = useState({
    accountHolder: fullName(e),
    accountNumber: '',
    code: '',
    currency: e.payCurrency,
    effectiveFrom: new Date().toISOString().slice(0, 10),
  });
  const add = useAction(
    () =>
      employeesApi.addBank(e.id, {
        accountHolder: form.accountHolder,
        accountNumber: form.accountNumber,
        currency: form.currency,
        effectiveFrom: form.effectiveFrom,
        bankFields: form.code ? { code: form.code } : {},
      }),
    () => {
      setForm({ ...form, accountNumber: '', code: '' });
      qc.invalidateQueries({ queryKey: key });
    },
  );
  const fmt = (d) =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(new Date(`${d}T00:00:00Z`));
  return (
    <section className={card}>
      <p className="mb-3 text-xs text-text-muted">{t('employees.bank.note')}</p>
      {list.isError && <Alert tone="error">{errorMessage(list.error, t)}</Alert>}
      {list.isSuccess && list.data.data.length === 0 && (
        <p className="text-sm text-text-muted">{t('employees.bank.empty')}</p>
      )}
      <ul className="divide-y divide-slate-100">
        {(list.data?.data ?? []).map((a) => (
          <li key={a.id} className="py-3 text-sm">
            <span className="tabular font-medium">{a.accountNumber}</span> · {a.accountHolder} · {a.currency}
            {Object.values(a.bankFields ?? {}).length > 0 &&
              ` · ${Object.values(a.bankFields).join(' ')}`}{' '}
            {a.effectiveTo ? (
              <span className="text-text-muted">
                ({fmt(a.effectiveFrom)} – {fmt(a.effectiveTo)})
              </span>
            ) : (
              <Badge tone="success">{t('employees.bank.current')}</Badge>
            )}
          </li>
        ))}
      </ul>
      {canManage && (
        <form
          className="mt-4 grid gap-3 sm:grid-cols-2"
          onSubmit={(ev) => {
            ev.preventDefault();
            add.mutate();
          }}
        >
          {add.errors._ && (
            <Alert tone="error" className="sm:col-span-2">
              {add.errors._}
            </Alert>
          )}
          <Field
            label={t('employees.bank.holder')}
            value={form.accountHolder}
            error={add.errors.accountHolder}
            onChange={(ev) => setForm({ ...form, accountHolder: ev.target.value })}
          />
          <Field
            label={t('employees.bank.number')}
            value={form.accountNumber}
            error={add.errors.accountNumber}
            onChange={(ev) => setForm({ ...form, accountNumber: ev.target.value })}
            autoComplete="off"
          />
          <Field
            label={t('employees.bank.codeLabel')}
            value={form.code}
            onChange={(ev) => setForm({ ...form, code: ev.target.value })}
          />
          <Field
            label={t('employees.bank.from')}
            type="date"
            value={form.effectiveFrom}
            error={add.errors.effectiveFrom}
            onChange={(ev) => setForm({ ...form, effectiveFrom: ev.target.value })}
          />
          <div className="sm:col-span-2">
            <Button type="submit" disabled={add.isPending || !form.accountNumber}>
              {t('employees.bank.add')}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

export function EmployeeProfilePage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const { me, can } = useAuth();
  const location = useLocation();
  const [tab, setTab] = useState('profile');
  const employee = useQuery({ queryKey: ['employee', id], queryFn: () => employeesApi.get(id) });
  if (employee.isPending)
    return (
      <p role="status" className="text-sm text-text-muted">
        {t('common.loading')}
      </p>
    );
  if (employee.isError) return <Alert tone="error">{errorMessage(employee.error, t)}</Alert>;
  const e = employee.data;
  const self = me?.user && e.member?.email === me.user.email;
  const canUpdate = can('employee.profile.update');
  const tabs = [
    'profile',
    'job',
    'contacts',
    'documents',
    ...(self || can('payroll.bank.view') ? ['bank'] : []),
  ];
  return (
    <div className="flex flex-col gap-6">
      {location.state?.created && <Alert tone="success">{t('employees.created')}</Alert>}
      <header className="flex flex-wrap items-center gap-3">
        <span
          aria-hidden="true"
          className="flex size-12 items-center justify-center rounded-full bg-primary-soft text-lg font-semibold text-primary-hover"
        >
          {(e.preferredName || e.firstName)[0]}
          {e.lastName?.[0] ?? ''}
        </span>
        <div>
          <h1 className="text-2xl font-bold">{fullName(e)}</h1>
          <p className="text-sm text-text-muted">
            <span className="tabular">{e.employeeCode}</span> ·{' '}
            {[e.designation?.title, e.department?.name, e.branch?.name].filter(Boolean).join(' · ') || '—'}
            {e.manager && ` · ${t('employees.f.manager')}: ${e.manager.name}`}
          </p>
        </div>
        <Badge tone={STATUS_TONE[e.status]} withDot>
          {t(`employees.status.${e.status}`)}
        </Badge>
      </header>
      <div role="tablist" aria-label={fullName(e)} className="flex flex-wrap gap-1 border-b border-border">
        {tabs.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm',
              tab === k
                ? 'border-primary font-semibold text-primary-hover'
                : 'border-transparent text-text-muted hover:text-text',
            )}
          >
            {t(`employees.tabs.${k}`)}
          </button>
        ))}
      </div>
      {tab === 'profile' && <ProfileTab e={e} editable={canUpdate || self} selfOnly={!canUpdate && self} />}
      {tab === 'job' && <JobTab e={e} canUpdate={canUpdate} />}
      {tab === 'contacts' && <ContactsTab e={e} editable={canUpdate || self} />}
      {tab === 'documents' && (
        <DocumentsTab
          e={e}
          canUpload={self || can('employee.documents.manage')}
          canVerify={can('employee.documents.manage')}
        />
      )}
      {tab === 'bank' && <BankTab e={e} canManage={can('payroll.bank.manage')} />}
    </div>
  );
}

/** "My profile": sends people to their own employee record. */
export function MyProfileRedirect() {
  const { t } = useTranslation();
  const mine = useQuery({ queryKey: ['employee', 'me'], queryFn: employeesApi.me, retry: false });
  if (mine.isPending)
    return (
      <p role="status" className="text-sm text-text-muted">
        {t('common.loading')}
      </p>
    );
  if (mine.isError) return <Alert tone="info">{errorMessage(mine.error, t)}</Alert>;
  return <Navigate to={`/employees/${mine.data.id}`} replace />;
}
