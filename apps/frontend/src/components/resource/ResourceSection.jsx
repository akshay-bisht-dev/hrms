import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { apiFetch, ApiError } from '@/services/api';
import { Button } from '@/components/ui/button';
import { Field, SelectField } from '@/components/ui/field';
import { Alert } from '@/components/ui/alert';
import { errorMessage } from '@/utils/errors';

/**
 * Config-driven list + inline create/edit form for one API resource (design system §4–5: every list has loading,
 * empty, error and success states). Fields describe the form; `toBody` / `fromRow` convert between form and API shapes.
 *
 * @typedef {{ name: string, label: string, type?: 'text'|'number'|'select'|'checkbox'|'timezone', required?: boolean, hint?: string,
 *             options?: Array<{ value: string, label: string }>, optional?: boolean, default?: any }} FieldDef
 * @param {{ title: string, description?: string, endpoint: string, queryKey: unknown[], columns: Array<{ key: string, label: string, render?: (row: any) => any }>,
 *           fields: FieldDef[], canWrite: boolean, emptyText: string, toBody?: (form: any) => any, fromRow?: (row: any) => any,
 *           rowActions?: (row: any) => any, searchable?: boolean }} props
 */
export function ResourceSection({
  title,
  description,
  endpoint,
  queryKey,
  columns,
  fields,
  canWrite,
  emptyText,
  toBody,
  fromRow,
  rowActions,
  searchable = true,
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null); // null | 'new' | row
  const [form, setForm] = useState({});
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const list = useQuery({
    queryKey: [...queryKey, q],
    queryFn: () => apiFetch(`${endpoint}?limit=200${q ? `&q=${encodeURIComponent(q)}` : ''}`),
  });
  const emptyForm = useMemo(
    () => Object.fromEntries(fields.map((f) => [f.name, f.default ?? (f.type === 'checkbox' ? false : '')])),
    [fields],
  );
  const timezones = useMemo(
    () => (typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['UTC']),
    [],
  );

  const done = (msg) => {
    qc.invalidateQueries({ queryKey });
    setEditing(null);
    setNotice(msg);
  };
  const onError = (err) => {
    if (err instanceof ApiError && err.errors.length) setFieldErrors(err.fieldErrors());
    else setError(errorMessage(err, t));
  };
  const save = useMutation({
    mutationFn: ({ id, body }) =>
      apiFetch(id ? `${endpoint}/${id}` : endpoint, { method: id ? 'PATCH' : 'POST', json: body }),
    onSuccess: (_d, v) => done(v.id ? t('resource.updated') : t('resource.created')),
    onError,
  });
  const remove = useMutation({
    mutationFn: (id) => apiFetch(`${endpoint}/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setConfirmDelete(null);
      done(t('resource.deleted'));
    },
    onError: (err) => {
      setConfirmDelete(null);
      setError(errorMessage(err, t));
    },
  });

  const open = (row) => {
    setError(null);
    setNotice(null);
    setFieldErrors({});
    setEditing(row ?? 'new');
    setForm(row ? { ...emptyForm, ...(fromRow ? fromRow(row) : row) } : emptyForm);
  };
  const submit = (e) => {
    e.preventDefault();
    setFieldErrors({});
    setError(null);
    const raw = Object.fromEntries(
      fields.map((f) => {
        const v = form[f.name];
        if (f.type === 'number') return [f.name, v === '' || v === null ? null : Number(v)];
        if (f.type === 'checkbox') return [f.name, Boolean(v)];
        return [f.name, f.optional && v === '' ? null : v];
      }),
    );
    save.mutate({ id: editing === 'new' ? null : editing.id, body: toBody ? toBody(raw) : raw });
  };

  const rows = list.data?.data ?? [];
  return (
    <section aria-label={title} className="rounded-[var(--radius-card)] border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          {description && <p className="text-sm text-text-muted">{description}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {searchable && (
            <input
              type="search"
              aria-label={t('resource.search', { what: title })}
              placeholder={t('resource.searchPlaceholder')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="h-9 w-48 rounded-[var(--radius-control)] border border-border-strong px-3 text-sm"
            />
          )}
          {canWrite && editing === null && (
            <Button size="sm" onClick={() => open(null)}>
              <Plus aria-hidden="true" className="size-4" />
              {t('resource.add')}
            </Button>
          )}
        </div>
      </div>

      {(notice || error) && (
        <div className="px-5 pt-4">
          {notice && <Alert tone="success">{notice}</Alert>}
          {error && <Alert tone="error">{error}</Alert>}
        </div>
      )}

      {editing !== null && (
        <form
          onSubmit={submit}
          noValidate
          className="grid gap-4 border-b border-border bg-bg/60 px-5 py-4 sm:grid-cols-2"
        >
          {fields.map((f) =>
            f.type === 'select' || f.type === 'timezone' ? (
              <SelectField
                key={f.name}
                label={f.label}
                value={form[f.name] ?? ''}
                error={fieldErrors[f.name]}
                onChange={(e) => setForm({ ...form, [f.name]: e.target.value })}
              >
                {f.optional && <option value="">{t('resource.none')}</option>}
                {!f.optional && form[f.name] === '' && <option value="">{t('resource.choose')}</option>}
                {(f.type === 'timezone'
                  ? timezones.map((z) => ({ value: z, label: z }))
                  : (f.options ?? [])
                ).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </SelectField>
            ) : f.type === 'checkbox' ? (
              <label key={f.name} className="flex items-center gap-2 self-end pb-2 text-sm">
                <input
                  type="checkbox"
                  checked={Boolean(form[f.name])}
                  onChange={(e) => setForm({ ...form, [f.name]: e.target.checked })}
                  className="size-4"
                />
                {f.label}
              </label>
            ) : (
              <Field
                key={f.name}
                label={f.label}
                type={['number', 'date', 'time'].includes(f.type) ? f.type : 'text'}
                value={form[f.name] ?? ''}
                hint={f.hint}
                error={fieldErrors[f.name]}
                onChange={(e) => setForm({ ...form, [f.name]: e.target.value })}
              />
            ),
          )}
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" disabled={save.isPending}>
              {editing === 'new' ? t('resource.create') : t('resource.save')}
            </Button>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      )}

      {list.isPending && (
        <p role="status" className="px-5 py-6 text-sm text-text-muted">
          {t('common.loading')}
        </p>
      )}
      {list.isError && (
        <div className="p-5">
          <Alert tone="error">{errorMessage(list.error, t)}</Alert>
        </div>
      )}
      {list.isSuccess && rows.length === 0 && (
        <p className="px-5 py-6 text-sm text-text-muted">{q ? t('resource.noMatches') : emptyText}</p>
      )}
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="bg-bg text-start text-xs font-semibold text-text-muted">
                {columns.map((c) => (
                  <th key={c.key} scope="col" className="px-5 py-2.5 text-start">
                    {c.label}
                  </th>
                ))}
                <th scope="col" className="px-5 py-2.5 text-end">
                  <span className="sr-only">{t('resource.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-slate-100">
                  {columns.map((c) => (
                    <td key={c.key} className="px-5 py-3">
                      {c.render ? c.render(row) : row[c.key]}
                    </td>
                  ))}
                  <td className="px-5 py-2 text-end whitespace-nowrap">
                    {rowActions?.(row)}
                    {canWrite && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={t('resource.edit', { name: row.name ?? row.title ?? '' })}
                          onClick={() => open(row)}
                        >
                          <Pencil aria-hidden="true" className="size-4" />
                        </Button>
                        {confirmDelete === row.id ? (
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => remove.mutate(row.id)}
                            disabled={remove.isPending}
                          >
                            {t('resource.confirmDelete')}
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={t('resource.delete', { name: row.name ?? row.title ?? '' })}
                            onClick={() => setConfirmDelete(row.id)}
                          >
                            <Trash2 aria-hidden="true" className="size-4" />
                          </Button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
