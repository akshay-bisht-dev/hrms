import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CalendarDays } from 'lucide-react';
import { orgApi, toMinutes, fromMinutes, toDayList } from '@/services/org';
import { useAuth } from '@/context/AuthContext';
import { ResourceSection } from '@/components/resource/ResourceSection';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { ApiError } from '@/services/api';
import { errorMessage } from '@/utils/errors';
import { cn } from '@/utils/cn';

const TABS = ['branches', 'departments', 'designations', 'teams', 'schedules', 'holidays'];

/** Options for a select field from another org list. */
function useOptions(path, label = (r) => r.name) {
  const q = useQuery({ queryKey: ['org', path], queryFn: () => orgApi.list(path) });
  return (q.data?.data ?? []).map((r) => ({ value: r.id, label: label(r) }));
}

function Holidays({ calendar, canWrite, onClose }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const key = ['org', 'holidays', calendar.id];
  const list = useQuery({ queryKey: key, queryFn: () => orgApi.holidays(calendar.id) });
  const [form, setForm] = useState({ date: '', name: '', isOptional: false });
  const [errors, setErrors] = useState({});
  const add = useMutation({
    mutationFn: () => orgApi.addHoliday(calendar.id, form),
    onSuccess: () => {
      setForm({ date: '', name: '', isOptional: false });
      setErrors({});
      qc.invalidateQueries({ queryKey: key });
    },
    onError: (err) =>
      setErrors(
        err instanceof ApiError && err.errors.length ? err.fieldErrors() : { _: errorMessage(err, t) },
      ),
  });
  const remove = useMutation({
    mutationFn: (id) => orgApi.removeHoliday(calendar.id, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
  return (
    <section
      aria-label={t('org.calendar.holidays', { name: calendar.name })}
      className="rounded-[var(--radius-card)] border border-border bg-surface p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{t('org.calendar.holidays', { name: calendar.name })}</h2>
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t('common.close')}
        </Button>
      </div>
      {list.isSuccess && list.data.data.length === 0 && (
        <p className="mt-3 text-sm text-text-muted">{t('org.calendar.noHolidays')}</p>
      )}
      <ul className="mt-3 divide-y divide-slate-100">
        {(list.data?.data ?? []).map((hd) => (
          <li key={hd.id} className="flex items-center justify-between gap-3 py-2 text-sm">
            <span>
              <span className="tabular me-3 text-text-muted">{hd.date}</span>
              {hd.name} {hd.isOptional && <Badge tone="neutral">{t('org.calendar.optional')}</Badge>}
            </span>
            {canWrite && (
              <Button variant="ghost" size="sm" onClick={() => remove.mutate(hd.id)}>
                {t('members.remove')}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {canWrite && (
        <form
          className="mt-4 grid gap-3 sm:grid-cols-[160px_1fr_auto_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          {errors._ && (
            <Alert tone="error" className="sm:col-span-4">
              {errors._}
            </Alert>
          )}
          <Field
            label={t('org.calendar.date')}
            type="date"
            value={form.date}
            error={errors.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
          />
          <Field
            label={t('org.calendar.holidayName')}
            value={form.name}
            error={errors.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <label className="flex items-center gap-2 pb-3 text-sm">
            <input
              type="checkbox"
              checked={form.isOptional}
              onChange={(e) => setForm({ ...form, isOptional: e.target.checked })}
              className="size-4"
            />
            {t('org.calendar.optional')}
          </label>
          <Button type="submit" disabled={add.isPending}>
            {t('resource.add')}
          </Button>
        </form>
      )}
    </section>
  );
}

export function OrganizationPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const canWrite = can('company.org.manage');
  const [tab, setTab] = useState('branches');
  const [calendar, setCalendar] = useState(null);
  const legalEntities = useOptions('legal-entities');
  const calendars = useOptions('holiday-calendars', (r) => `${r.name} (${r.year})`);
  const departments = useOptions('departments', (r) => `${r.name} · ${r.code}`);
  const weekdays = (days) => days.map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(' ');

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-bold">{t('org.title')}</h1>
        <p className="mt-1 text-sm text-text-muted">{t('org.subtitle')}</p>
      </header>
      <div role="tablist" aria-label={t('org.title')} className="flex flex-wrap gap-1 border-b border-border">
        {TABS.map((k) => (
          <button
            key={k}
            role="tab"
            type="button"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm',
              tab === k
                ? 'border-primary font-semibold text-primary-hover'
                : 'border-transparent text-text-muted hover:text-text',
            )}
          >
            {t(`org.tabs.${k}`)}
          </button>
        ))}
      </div>

      {tab === 'branches' && (
        <ResourceSection
          title={t('org.tabs.branches')}
          endpoint="/api/v1/companies/branches"
          queryKey={['org', 'branches']}
          canWrite={canWrite}
          emptyText={t('org.branch.empty')}
          columns={[
            { key: 'name', label: t('org.branch.name') },
            { key: 'code', label: t('org.branch.code') },
            { key: 'city', label: t('org.branch.city'), render: (r) => r.address?.city ?? '—' },
            { key: 'timezone', label: t('org.branch.timezone') },
          ]}
          fields={[
            { name: 'name', label: t('org.branch.name') },
            { name: 'code', label: t('org.branch.code') },
            {
              name: 'legalEntityId',
              label: t('org.branch.legalEntity'),
              type: 'select',
              options: legalEntities,
            },
            {
              name: 'holidayCalendarId',
              label: t('org.branch.calendar'),
              type: 'select',
              options: calendars,
              optional: true,
            },
            { name: 'city', label: t('org.branch.city'), optional: true },
            { name: 'timezone', label: t('org.branch.timezone'), type: 'timezone' },
          ]}
          fromRow={(r) => ({
            ...r,
            city: r.address?.city ?? '',
            holidayCalendarId: r.holidayCalendarId ?? '',
          })}
          toBody={({ city, ...f }) => ({ ...f, address: city ? { city } : null })}
        />
      )}
      {tab === 'departments' && (
        <ResourceSection
          title={t('org.tabs.departments')}
          endpoint="/api/v1/companies/departments"
          queryKey={['org', 'departments']}
          canWrite={canWrite}
          emptyText={t('org.department.empty')}
          columns={[
            { key: 'name', label: t('org.department.name') },
            { key: 'code', label: t('org.department.code') },
            {
              key: 'parentId',
              label: t('org.department.parent'),
              render: (r) => departments.find((d) => d.value === r.parentId)?.label ?? '—',
            },
          ]}
          fields={[
            { name: 'name', label: t('org.department.name') },
            { name: 'code', label: t('org.department.code') },
            {
              name: 'parentId',
              label: t('org.department.parent'),
              type: 'select',
              options: departments,
              optional: true,
            },
          ]}
          fromRow={(r) => ({ ...r, parentId: r.parentId ?? '' })}
        />
      )}
      {tab === 'designations' && (
        <ResourceSection
          title={t('org.tabs.designations')}
          endpoint="/api/v1/companies/designations"
          queryKey={['org', 'designations']}
          canWrite={canWrite}
          emptyText={t('org.designation.empty')}
          columns={[
            { key: 'title', label: t('org.designation.title') },
            { key: 'level', label: t('org.designation.level'), render: (r) => r.level ?? '—' },
          ]}
          fields={[
            { name: 'title', label: t('org.designation.title') },
            { name: 'level', label: t('org.designation.level'), type: 'number' },
          ]}
        />
      )}
      {tab === 'teams' && (
        <ResourceSection
          title={t('org.tabs.teams')}
          endpoint="/api/v1/companies/teams"
          queryKey={['org', 'teams']}
          canWrite={canWrite}
          emptyText={t('org.team.empty')}
          columns={[
            { key: 'name', label: t('org.team.name') },
            {
              key: 'departmentId',
              label: t('org.team.department'),
              render: (r) => departments.find((d) => d.value === r.departmentId)?.label ?? '—',
            },
          ]}
          fields={[
            { name: 'name', label: t('org.team.name') },
            {
              name: 'departmentId',
              label: t('org.team.department'),
              type: 'select',
              options: departments,
              optional: true,
            },
          ]}
          fromRow={(r) => ({ ...r, departmentId: r.departmentId ?? '' })}
        />
      )}
      {tab === 'schedules' && (
        <ResourceSection
          title={t('org.tabs.schedules')}
          endpoint="/api/v1/companies/work-schedules"
          queryKey={['org', 'work-schedules']}
          canWrite={canWrite}
          emptyText={t('org.schedule.empty')}
          columns={[
            { key: 'name', label: t('org.schedule.name') },
            {
              key: 'type',
              label: t('org.schedule.type'),
              render: (r) => t(`org.schedule.${r.type.toLowerCase()}`),
            },
            {
              key: 'days',
              label: t('org.schedule.days'),
              render: (r) => weekdays(r.weeklyPattern.filter((d) => d.working).map((d) => d.day)),
            },
            {
              key: 'hours',
              label: t('org.schedule.daily'),
              render: (r) => {
                const d = r.weeklyPattern.find((x) => x.working && x.startMin !== undefined);
                return d
                  ? t('org.schedule.hours', { start: fromMinutes(d.startMin), end: fromMinutes(d.endMin) })
                  : `${r.dailyMinutes / 60} h`;
              },
            },
          ]}
          fields={[
            { name: 'name', label: t('org.schedule.name') },
            {
              name: 'type',
              label: t('org.schedule.type'),
              type: 'select',
              options: ['FIXED', 'FLEXIBLE', 'SHIFT'].map((v) => ({
                value: v,
                label: t(`org.schedule.${v.toLowerCase()}`),
              })),
            },
            { name: 'days', label: t('org.schedule.days') },
            { name: 'start', label: t('org.schedule.start') },
            { name: 'end', label: t('org.schedule.end') },
            { name: 'graceMinutes', label: t('org.schedule.grace'), type: 'number' },
          ]}
          fromRow={(r) => {
            const d = r.weeklyPattern.find((x) => x.working && x.startMin !== undefined);
            return {
              ...r,
              days: r.weeklyPattern
                .filter((x) => x.working)
                .map((x) => x.day)
                .join(','),
              start: d ? fromMinutes(d.startMin) : '',
              end: d ? fromMinutes(d.endMin) : '',
            };
          }}
          toBody={({ days, start, end, ...f }) => {
            const working = new Set(toDayList(days));
            const s = toMinutes(start);
            const e = toMinutes(end);
            const hasTimes = Number.isFinite(s) && Number.isFinite(e);
            return {
              ...f,
              graceMinutes: f.graceMinutes ?? 0,
              dailyMinutes: hasTimes && e > s ? e - s : 480,
              weeklyPattern: Array.from({ length: 7 }, (_, day) => ({
                day,
                working: working.has(day),
                ...(working.has(day) && hasTimes ? { startMin: s, endMin: e } : {}),
              })),
            };
          }}
        />
      )}
      {tab === 'holidays' && (
        <>
          <ResourceSection
            title={t('org.tabs.holidays')}
            endpoint="/api/v1/companies/holiday-calendars"
            queryKey={['org', 'holiday-calendars']}
            canWrite={canWrite}
            emptyText={t('org.calendar.empty')}
            columns={[
              { key: 'name', label: t('org.calendar.name') },
              { key: 'countryCode', label: t('org.calendar.country') },
              { key: 'year', label: t('org.calendar.year') },
            ]}
            fields={[
              { name: 'name', label: t('org.calendar.name') },
              { name: 'countryCode', label: t('org.calendar.country') },
              { name: 'year', label: t('org.calendar.year'), type: 'number' },
            ]}
            rowActions={(r) => (
              <Button variant="ghost" size="sm" onClick={() => setCalendar(r)}>
                <CalendarDays aria-hidden="true" className="size-4" />
                {t('org.calendar.manage')}
              </Button>
            )}
          />
          {calendar && <Holidays calendar={calendar} canWrite={canWrite} onClose={() => setCalendar(null)} />}
        </>
      )}
    </div>
  );
}
