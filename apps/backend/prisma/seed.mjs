// Seeds platform reference data. Idempotent: safe to run on every deploy and locally.
// Usage: npm run db:seed   (reads DATABASE_URL from the environment or the repo-root .env)
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PERMISSIONS, newId } from '@hrms/shared';

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
    payrollCoverage: 'NATIVE',
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

  const counts = {
    currencies: await db.currency.count(),
    countries: await db.countryProfile.count(),
    permissions: await db.permission.count(),
    plans: await db.plan.count(),
    planPrices: await db.planPrice.count(),
  };
  console.log('Seed complete:', counts);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
