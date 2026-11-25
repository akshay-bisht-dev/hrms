import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { UserPlus } from 'lucide-react';
import { orgApi } from '@/services/org';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { ApiError } from '@/services/api';
import { errorMessage } from '@/utils/errors';

const STATUS_TONE = { ACTIVE: 'success', INVITED: 'info', SUSPENDED: 'warning', REMOVED: 'neutral' };

function RolePicker({ roles, value, onChange, legend }) {
  const { t } = useTranslation();
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1 text-sm font-medium">{legend}</legend>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {roles.map((r) => (
          <label key={r.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4"
              checked={value.includes(r.id)}
              onChange={(e) =>
                onChange(e.target.checked ? [...value, r.id] : value.filter((x) => x !== r.id))
              }
            />
            {r.name}
            {r.sensitive && <Badge tone="warning">{t('members.sensitive')}</Badge>}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function MembersPage() {
  const { t, i18n } = useTranslation();
  const { me, can } = useAuth();
  const qc = useQueryClient();
  const canManage = can('roles.manage');
  const members = useQuery({ queryKey: ['members'], queryFn: () => orgApi.members() });
  const roles = useQuery({ queryKey: ['roles'], queryFn: orgApi.roles });
  const [inviting, setInviting] = useState(false);
  const [invite, setInvite] = useState({ email: '', roleIds: [] });
  const [editing, setEditing] = useState(null);
  const [editRoles, setEditRoles] = useState([]);
  const [confirm, setConfirm] = useState(null);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});

  const refresh = (msg) => {
    qc.invalidateQueries({ queryKey: ['members'] });
    setNotice(msg);
    setError(null);
  };
  const fail = (err) => {
    setNotice(null);
    setError(errorMessage(err, t));
  };
  const sendInvite = useMutation({
    mutationFn: () => orgApi.invite(invite),
    onSuccess: () => {
      refresh(t('members.sent', { email: invite.email }));
      setInvite({ email: '', roleIds: [] });
      setInviting(false);
    },
    onError: (err) =>
      err instanceof ApiError && err.errors.length ? setFieldErrors(err.fieldErrors()) : fail(err),
  });
  const saveRoles = useMutation({
    mutationFn: () => orgApi.setRoles(editing, editRoles),
    onSuccess: () => {
      setEditing(null);
      refresh(t('members.done'));
    },
    onError: fail,
  });
  const act = useMutation({
    mutationFn: ({ id, action }) =>
      action === 'cancel' ? orgApi.cancelInvite(id) : orgApi.memberAction(id, action),
    onSuccess: () => {
      setConfirm(null);
      refresh(t('members.done'));
    },
    onError: (err) => {
      setConfirm(null);
      fail(err);
    },
  });

  const fmt = (d) => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(new Date(d));
  const action = (m, key, label, variant = 'ghost') =>
    confirm?.id === m.id && confirm.action === key ? (
      <Button
        size="sm"
        variant="destructive"
        onClick={() => act.mutate({ id: m.id, action: key })}
        disabled={act.isPending}
      >
        {t('members.confirm')}
      </Button>
    ) : (
      <Button size="sm" variant={variant} onClick={() => setConfirm({ id: m.id, action: key })}>
        {label}
      </Button>
    );

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">{t('members.title')}</h1>
          <p className="mt-1 text-sm text-text-muted">{t('members.subtitle')}</p>
        </div>
        {!inviting && (
          <Button onClick={() => setInviting(true)}>
            <UserPlus aria-hidden="true" className="size-4" />
            {t('members.invite')}
          </Button>
        )}
      </header>
      {notice && <Alert tone="success">{notice}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}

      {inviting && roles.data && (
        <form
          className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-5"
          onSubmit={(e) => {
            e.preventDefault();
            setFieldErrors({});
            sendInvite.mutate();
          }}
        >
          <h2 className="text-base font-semibold">{t('members.invite')}</h2>
          <Field
            label={t('members.email')}
            type="email"
            value={invite.email}
            error={fieldErrors.email}
            onChange={(e) => setInvite({ ...invite, email: e.target.value })}
            className="max-w-md"
          />
          <RolePicker
            roles={roles.data.data}
            value={invite.roleIds}
            onChange={(roleIds) => setInvite({ ...invite, roleIds })}
            legend={t('members.roles')}
          />
          {fieldErrors.roleIds && <span className="text-xs text-red-700">{fieldErrors.roleIds}</span>}
          <div className="flex gap-2">
            <Button
              type="submit"
              disabled={sendInvite.isPending || !invite.email || invite.roleIds.length === 0}
            >
              {t('members.send')}
            </Button>
            <Button variant="ghost" onClick={() => setInviting(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      )}

      <section
        aria-label={t('members.title')}
        className="rounded-[var(--radius-card)] border border-border bg-surface"
      >
        {members.isPending && (
          <p role="status" className="p-5 text-sm text-text-muted">
            {t('common.loading')}
          </p>
        )}
        {members.isError && (
          <div className="p-5">
            <Alert tone="error">{errorMessage(members.error, t)}</Alert>
          </div>
        )}
        {members.data?.data.length === 0 && (
          <p className="p-5 text-sm text-text-muted">{t('members.empty')}</p>
        )}
        <ul className="divide-y divide-slate-100">
          {(members.data?.data ?? []).map((m) => {
            const self = m.userId === me.user.id;
            return (
              <li key={m.id} className="flex flex-col gap-3 px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 font-medium">
                      {m.displayName} {self && <Badge tone="info">{t('members.you')}</Badge>}
                      <Badge tone={STATUS_TONE[m.status]} withDot>
                        {t(`members.status.${m.status}`)}
                      </Badge>
                      <Badge tone={m.mfaEnabled ? 'success' : 'neutral'}>
                        {m.mfaEnabled ? t('members.mfaOn') : t('members.mfaOff')}
                      </Badge>
                    </div>
                    <div className="truncate text-sm text-text-muted">{m.email}</div>
                    <div className="mt-1 text-xs text-text-muted">
                      {m.roles.map((r) => r.name).join(', ')} ·{' '}
                      {m.lastLoginAt
                        ? t('members.lastLogin', { date: fmt(m.lastLoginAt) })
                        : t('members.never')}
                    </div>
                  </div>
                  {!self && (
                    <div className="flex flex-wrap gap-1">
                      {m.status === 'INVITED' && action(m, 'cancel', t('members.cancelInvite'))}
                      {canManage && m.status !== 'INVITED' && (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setEditing(m.id);
                              setEditRoles(m.roles.map((r) => r.id));
                            }}
                          >
                            {t('members.editRoles')}
                          </Button>
                          {m.status === 'ACTIVE' && action(m, 'sign-out', t('members.signOut'))}
                          {m.status === 'ACTIVE' && action(m, 'suspend', t('members.suspend'))}
                          {m.status === 'SUSPENDED' &&
                            action(m, 'reactivate', t('members.reactivate'), 'secondary')}
                          {action(m, 'remove', t('members.remove'))}
                        </>
                      )}
                    </div>
                  )}
                </div>
                {editing === m.id && roles.data && (
                  <div className="flex flex-col gap-3 rounded-[var(--radius-control)] bg-bg p-4">
                    <RolePicker
                      roles={roles.data.data}
                      value={editRoles}
                      onChange={setEditRoles}
                      legend={t('members.roles')}
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => saveRoles.mutate()}
                        disabled={saveRoles.isPending || editRoles.length === 0}
                      >
                        {t('members.saveRoles')}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                        {t('common.cancel')}
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
