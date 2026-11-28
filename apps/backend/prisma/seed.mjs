// Seeds platform reference data. Idempotent: safe to run on every deploy and locally.
// Usage: npm run db:seed   (reads DATABASE_URL from the environment or the repo-root .env)
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { createHash } from 'node:crypto';
import { PERMISSIONS, newId } from '@hrms/shared';
import { IN_RULES_2025_26 } from '@hrms/payroll/rules/in';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const db = new PrismaClient({ adapter: new PrismaMariaDb(process.env.DATABASE_URL) });

const currencies = [
  { code: 'INR', name: 'Indian rupee', minorUnits: 2 },
  { code: 'GBP', name: 'Pound sterling', minorUnits: 2 },
  { code: 'USD', name: 'US dollar', minorUnits: 2 },
  { code: 'EUR', name: 'Euro', minorUnits: 2 },
  { code: 'AED', name: 'UAE dirham', minorUnits: 2 },
  { code: 'JPY', name: 'Japanese yen', minorUnits: 0 },
  { code: 'KWD', name: 'Kuwaiti dinar', minorUnits: 3 },
];

// Minimal country profiles. Field rules and payroll packs are filled in by Sprints 4 and 7.
const countries = [
  {
    code: 'IN',
    name: 'India',
    defaultCurrency: 'INR',
    defaultLocale: 'en-IN',
    weekendDays: [0],
    payrollCoverage: 'NATIVE',
    nationalIdTypes: [{ type: 'PAN', pattern: '^[A-Z]{5}[0-9]{4}[A-Z]$' }],
    bankFieldFormat: { required: ['ifsc', 'accountNumber'] },
  },
  {
    code: 'GB',
    name: 'United Kingdom',
    defaultCurrency: 'GBP',
    defaultLocale: 'en-GB',
    weekendDays: [0, 6],
    payrollCoverage: 'CONFIGURABLE', // no UK pack yet; NATIVE only once a reviewed pack exists
    nationalIdTypes: [{ type: 'NINO', pattern: '^[A-CEGHJ-PR-TW-Z]{2}[0-9]{6}[A-D]$' }],
    bankFieldFormat: { required: ['sortCode', 'accountNumber'] },
  },
  {
    code: 'US',
    name: 'United States',
    defaultCurrency: 'USD',
    defaultLocale: 'en-US',
    weekendDays: [0, 6],
    payrollCoverage: 'EXPORT',
    nationalIdTypes: [{ type: 'SSN', pattern: '^[0-9]{3}-?[0-9]{2}-?[0-9]{4}$' }],
    bankFieldFormat: { required: ['routingNumber', 'accountNumber'] },
  },
  {
    code: 'AE',
    name: 'United Arab Emirates',
    defaultCurrency: 'AED',
    defaultLocale: 'en-AE',
    weekendDays: [0, 6],
    payrollCoverage: 'CONFIGURABLE',
    nationalIdTypes: [{ type: 'EMIRATES_ID', pattern: '^784-?[0-9]{4}-?[0-9]{7}-?[0-9]$' }],
    bankFieldFormat: { required: ['iban'] },
  },
  {
    code: 'DE',
    name: 'Germany',
    defaultCurrency: 'EUR',
    defaultLocale: 'de-DE',
    weekendDays: [0, 6],
    payrollCoverage: 'EXPORT',
    nationalIdTypes: [{ type: 'STEUER_ID', pattern: '^[0-9]{11}$' }],
    bankFieldFormat: { required: ['iban'] },
  },
];

const plans = [
  {
    code: 'starter',
    name: 'Starter',
    maxEmployees: 50,
    screenshotRetentionMaxDays: 30,
    features: { modules: ['core', 'attendance', 'leave', 'work_status'], monitoringAddon: false },
  },
  {
    code: 'growth',
    name: 'Growth',
    maxEmployees: 500,
    screenshotRetentionMaxDays: 90,
    features: {
      modules: [
        'core',
        'attendance',
        'leave',
        'payroll',
        'work_status',
        'recruitment',
        'onboarding',
        'performance',
      ],
      monitoringAddon: true,
    },
  },
];
// Prices are placeholders to be set by the business before launch; amounts are per employee per month.
const prices = {
  starter: { USD: '3.0000', EUR: '3.0000', GBP: '2.5000', INR: '149.0000' },
  growth: { USD: '6.0000', EUR: '6.0000', GBP: '5.0000', INR: '299.0000' },
};

