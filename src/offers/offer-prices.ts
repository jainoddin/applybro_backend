// All amounts are GST-inclusive totals, calculated in paise to avoid float drift.
export const REGULAR_MONTHLY_PAISE = 28429;
export function offerPrice(percent: number) {
  if (![30, 40, 50].includes(percent)) throw new Error('Unsupported offer');
  return Math.round(REGULAR_MONTHLY_PAISE * (100 - percent) / 100) / 100;
}
