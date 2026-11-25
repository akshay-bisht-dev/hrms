// Integration: invitations, roles, member status changes and company switching.
import { startHarness, PASSWORD } from './helpers/harness.js';

let h;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.stop());

const roleId = async (c, key) =>
  (await c.call('get', '/tenants/roles').expect(200)).body.data.find((r) => r.systemKey === key).id;

describe('invitations', () => {
  test('a new person accepts with name + password, then signs in to the company', async () => {
    const owner = await h.owner('inv', { mfa: true });
    const email = h.uniqueEmail('newbie');
    await owner
      .call('post', '/tenants/invitations')
      .send({ email, roleIds: [await roleId(owner, 'employee')] })
      .expect(201);
    const mail = h.lastEmail(email, 'invitation');
    expect(mail.data.company).toMatch(/^Co inv/);
    const token = h.tokenFrom(mail.data.url);

    const c = h.client();
    const info = (await c.call('post', '/auth/invite-info').send({ token }).expect(200)).body;
    expect(info).toEqual({ companyName: expect.stringMatching(/^Co inv/), email, needsPassword: true });
    expect((await c.call('post', '/auth/accept-invite').send({ token })).status).toBe(422); // name + password needed
    await c
      .call('post', '/auth/accept-invite')
      .send({ token, fullName: 'Neha Kapoor', password: PASSWORD })
      .expect(200);
    expect(
      (await c.call('post', '/auth/accept-invite').send({ token, fullName: 'X', password: PASSWORD })).body
        .code,
    ).toBe('invalid_invite'); // single use

    await c.login(email);
    const me = (await c.call('get', '/auth/me').expect(200)).body;
    expect(me).toMatchObject({
      user: { displayName: 'Neha Kapoor', emailVerified: true },
      roles: ['Employee'],
    });
    const list = (await owner.call('get', '/tenants/members').expect(200)).body.data;
    expect(list.find((m) => m.email === email)).toMatchObject({
      status: 'ACTIVE',
      roles: [expect.objectContaining({ systemKey: 'employee' })],
    });
  });

  test('pending invitations can be cancelled, and the old link stops working', async () => {
    const owner = await h.owner('cancel', { mfa: true });
    const email = h.uniqueEmail('cancelled');
    const { id } = (
      await owner
        .call('post', '/tenants/invitations')
        .send({ email, roleIds: [await roleId(owner, 'employee')] })
        .expect(201)
    ).body;
    const token = h.tokenFrom(h.lastEmail(email, 'invitation').data.url);
    await owner.call('delete', `/tenants/invitations/${id}`).expect(204);
    expect((await h.client().call('post', '/auth/invite-info').send({ token })).body.code).toBe(
      'invalid_invite',
    );
  });

  test('inviting an existing member is a 409; tampered invite tokens are rejected', async () => {
    const owner = await h.owner('dupe', { mfa: true });
    const res = await owner
      .call('post', '/tenants/invitations')
      .send({ email: owner.email, roleIds: [await roleId(owner, 'employee')] });
    expect(res.body.code).toBe('already_member');
    expect(
      (
        await h
          .client()
          .call('post', '/auth/invite-info')
          .send({ token: 'x'.repeat(40) })
      ).body.code,
    ).toBe('invalid_invite');
  });

  test('giving a sensitive role needs roles.manage on an MFA-verified session, and all admins are emailed', async () => {
    const noMfa = await h.owner('nomfa');
    const r1 = await noMfa
      .call('post', '/tenants/invitations')
      .send({ email: h.uniqueEmail('p'), roleIds: [await roleId(noMfa, 'payroll_manager')] });
    expect(r1.body.code).toBe('mfa_required');

    const owner = await h.owner('sens', { mfa: true });
    const hr = await h.member(owner, ['hr_manager'], 'hrm'); // HR Manager can invite (members.invite) but not grant sensitive roles
    const r2 = await hr
      .call('post', '/tenants/invitations')
      .send({ email: h.uniqueEmail('p'), roleIds: [await roleId(hr, 'payroll_manager')] });
    expect(r2.body.code).toBe('sensitive_role');
    await hr
      .call('post', '/tenants/invitations')
      .send({ email: h.uniqueEmail('e'), roleIds: [await roleId(hr, 'employee')] })
      .expect(201);

    const payrollEmail = h.uniqueEmail('payroll');
    await owner
      .call('post', '/tenants/invitations')
      .send({ email: payrollEmail, roleIds: [await roleId(owner, 'payroll_manager')] })
      .expect(201);
    const alert = h.lastEmail(owner.email, 'sensitive-access-granted');
    expect(alert.data.person).toBe(payrollEmail);
  });

  test('an existing user from another company accepts without a password and can switch companies', async () => {
    const ownerA = await h.owner('swa', { mfa: true });
    const ownerB = await h.owner('swb', { mfa: true });
    await ownerB
      .call('post', '/tenants/invitations')
      .send({ email: ownerA.email, roleIds: [await roleId(ownerB, 'employee')] })
      .expect(201);
    const token = h.tokenFrom(h.lastEmail(ownerA.email, 'invitation').data.url);
    expect(
      (await h.client().call('post', '/auth/invite-info').send({ token }).expect(200)).body.needsPassword,
    ).toBe(false);
    await h.client().call('post', '/auth/accept-invite').send({ token }).expect(200);

    const memberships = (await ownerA.call('get', '/auth/memberships').expect(200)).body.data;
    expect(memberships).toHaveLength(2);
    expect(memberships.find((m) => m.current).tenantId).toBe(ownerA.tenantId);

    const oldToken = ownerA.token;
    const switched = ownerA.keep(
      await ownerA.call('post', '/auth/switch-tenant').send({ tenantId: ownerB.tenantId }).expect(200),
    );
    ownerA.token = switched.body.accessToken;
    const me = (await ownerA.call('get', '/auth/me').expect(200)).body;
    expect(me.tenant.id).toBe(ownerB.tenantId);
    expect(me.roles).toEqual(['Employee']);
    expect(me.mfa.sessionVerified).toBe(true); // MFA state carries over
    const old = h.client();
    old.token = oldToken;
    expect((await old.call('get', '/auth/me')).body.code).toBe('session_revoked');

    // Cannot switch into a company you don't belong to.
    const stranger = await h.owner('stranger');
    expect(
      (await ownerA.call('post', '/auth/switch-tenant').send({ tenantId: stranger.tenantId })).status,
    ).toBe(404);
  });
});

