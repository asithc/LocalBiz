export const formatCurrency = (n: number | string | null | undefined) => {
  const value = Number(n || 0);
  return `LKR ${value.toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export const formatDate = (v?: string | null) => {
  if (!v) return '-';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toISOString().slice(0, 10);
};

export const sumBy = <T>(arr: T[], fn: (item: T) => number) => arr.reduce((s, item) => s + fn(item), 0);

export const calculateDiscount = (subtotal: number, type: 'NONE' | 'PERCENTAGE' | 'FIXED', value: number) => {
  const safeSubtotal = Number(subtotal || 0);
  const safeValue = Number(value || 0);

  let discount = 0;
  if (type === 'PERCENTAGE') discount = (safeSubtotal * safeValue) / 100;
  if (type === 'FIXED') discount = safeValue;

  if (discount > safeSubtotal) {
    throw new Error('Discount cannot exceed subtotal.');
  }

  return {
    subtotal: safeSubtotal,
    discount,
    total: safeSubtotal - discount
  };
};
