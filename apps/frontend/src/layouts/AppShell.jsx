import { Link, NavLink, Outlet } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  BarChart3,
  Building2,
  CalendarClock,
  CalendarDays,
  Plane,
  Laptop,
  ListTodo,
  NotebookPen,
  Sheet,
  PieChart,
  Camera,
  ScanEye,
  Radio,
  SlidersHorizontal,
  Receipt,
  Wallet,
  CheckSquare,
  Clock,
  Contact,
  UsersRound,
  KeyRound,
  LogOut,
  Network,
  Shield,
  UserRound,
  Users,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/services/api';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { cn } from '@/utils/cn';
import { useWorkSession } from '@/hooks/useWorkSession';

/** Sidebar + content layout. The sidebar stacks above the content on narrow screens (no fixed widths). */
export function AppShell() {
  const { t } = useTranslation();
  const { me, signOut, signedIn, can, scopeOf } = useAuth();
  const viewScope = scopeOf('attendance.view');
  const seesOthers = Boolean(viewScope && viewScope !== 'OWN');
  const leaveScope = scopeOf('leave.request.view');
  const seesTeamLeave = Boolean(leaveScope && leaveScope !== 'OWN');
  const qc = useQueryClient();
  const memberships = useQuery({
    queryKey: ['auth', 'memberships'],
    queryFn: () => apiFetch('/api/v1/auth/memberships'),
  });
  const switchTo = async (tenantId) => {
    const res = await apiFetch('/api/v1/auth/switch-tenant', { method: 'POST', json: { tenantId } });
    qc.clear();
    await signedIn(res.accessToken);
  };
  const link = ({ isActive }) =>
    cn(
      'flex items-center gap-2 rounded-[var(--radius-control)] px-3 py-2.5 text-sm',
      isActive ? 'bg-primary-soft font-semibold text-primary-hover' : 'text-slate-700 hover:bg-bg',
    );
  const needsMfa = me?.mfa.requiredForRole && !me?.mfa.enabled;
  // Owns the work-session heartbeat for the whole app (only while a session runs).
  const work = useWorkSession();
  const working = work.data?.active ?? null;
  return (
    <div className="flex min-h-screen flex-wrap bg-bg">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-10 focus:rounded focus:bg-surface focus:px-3 focus:py-2"
      >
        {t('app.skipToContent')}
      </a>
      <nav
        aria-label={t('nav.main')}
        className="flex max-w-full flex-[1_1_248px] flex-col gap-1 border-e border-border bg-surface px-4 py-5 lg:max-w-[248px]"
      >
        <div className="flex items-center gap-2.5 px-2 pb-1">
          <span
            aria-hidden="true"
            className="flex size-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-white"
          >
            W
          </span>
          <span className="text-[15px] font-semibold">{t('app.name')}</span>
        </div>
        {(memberships.data?.data.length ?? 0) > 1 ? (
          <label className="px-2 pb-4 text-xs text-text-muted">
            <span className="sr-only">{t('nav.switchCompany')}</span>
            <select
              value={me?.tenant.id}
              onChange={(e) => switchTo(e.target.value)}
              className="mt-1 h-9 w-full rounded-[var(--radius-control)] border border-border-strong bg-surface px-2 text-sm text-text"
            >
              {memberships.data.data.map((m) => (
                <option key={m.tenantId} value={m.tenantId}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="px-2 pb-4 text-xs text-text-muted">{me?.tenant.name}</p>
        )}
        {working && (
          <Link
            to="/work"
            className="mx-2 mb-3 flex items-center gap-2 rounded-[var(--radius-control)] bg-success-soft px-3 py-2 text-xs font-medium text-emerald-900"
          >
            <Radio aria-hidden="true" className="size-3.5" />
            {working.status === 'ON_BREAK' ? t('nav.workOnBreak') : t('nav.workSignal')}
          </Link>
        )}
        <NavLink to="/" end className={link}>
          <Activity aria-hidden="true" className="size-4" />
          {t('nav.systemStatus')}
        </NavLink>
        <span className="px-3 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-text-muted">
          {t('nav.people')}
        </span>
        <NavLink to="/me" className={link}>
          <UserRound aria-hidden="true" className="size-4" />
          {t('nav.myProfile')}
        </NavLink>
        <NavLink to="/employees" className={link}>
          <Contact aria-hidden="true" className="size-4" />
          {t('nav.employees')}
        </NavLink>
        <span className="px-3 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-text-muted">
          {t('nav.attendance')}
        </span>
        <NavLink to="/attendance" end className={link}>
          <Clock aria-hidden="true" className="size-4" />
          {t('nav.myAttendance')}
        </NavLink>
        {seesOthers && (
          <NavLink to="/attendance/team" className={link}>
            <UsersRound aria-hidden="true" className="size-4" />
            {t('nav.teamAttendance')}
          </NavLink>
        )}
        {/* Everyone: direct managers get their reports' requests whatever their role. */}
        <NavLink to="/attendance/approvals" className={link}>
          <CheckSquare aria-hidden="true" className="size-4" />
          {t('nav.approvals')}
        </NavLink>
        {seesOthers && (
          <NavLink to="/attendance/reports" className={link}>
            <BarChart3 aria-hidden="true" className="size-4" />
            {t('nav.attendanceReports')}
          </NavLink>
        )}
        <span className="px-3 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-text-muted">
          {t('nav.work')}
        </span>
        <NavLink to="/work" end className={link}>
          <Laptop aria-hidden="true" className="size-4" />
          {t('nav.myWork')}
        </NavLink>
        <NavLink to="/work/tasks" className={link}>
          <ListTodo aria-hidden="true" className="size-4" />
          {t('nav.tasks')}
        </NavLink>
        <NavLink to="/work/report" className={link}>
          <NotebookPen aria-hidden="true" className="size-4" />
          {t('nav.dailyReport')}
        </NavLink>
        <NavLink to="/work/timesheet" className={link}>
          <Sheet aria-hidden="true" className="size-4" />
          {t('nav.timesheet')}
        </NavLink>
        {can('view_team_work_status') && (
          <NavLink to="/work/team" className={link}>
            <UsersRound aria-hidden="true" className="size-4" />
            {t('nav.teamWork')}
          </NavLink>
        )}
        {can('view_team_screenshots') && (
          <NavLink to="/work/screenshot-review" className={link}>
            <ScanEye aria-hidden="true" className="size-4" />
            {t('nav.screenshotReview')}
          </NavLink>
        )}
        {can('reports.view') && (
          <NavLink to="/dashboards/remote-work" className={link}>
            <PieChart aria-hidden="true" className="size-4" />
            {t('nav.remoteWork')}
          </NavLink>
        )}
        <span className="px-3 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-text-muted">
          {t('nav.leave')}
        </span>
        <NavLink to="/leave" end className={link}>
          <Plane aria-hidden="true" className="size-4" />
          {t('nav.myLeave')}
        </NavLink>
        {seesTeamLeave && (
          <NavLink to="/leave/calendar" className={link}>
            <CalendarDays aria-hidden="true" className="size-4" />
            {t('nav.whosAway')}
          </NavLink>
        )}
        {seesTeamLeave && (
          <NavLink to="/leave/reports" className={link}>
            <BarChart3 aria-hidden="true" className="size-4" />
            {t('nav.leaveReports')}
          </NavLink>
        )}
        <span className="px-3 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-text-muted">
          {t('nav.payroll')}
        </span>
        <NavLink to="/payslips" className={link}>
          <Receipt aria-hidden="true" className="size-4" />
          {t('nav.payslips')}
        </NavLink>
        {(can('payroll.run.create') ||
          can('payroll.run.review') ||
          can('payroll.run.approve') ||
          can('payroll.tax.review')) && (
          <NavLink to="/payroll" className={link}>
            <Wallet aria-hidden="true" className="size-4" />
            {t('nav.payrollRuns')}
          </NavLink>
        )}
        <span className="px-3 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-text-muted">
          {t('nav.settings')}
        </span>
        <NavLink to="/settings/company" className={link}>
          <Building2 aria-hidden="true" className="size-4" />
          {t('nav.company')}
        </NavLink>
        <NavLink to="/settings/organization" className={link}>
          <Network aria-hidden="true" className="size-4" />
          {t('nav.organization')}
        </NavLink>
        {(can('attendance.manage') || can('company.org.manage')) && (
          <NavLink to="/settings/attendance" className={link}>
            <CalendarClock aria-hidden="true" className="size-4" />
            {t('nav.attendanceSettings')}
          </NavLink>
        )}
        {can('manage_monitoring_policy') && (
          <NavLink to="/settings/monitoring" className={link}>
            <Camera aria-hidden="true" className="size-4" />
            {t('nav.monitoringSettings')}
          </NavLink>
        )}
        {can('work.config.manage') && (
          <NavLink to="/settings/work" className={link}>
            <SlidersHorizontal aria-hidden="true" className="size-4" />
            {t('nav.workSettings')}
          </NavLink>
        )}
        {(can('leave.config.manage') || can('leave.balance.adjust')) && (
          <NavLink to="/settings/leave" className={link}>
            <Plane aria-hidden="true" className="size-4" />
            {t('nav.leaveSettings')}
          </NavLink>
        )}
        {can('payroll.config.manage') && (
          <NavLink to="/settings/payroll" className={link}>
            <Wallet aria-hidden="true" className="size-4" />
            {t('nav.payrollSettings')}
          </NavLink>
        )}
        {can('members.invite') && (
          <NavLink to="/settings/members" className={link}>
            <Users aria-hidden="true" className="size-4" />
            {t('nav.members')}
          </NavLink>
        )}
        {can('members.invite') && (
          <NavLink to="/settings/roles" className={link}>
            <KeyRound aria-hidden="true" className="size-4" />
            {t('nav.roles')}
          </NavLink>
        )}
        <NavLink to="/settings/security" className={link}>
          <Shield aria-hidden="true" className="size-4" />
          {t('nav.security')}
        </NavLink>
        <div className="mt-auto flex flex-col gap-2 border-t border-border pt-4">
          <div className="px-2 text-sm">
            <div className="font-medium">{me?.user.displayName}</div>
            <div className="truncate text-xs text-text-muted">{me?.user.email}</div>
          </div>
          <Button variant="ghost" size="sm" className="justify-start" onClick={signOut}>
            <LogOut aria-hidden="true" className="size-4" />
            {t('nav.signOut')}
          </Button>
        </div>
      </nav>
      <main id="main" className="min-w-0 flex-[999_1_560px] px-4 py-8 sm:px-6">
        <div className="mx-auto flex max-w-5xl flex-col gap-6">
          {needsMfa && (
            <div
              role="status"
              className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-amber-200 bg-warning-soft px-4 py-3 text-sm text-amber-900"
            >
              <span>{t('mfaBanner.text')}</span>
              <Button asChild size="sm" variant="secondary">
                <Link to="/settings/security">{t('mfaBanner.action')}</Link>
              </Button>
            </div>
          )}
          <Outlet />
        </div>
      </main>
    </div>
  );
}
