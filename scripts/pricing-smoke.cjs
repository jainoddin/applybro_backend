// Live database smoke test. Creates one temporary plan and always deletes it.
const assert = require('node:assert/strict');
const api = 'http://localhost:4000/pricing';
const headers = { 'Content-Type': 'application/json' };
(async () => {
  let id;
  const data = { name: 'Pricing verification (temporary)', description: 'Temporary integration check', monthlyPrice: 123.45, yearlyPrice: 1000, currency: 'INR', trialDays: 7, features: ['Test feature'], ctaText: 'Get Started', popular: false, isActive: false, order: 9999 };
  try {
    const invalid = await fetch(api, { method: 'POST', headers, body: JSON.stringify({ ...data, monthlyPrice: -1 }) });
    assert.equal(invalid.status, 400, 'negative prices must be rejected');
    const created = await fetch(api, { method: 'POST', headers, body: JSON.stringify(data) });
    assert.equal(created.status, 201);
    id = (await created.json()).id;
    let publicPlans = await (await fetch(api)).json();
    assert(!publicPlans.some(plan => plan.id === id), 'draft must remain hidden');
    const all = await (await fetch(`${api}/admin`)).json();
    assert(all.some(plan => plan.id === id), 'admin must see draft');
    const updated = await fetch(`${api}/${id}`, { method: 'PUT', headers, body: JSON.stringify({ ...data, isActive: true, monthlyPrice: 149.99 }) });
    assert.equal(updated.status, 200);
    publicPlans = await (await fetch(api)).json();
    const plan = publicPlans.find(plan => plan.id === id);
    assert.equal(plan.monthlyPrice, 149.99);
    assert.equal(plan.yearlyPrice, 1000);
    assert.equal(plan.trialDays, 7);
    assert.deepEqual(plan.features, ['Test feature']);
    console.log('PASS: validation, database create/update, hidden drafts, public prices and trial details.');
  } finally {
    if (id) {
      const removed = await fetch(`${api}/${id}`, { method: 'DELETE' });
      assert.equal(removed.status, 200, 'temporary plan cleanup');
      const publicPlans = await (await fetch(api)).json();
      assert(!publicPlans.some(plan => plan.id === id));
      console.log('PASS: temporary plan deleted; no test pricing remains.');
    }
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
