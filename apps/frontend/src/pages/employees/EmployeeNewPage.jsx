import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { employeesApi, fullName } from '@/services/employees';
import { orgApi } from '@/services/org';
import { Button } from '@/components/ui/button';
import { Field, SelectField } from '@/components/ui/field';
import { Alert } from '@/components/ui/alert';
import { ApiError } from '@/services/api';
import { errorMessage } from '@/utils/errors';

/** One org list (departments, branches …) for a select box. @param {string} path */
export function useOrgList(path) {
  return useQuery({ queryKey: ['org', path], queryFn: () => orgApi.list(path) });
}

const blank = {
  firstName: '',
  lastName: '',
  workEmail: '',
  phone: '',
  employeeCode: '',
  dateOfJoining: new Date().toISOString().slice(0, 10),
  probationEndDate: '',
  legalEntityId: '',
  departmentId: '',
  designationId: '',
  branchId: '',
  managerId: '',
  workMode: 'OFFICE',
  employmentType: 'FULL_TIME',
};

export function EmployeeNewPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [form, setForm] = useState(blank);
  const [errors, setErrors] = useState({});
  const entities = useOrgList('legal-entities');
  const departments = useOrgList('departments');
  const designations = useOrgList('designations');
  const branches = useOrgList('branches');
  const managers = useQuery({
    queryKey: ['employees', 'managers'],
    queryFn: () => employeesApi.list({ limit: 200 }),
  });
  useEffect(() => {
    if (!form.legalEntityId && entities.data?.data[0])
      setForm((f) => ({ ...f, legalEntityId: entities.data.data[0].id }));
  }, [entities.data, form.legalEntityId]);
  const create = useMutation({
    mutationFn: () =>
      employeesApi.create(
        Object.fromEntries(
          Object.entries(form).map(([k, v]) => [k, v === '' ? (k === 'firstName' ? '' : null) : v]),
        ),
      ),
    onSuccess: (e) => navigate(`/employees/${e.id}`, { state: { created: true } }),
    onError: (err) =>
      setErrors(
        err instanceof ApiError && err.errors.length ? err.fieldErrors() : { _: errorMessage(err, t) },
      ),
  });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const options = (qr, label) =>
    (qr.data?.data ?? []).map((x) => (
      <option key={x.id} value={x.id}>
        {label(x)}
      </option>
    ));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl font-bold">{t('employees.add')}</h1>
      <form
        noValidate
        className="grid gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-5 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          setErrors({});
          create.mutate();
        }}
      >
        {errors._ && (
          <Alert tone="error" className="sm:col-span-2">
            {errors._}
          </Alert>
        )}
        <Field
          label={t('employees.f.firstName')}
          value={form.firstName}
          error={errors.firstName}
          onChange={set('firstName')}
        />
        <Field
          label={t('employees.f.lastName')}
          value={form.lastName}
          error={errors.lastName}
          onChange={set('lastName')}
        />
        <Field
          label={t('employees.f.workEmail')}
          type="email"
          value={form.workEmail}
          error={errors.workEmail}
          onChange={set('workEmail')}
        />
        <Field
          label={t('employees.f.phone')}
          value={form.phone}
          error={errors.phone}
          onChange={set('phone')}
        />
        <Field
          label={t('employees.f.joining')}
          type="date"
          value={form.dateOfJoining}
          error={errors.dateOfJoining}
          onChange={set('dateOfJoining')}
        />
        <Field
          label={t('employees.f.probation')}
          type="date"
          value={form.probationEndDate}
          error={errors.probationEndDate}
          onChange={set('probationEndDate')}
        />
        <Field
          label={t('employees.f.code')}
          hint={t('employees.f.codeHint')}
          value={form.employeeCode}
          error={errors.employeeCode}
          onChange={set('employeeCode')}
        />
        <SelectField
          label={t('employees.f.legalEntity')}
          value={form.legalEntityId}
          error={errors.legalEntityId}
          onChange={set('legalEntityId')}
        >
          {options(entities, (x) => x.name)}
        </SelectField>
        <SelectField
          label={t('employees.f.department')}
          value={form.departmentId}
          error={errors.departmentId}
          onChange={set('departmentId')}
        >
          <option value="">{t('resource.none')}</option>
          {options(departments, (x) => `${x.name} · ${x.code}`)}
        </SelectField>
        <SelectField
          label={t('employees.f.designation')}
          value={form.designationId}
          error={errors.designationId}
          onChange={set('designationId')}
        >
          <option value="">{t('resource.none')}</option>
          {options(designations, (x) => x.title)}
        </SelectField>
        <SelectField
          label={t('employees.f.branch')}
          value={form.branchId}
          error={errors.branchId}
          onChange={set('branchId')}
        >
          <option value="">{t('resource.none')}</option>
          {options(branches, (x) => `${x.name} · ${x.code}`)}
        </SelectField>
        <SelectField
          label={t('employees.f.manager')}
          value={form.managerId}
          error={errors.managerId}
          onChange={set('managerId')}
        >
          <option value="">{t('employees.job.noManager')}</option>
          {options(managers, (x) => `${fullName(x)} · ${x.employeeCode}`)}
        </SelectField>
        <SelectField label={t('employees.f.workMode')} value={form.workMode} onChange={set('workMode')}>
          {['OFFICE', 'HYBRID', 'REMOTE'].map((v) => (
            <option key={v} value={v}>
              {t(`employees.workMode.${v}`)}
            </option>
          ))}
        </SelectField>
        <SelectField
          label={t('employees.f.employmentType')}
          value={form.employmentType}
          onChange={set('employmentType')}
        >
          {['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN'].map((v) => (
            <option key={v} value={v}>
              {t(`employees.employmentType.${v}`)}
            </option>
          ))}
        </SelectField>
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" disabled={create.isPending}>
            {t('employees.create')}
          </Button>
          <Button variant="ghost" onClick={() => navigate('/employees')}>
            {t('employees.cancel')}
          </Button>
        </div>
      </form>
    </div>
  );
}
