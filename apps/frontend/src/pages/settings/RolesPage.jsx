import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Lock, Plus } from 'lucide-react';
import { orgApi } from '@/services/org';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { errorMessage } from '@/utils/errors';

const SCOPES = ['OWN', 'TEAM', 'DEPARTMENT', 'BRANCH', 'LEGAL_ENTITY', 'COMPANY'];

/** Permission matrix: one row per permission, grouped by module, with a scope for each granted permission. */
function RoleEditor({ role, catalog, onSaved, onCancel }) {
  const { t } = useTranslation();
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [grants, setGrants] = useState(
    () => new Map((role?.grants ?? []).map((g) => [g.permissionCode, g.scope])),
  );
  const [error, setError] = useState(null);
  const modules = useMemo(() => [...new Set(catalog.map((p) => p.module))], [catalog]);
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name,
        description: description || null,
        grants: [...grants].map(([permissionCode, scope]) => ({ permissionCode, scope })),
      };
      return role ? orgApi.updateRole(role.id, body) : orgApi.createRole(body);
    },
    onSuccess: onSaved,
    onError: (err) => setError(errorMessage(err, t)),
  });
  return (
    <form
      className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-5"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      {error && <Alert tone="error">{error}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('roles.name')} value={name} onChange={(e) => setName(e.target.value)} />
        <Field
          label={t('roles.description')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <tbody>
            {modules.map((mod) => (
              <ModuleRows
                key={mod}
                mod={mod}
                perms={catalog.filter((p) => p.module === mod)}
                grants={grants}
                setGrants={setGrants}
              />
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={save.isPending || name.trim().length < 2}>
          {t('roles.save')}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}

function ModuleRows({ mod, perms, grants, setGrants }) {
  const { t } = useTranslation();
  return (
    <>
      <tr>
        <th
          colSpan={2}
          scope="colgroup"
          className="bg-bg px-3 py-2 text-start text-xs font-semibold uppercase tracking-wide text-text-muted"
        >
          {mod}
        </th>
      </tr>
      {perms.map((p) => {
        const on = grants.has(p.code);
        return (
          <tr key={p.code} className="border-t border-slate-100">
            <td className="px-3 py-2">
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4"
                  checked={on}
                  onChange={(e) => {
                    const next = new Map(grants);
                    if (e.target.checked) next.set(p.code, 'COMPANY');
                    else next.delete(p.code);
                    setGrants(next);
                  }}
                />
                <span>
                  {p.description} {p.sensitive && <Badge tone="warning">{t('roles.sensitive')}</Badge>}
                  <span className="block font-mono text-xs text-text-muted">{p.code}</span>
                </span>
              </label>
            </td>
            <td className="w-48 px-3 py-2">
              {on && (
                <select
                  aria-label={t('roles.scope', { permission: p.code })}
                  value={grants.get(p.code)}
                  onChange={(e) => setGrants(new Map(grants).set(p.code, e.target.value))}
                  className="h-9 w-full rounded-[var(--radius-control)] border border-border-strong bg-surface px-2 text-sm"
                >
                  {SCOPES.map((s) => (
                    <option key={s} value={s}>
                      {t(`roles.scopes.${s}`)}
                    </option>
                  ))}
                </select>
              )}
            </td>
          </tr>
        );
      })}
    </>
  );
}

export function RolesPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const qc = useQueryClient();
  const canManage = can('roles.manage');
  const roles = useQuery({ queryKey: ['roles'], queryFn: orgApi.roles });
  const catalog = useQuery({ queryKey: ['permissions'], queryFn: orgApi.permissions, staleTime: Infinity });
  const [editing, setEditing] = useState(null); // null | 'new' | role
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);
  const remove = useMutation({
    mutationFn: orgApi.deleteRole,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['roles'] }),
    onError: (err) => setError(errorMessage(err, t)),
  });
  const saved = () => {
    setEditing(null);
    setNotice(t('roles.saved'));
    qc.invalidateQueries({ queryKey: ['roles'] });
  };
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">{t('roles.title')}</h1>
          <p className="mt-1 text-sm text-text-muted">{t('roles.subtitle')}</p>
        </div>
        {canManage && editing === null && (
          <Button onClick={() => setEditing('new')}>
            <Plus aria-hidden="true" className="size-4" />
            {t('roles.new')}
          </Button>
        )}
      </header>
      {notice && <Alert tone="success">{notice}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}
      {editing !== null && catalog.data && (
        <RoleEditor
          role={editing === 'new' ? null : editing}
          catalog={catalog.data.data}
          onSaved={saved}
          onCancel={() => setEditing(null)}
        />
      )}
      {roles.isPending && (
        <p role="status" className="text-sm text-text-muted">
          {t('common.loading')}
        </p>
      )}
      {roles.isError && <Alert tone="error">{errorMessage(roles.error, t)}</Alert>}
      <ul className="grid gap-3 sm:grid-cols-2">
        {(roles.data?.data ?? []).map((r) => (
          <li
            key={r.id}
            className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface p-4"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{r.name}</span>
              <Badge tone="neutral">{r.isSystem ? t('roles.builtIn') : t('roles.custom')}</Badge>
              {r.sensitive && <Badge tone="warning">{t('roles.sensitive')}</Badge>}
            </div>
            <p className="text-sm text-text-muted">{r.description}</p>
            <p className="text-xs text-text-muted">
              {t('roles.members', { count: r.memberCount })} · {r.grants.length} permissions
            </p>
            {canManage && (
              <div className="flex gap-1">
                {r.locked ? (
                  <span className="flex items-center gap-1 text-xs text-text-muted">
                    <Lock aria-hidden="true" className="size-3.5" />
                    {t('roles.locked')}
                  </span>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>
                    {t('roles.edit')}
                  </Button>
                )}
                {!r.isSystem && (
                  <Button size="sm" variant="ghost" onClick={() => remove.mutate(r.id)}>
                    {t('roles.delete')}
                  </Button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