async function main() {
  for (const c of currencies)
    await db.currency.upsert({
      where: { code: c.code },
      create: c,
      update: { name: c.name, minorUnits: c.minorUnits },
    });

  for (const c of countries) {
    const data = { ...c, fieldRules: {}, addressFormat: {} };
    await db.countryProfile.upsert({ where: { code: c.code }, create: data, update: data });
  }

  for (const p of PERMISSIONS) {
    const data = { module: p.module, description: p.description, isSensitive: p.sensitive };
    await db.permission.upsert({ where: { code: p.code }, create: { code: p.code, ...data }, update: data });
  }

  for (const plan of plans) {
    const saved = await db.plan.upsert({
      where: { code: plan.code },
      create: { id: newId(), ...plan },
      update: plan,
    });
    for (const [currency, unitAmount] of Object.entries(prices[plan.code])) {
      await db.planPrice.upsert({
        where: { planId_currency_interval: { planId: saved.id, currency, interval: 'MONTH' } },
        create: { id: newId(), planId: saved.id, currency, interval: 'MONTH', unitAmount },
        update: {},
      });
    }
  }

  // Statutory rule packs. A published version is immutable: changing rules means publishing a new version.
  const STATUTORY = [
    {
      pack: { code: 'IN', countryCode: 'IN', name: 'India statutory payroll', engineModule: 'in' },
      versions: [
        {
          version: 1,
          effectiveFrom: '2025-04-01',
          effectiveTo: null,
          rules: IN_RULES_2025_26,
          reviewedBy: null,
        },
      ],
    },
  ];
  for (const { pack, versions } of STATUTORY) {
    const saved = await db.statutoryRulePack.upsert({
      where: { code: pack.code },
      create: { id: newId(), ...pack },
      update: { name: pack.name, engineModule: pack.engineModule },
    });
    for (const v of versions) {
      const checksum = createHash('sha256').update(JSON.stringify(v.rules)).digest('hex');
      const existing = await db.statutoryRuleVersion.findUnique({
        where: { packId_version: { packId: saved.id, version: v.version } },
      });
      if (existing && existing.checksum !== checksum)
        throw new Error(
          `Statutory rules ${pack.code} v${v.version} were changed after publishing. Publish a new version instead.`,
        );
      if (!existing)
        await db.statutoryRuleVersion.create({
          data: {
            id: newId(),
            packId: saved.id,
            version: v.version,
            rules: v.rules,
            effectiveFrom: new Date(`${v.effectiveFrom}T00:00:00Z`),
            effectiveTo: v.effectiveTo ? new Date(`${v.effectiveTo}T00:00:00Z`) : null,
            checksum,
            reviewedBy: v.reviewedBy,
            publishedAt: new Date(),
          },
        });
    }
  }

  // Monitoring jurisdiction registry (GLB-14..16). PROVISIONAL: these entries have NOT been reviewed by lawyers
  // (legalReviewedOn stays null and the product says so). Countries without an entry, or marked UNKNOWN, stay
  // closed: screenshots are never enabled there. Entries are created once and never edited; a change is a new version.
  const JURISDICTIONS = [
    {
      countryCode: 'IN',
      steps: ['WRITTEN_NOTICE', 'PURPOSE_LIMITATION'],
      maxRetentionDays: 90,
      minNoticeDays: 7,
    },
    {
      countryCode: 'GB',
      steps: ['WRITTEN_NOTICE', 'DPIA', 'PURPOSE_LIMITATION'],
      maxRetentionDays: 90,
      minNoticeDays: 14,
    },
    { countryCode: 'US', steps: ['WRITTEN_NOTICE'], maxRetentionDays: 90, minNoticeDays: 7 },
    {
      countryCode: 'DE',
      steps: ['WRITTEN_NOTICE', 'DPIA', 'WORKS_COUNCIL', 'PURPOSE_LIMITATION'],
      maxRetentionDays: 30,
      minNoticeDays: 30,
    },
  ];
  for (const j of JURISDICTIONS) {
    const key = {
      countryCode_regionCode_version: { countryCode: j.countryCode, regionCode: '', version: 1 },
    };
    if (!(await db.jurisdictionPolicy.findUnique({ where: key })))
      await db.jurisdictionPolicy.create({
        data: {
          id: newId(),
          countryCode: j.countryCode,
          regionCode: '',
          version: 1,
          screenshotsAllowed: 'ALLOWED_WITH_STEPS',
          activityAllowed: 'UNKNOWN',
          requiredSteps: j.steps,
          maxRetentionDays: j.maxRetentionDays,
          minNoticeDays: j.minNoticeDays,
          legalReviewedOn: null,
          effectiveFrom: new Date('2026-01-01T00:00:00Z'),
        },
      });
  }

  const counts = {
    currencies: await db.currency.count(),
    countries: await db.countryProfile.count(),
    permissions: await db.permission.count(),
    plans: await db.plan.count(),
    planPrices: await db.planPrice.count(),
    statutoryRuleVersions: await db.statutoryRuleVersion.count(),
    jurisdictionPolicies: await db.jurisdictionPolicy.count(),
  };
  console.log('Seed complete:', counts);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
