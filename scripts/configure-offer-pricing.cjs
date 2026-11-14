const { PrismaClient } = require('@prisma/client');
const { parseEnv } = require('node:util');
const fs = require('node:fs');
const path = require('node:path');
const { offerPrice } = require('../dist/offers/offer-prices');
const env = parseEnv(fs.readFileSync(path.join(__dirname, '../.env'), 'utf8'));
const prisma = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
(async () => {
  await prisma.$transaction(async tx => {
    const names = ['Standard', 'Festive', 'Student'];
    for (const [index, discount] of [30, 40, 50].entries()) {
      const name = names[index];
      const price = offerPrice(discount);
      const student = discount === 50;
      const data = { name, description: student ? 'For verified college and university students. Admin approval required.' : discount === 40 ? 'A little extra savings for your next career move.' : 'Your monthly career plan with a common offer.', monthlyPrice: price, yearlyPrice: Number((price * 12).toFixed(2)), currency: 'INR', trialDays: 0, discountPercent: discount, gstIncluded: true, requiresStudentVerification: student, features: ['Resume management', 'Job preferences', 'Application planning', ...(student ? ['50% offer after student ID verification'] : ['Offer price includes GST'])], ctaText: student ? 'Verify student ID' : 'Get Started', popular: discount === 30, isActive: true, order: index };
      const existing = await tx.pricingPlan.findFirst({ where: { name } });
      if (existing) await tx.pricingPlan.update({ where: { id: existing.id }, data });
      else await tx.pricingPlan.create({ data });
    }
    // Supersede the old example discounts with the owner's confirmed offer rates.
    await tx.dailyDeal.updateMany({ data: { isActive: false } });
    await tx.offerBanner.updateMany({ data: { isActive: false } });
    for (const [index, discount] of [40, 30, 50].entries()) {
      const student = discount === 50;
      const tag = student ? 'Student Offer' : discount === 40 ? 'Diwali Special' : 'Everyday Offer';
      const data = { tag, tagColor: 'indigo', timer: student ? 'Valid after admin approval · GST included' : 'GST included', iconType: discount === 40 ? 'diya' : 'rocket', discountText: `${discount}% OFF`, originalPrice: '₹284.29', discountedPrice: `₹${offerPrice(discount).toFixed(2)}`, planName: `${student ? 'Student' : discount === 40 ? 'Festive' : 'Standard'} Monthly Plan`, ctaText: student ? 'Verify student ID' : 'View plans', ctaLink: student ? '/student-offer' : '/pricing', popupOnOpen: discount === 40, isActive: true, order: index };
      const previous = await tx.dailyDeal.findFirst({ where: { tag } });
      if (previous) await tx.dailyDeal.update({ where: { id: previous.id }, data });
      else await tx.dailyDeal.create({ data });
    }
  });
  console.log('Published: 30% INR199.00, 40% INR170.57, student 50% INR142.15. Totals include GST; annual = monthly x12.');
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