describe('member management guard rails', () => {
  test('nobody changes their own roles or status', async () => {
    const owner = await h.owner('guard', { mfa: true });
    const ownerMid = (await owner.call('get', '/tenants/members').expect(200)).body.data[0].id;
    expect(
      (
        await owner
          .call('put', `/tenants/members/${ownerMid}/roles`)
          .send({ roleIds: [await roleId(owner, 'employee')] })
      ).body.code,
    ).toBe('self_change');
    expect((await owner.call('post', `/tenants/members/${ownerMid}/suspend`)).body.code).toBe('self_change');
    expect((await owner.call('delete', `/tenants/members/${ownerMid}`)).body.code).toBe('self_change');
  });

  test('the last active Company Admin cannot be demoted, suspended or removed', async () => {
    const owner = await h.owner('lastadmin', { mfa: true });
    const ownerMid = (await owner.call('get', '/tenants/members').expect(200)).body.data[0].id;
    // An access manager (custom role with roles.manage) who is not a Company Admin.
    const amRole = (
      await owner
        .call('post', '/tenants/roles')
        .send({
          name: 'Access Manager',
          grants: [
            { permissionCode: 'roles.manage', scope: 'COMPANY' },
            { permissionCode: 'members.invite', scope: 'COMPANY' },
          ],
        })
        .expect(201)
    ).body.id;
    const email = h.uniqueEmail('am');
    await owner
      .call('post', '/tenants/invitations')
      .send({ email, roleIds: [amRole] })
      .expect(201);
    const am = h.client();
    await am
      .call('post', '/auth/accept-invite')
      .send({
        token: h.tokenFrom(h.lastEmail(email, 'invitation').data.url),
        fullName: 'Access Manager',
        password: PASSWORD,
      })
      .expect(200);
    await am.login(email);
    await h.enableMfa(am);

    expect(
      (
        await am
          .call('put', `/tenants/members/${ownerMid}/roles`)
          .send({ roleIds: [await roleId(am, 'employee')] })
      ).body.code,
    ).toBe('last_admin');
    expect((await am.call('post', `/tenants/members/${ownerMid}/suspend`)).body.code).toBe('last_admin');
    expect((await am.call('delete', `/tenants/members/${ownerMid}`)).body.code).toBe('last_admin');

    // Once a second admin exists, the first can be demoted.
    await h.member(owner, ['company_admin'], 'admin2');
    await am
      .call('put', `/tenants/members/${ownerMid}/roles`)
      .send({ roleIds: [await roleId(am, 'hr_manager')] })
      .expect(204);
  });

  test('suspending signs the member out at once; reactivating restores access; force sign-out ends sessions', async () => {
    const owner = await h.owner('susp', { mfa: true });
    const emp = await h.member(owner, ['employee'], 'emp');
    await emp.call('get', '/auth/me').expect(200);
    await owner.call('post', `/tenants/members/${emp.membershipId}/suspend`).expect(204);
    expect((await emp.call('get', '/auth/me')).body.code).toBe('session_revoked');
    expect((await h.client().login(emp.email)).body.code).toBe('no_active_membership');

    await owner.call('post', `/tenants/members/${emp.membershipId}/reactivate`).expect(204);
    await emp.login(emp.email);
    await emp.call('get', '/auth/me').expect(200);

    const out = await owner.call('post', `/tenants/members/${emp.membershipId}/sign-out`).expect(200);
    expect(out.body.sessionsEnded).toBeGreaterThanOrEqual(1);
    expect((await emp.call('get', '/auth/me')).body.code).toBe('session_revoked');

    await owner.call('delete', `/tenants/members/${emp.membershipId}`).expect(204);
    const listed = (await owner.call('get', '/tenants/members').expect(200)).body.data;
    expect(listed.find((m) => m.email === emp.email)).toBeUndefined();
    const removed = (await owner.call('get', '/tenants/members?status=REMOVED').expect(200)).body.data;
    expect(removed.find((m) => m.email === emp.email)).toBeTruthy();

    const audit = await h
      .db()
      .auditLog.findMany({ where: { tenantId: owner.tenantId, action: { startsWith: 'member.' } } });
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        'member.invited',
        'member.suspended',
        'member.active',
        'member.signed_out',
        'member.removed',
      ]),
    );
  });
});

