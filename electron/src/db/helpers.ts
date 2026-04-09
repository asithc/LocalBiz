import type { DiscountType } from '../../../src/shared/types';

export const nowIso = () => new Date().toISOString();

export const formatLkr = (value: number) => `LKR ${Number(value || 0).toFixed(2)}`;

export const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export const calculateTotals = (
  subtotal: number,
  discountType: DiscountType,
  discountValue: number
) => {
  const safeSubtotal = Math.max(0, Number(subtotal || 0));
  const safeDiscount = Math.max(0, Number(discountValue || 0));
  let totalDiscount = 0;

  if (discountType === 'PERCENTAGE') {
    totalDiscount = round2((safeSubtotal * safeDiscount) / 100);
  } else if (discountType === 'FIXED') {
    totalDiscount = round2(safeDiscount);
  }

  if (totalDiscount > safeSubtotal) {
    throw new Error('Discount cannot exceed subtotal.');
  }

  return {
    subtotal: round2(safeSubtotal),
    totalDiscount,
    grandTotal: round2(safeSubtotal - totalDiscount)
  };
};

export const nextCode = (
  lastValue: string | undefined,
  prefix: 'EST' | 'JOB' | 'INV',
  date = new Date()
) => {
  const segment = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}`;
  if (!lastValue || !lastValue.startsWith(`${prefix}-${segment}-`)) {
    return `${prefix}-${segment}-0001`;
  }

  const parts = lastValue.split('-');
  const n = Number(parts[2] || 0) + 1;
  return `${prefix}-${segment}-${String(n).padStart(4, '0')}`;
};