describe('roles', () => {
  test('custom role: create, assign, change permissions (applies immediately), delete only when unused', async () => {
    const owner = await h.owner('roles', { mfa: true });
    const emp = await h.member(owner, ['employee'], 'emp');
    const id = (
      await owner
        .call('post', '/tenants/roles')
        .send({
          name: 'Office Coordinator',
          grants: [{ permissionCode: 'company.org.manage', scope: 'COMPANY' }],
        })
        .expect(201)
    ).body.id;
    expect(
      (await owner.call('post', '/tenants/roles').send({ name: 'Office Coordinator', grants: [] })).status,
    ).toBe(409);

    await owner
      .call('put', `/tenants/members/${emp.membershipId}/roles`)
      .send({ roleIds: [id] })
      .expect(204);
    await emp
      .call('post', '/companies/designations')
      .send({ title: `Coordinator-made ${Date.now()}` })
      .expect(201);

    await owner
      .call('patch', `/tenants/roles/${id}`)
      .send({ grants: [{ permissionCode: 'attendance.view', scope: 'OWN' }] })
      .expect(204);
    expect(
      (await emp.call('post', '/companies/designations').send({ title: `Too late ${Date.now()}` })).status,
    ).toBe(403); // cache invalidated

    expect((await owner.call('delete', `/tenants/roles/${id}`)).body.code).toBe('in_use');
    await owner
      .call('put', `/tenants/members/${emp.membershipId}/roles`)
      .send({ roleIds: [await roleId(owner, 'employee')] })
      .expect(204);
    await owner.call('delete', `/tenants/roles/${id}`).expect(204);
  });

  test('Company Admin role is locked; built-in roles cannot be deleted; unknown permissions are rejected', async () => {
    const owner = await h.owner('locked', { mfa: true });
    const roles = (await owner.call('get', '/tenants/roles').expect(200)).body.data;
    expect(roles).toHaveLength(9);
    const admin = roles.find((r) => r.systemKey === 'company_admin');
    expect(admin).toMatchObject({ locked: true, sensitive: true, memberCount: 1 });
    expect((await owner.call('patch', `/tenants/roles/${admin.id}`).send({ grants: [] })).body.code).toBe(
      'role_locked',
    );
    expect(
      (await owner.call('delete', `/tenants/roles/${roles.find((r) => r.systemKey === 'recruiter').id}`)).body
        .code,
    ).toBe('role_locked');
    expect(
      (
        await owner
          .call('post', '/tenants/roles')
          .send({ name: 'Root', grants: [{ permissionCode: 'root.all', scope: 'COMPANY' }] })
      ).status,
    ).toBe(422);
    const catalog = (await owner.call('get', '/tenants/permissions').expect(200)).body.data;
    expect(catalog.find((p) => p.code === 'view_team_screenshots')).toMatchObject({ sensitive: true });
  });

  test('editing a built-in role you hold is not allowed (no self-escalation)', async () => {
    const owner = await h.owner('selfesc', { mfa: true });
    const second = await h.member(owner, ['company_admin', 'hr_manager'], 'esc');
    await h.enableMfa(second);
    const hrRole = await roleId(second, 'hr_manager');
    const res = await second
      .call('patch', `/tenants/roles/${hrRole}`)
      .send({ grants: [{ permissionCode: 'payroll.bank.view', scope: 'COMPANY' }] });
    expect(res.body.code).toBe('self_change');
  });
});
