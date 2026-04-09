import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, dialog } from 'electron';

interface PdfItem {
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

interface PdfPayload {
  docType: 'estimate' | 'job' | 'invoice';
  number: string;
  issueDate: string;
  customerName: string;
  customerPhone?: string;
  customerEmail?: string;
  customerAddress?: string;
  business: {
    name?: string;
    address?: string;
    phone?: string;
    email?: string;
    logoPath?: string;
    brandPrimary?: string;
    brandSecondary?: string;
    subBrandName?: string;
    subBrandLogoPath?: string;
  };
  notes?: string;
  terms?: string;
  totals: {
    subtotal?: number;
    discount?: number;
    total?: number;
  };
  items: PdfItem[];
}

const money = (amount?: number) => `LKR ${(amount || 0).toFixed(2)}`;

const docTitle = (type: PdfPayload['docType']) => {
  if (type === 'estimate') return 'Estimate / Quotation';
  if (type === 'job') return 'Job Sheet';
  return 'Invoice';
};

const escapeHtml = (value: string | number | undefined | null) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const toDataUri = (filePath: string) => {
  const ext = path.extname(filePath).toLowerCase();
  const buf = fs.readFileSync(filePath);

  const mime =
    ext === '.svg'
      ? 'image/svg+xml'
      : ext === '.png'
      ? 'image/png'
      : ext === '.jpg' || ext === '.jpeg'
      ? 'image/jpeg'
      : ext === '.webp'
      ? 'image/webp'
      : null;

  if (!mime) return '';
  return `data:${mime};base64,${buf.toString('base64')}`;
};

const resolveLogoDataUri = (logoPath?: string) => {
  if (!logoPath) return '';
  if (logoPath.startsWith('data:image/')) return logoPath;

  const normalized = logoPath.replace(/^\/+/, '');
  const candidates: string[] = [];

  if (path.isAbsolute(logoPath)) {
    candidates.push(logoPath);
  }

  candidates.push(path.join(app.getAppPath(), 'public', normalized));
  candidates.push(path.join(app.getAppPath(), 'dist', normalized));
  candidates.push(path.join(process.cwd(), 'public', normalized));
  candidates.push(path.join(process.cwd(), 'dist', normalized));

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      try {
        return toDataUri(candidate);
      } catch {
        // continue trying next candidate
      }
    }
  }

  return '';
};

const htmlTemplate = (p: PdfPayload) => {
  const primary = p.business.brandPrimary || '#FB1E2C';
  const secondary = p.business.brandSecondary || '#00A7E6';
  const logoDataUri = resolveLogoDataUri(p.business.logoPath);
  const subLogoDataUri = resolveLogoDataUri(p.business.subBrandLogoPath);

  const rows = p.items
    .map(
      (item, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td>${escapeHtml(item.description)}</td>
        <td style="text-align:right">${escapeHtml(item.quantity)}</td>
        <td style="text-align:right">${money(item.unitPrice)}</td>
        <td style="text-align:right">${money(item.lineTotal)}</td>
      </tr>`
    )
    .join('');

  const notesBlock = p.notes ? `<div class="muted">${escapeHtml(p.notes)}</div>` : '<div class="muted">-</div>';
  const termsBlock = p.terms ? `<strong>Terms</strong><div class="muted">${escapeHtml(p.terms)}</div>` : '';

  return `
<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  body { font-family: Arial, sans-serif; margin: 0; color: #111827; }
  .wrap { padding: 20px 24px 24px; }
  h1 { margin: 0; font-size: 24px; color: ${primary}; }
  .muted { color: #475569; font-size: 12px; line-height: 1.45; }
  .top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; gap: 20px; }
  .top-left { display: flex; align-items: flex-start; gap: 12px; }
  .logo-group { display: flex; align-items: center; gap: 8px; }
  .logo { width: 62px; height: 62px; object-fit: contain; border: 1px solid #e2e8f0; border-radius: 10px; padding: 6px; background: #fff; }
  .sub-logo { width: 54px; height: 54px; object-fit: cover; border: 1px solid #bae6fd; border-radius: 999px; padding: 2px; background: #fff; }
  .sub-logo-label { font-size: 11px; font-weight: 700; color: #0369a1; margin-top: 6px; }
  .brand-strip { height: 6px; border-radius: 999px; background: linear-gradient(90deg, ${primary} 0%, #FEAE3E 20%, #5D7A89 40%, #66E77E 60%, #37D1EF 80%, ${secondary} 100%); margin-bottom: 12px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; margin-top: 10px; }
  th, td { border: 1px solid #e2e8f0; padding: 8px; font-size: 12px; }
  th { background: #fff1f2; text-align: left; color: #7f1d1d; }
  .totals { width: 320px; margin-left: auto; margin-top: 14px; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px; }
  .totals div { display: flex; justify-content: space-between; font-size: 13px; padding: 3px 0; }
  .total { font-size: 16px; font-weight: 700; border-top: 1px solid #cbd5e1; margin-top: 6px; padding-top: 6px; color: ${primary}; }
  .box { border: 1px solid #cbd5e1; padding: 10px; border-radius: 8px; background: #fff; }
  .label { color: #64748b; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 4px; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="brand-strip"></div>
    <div class="top">
      <div class="top-left">
        <div>
          <div class="logo-group">
            ${logoDataUri ? `<img class="logo" src="${logoDataUri}" alt="Business logo" />` : ''}
            ${subLogoDataUri ? `<img class="sub-logo" src="${subLogoDataUri}" alt="Sub-brand logo" />` : ''}
          </div>
          ${p.business.subBrandName ? `<div class="sub-logo-label">${escapeHtml(p.business.subBrandName)}</div>` : ''}
        </div>
        <div>
          <h1>${docTitle(p.docType)}</h1>
          <div class="muted">${escapeHtml(p.number)}</div>
          <div class="muted">Date: ${escapeHtml(p.issueDate)}</div>
        </div>
      </div>
      <div style="text-align:right">
        <strong>${escapeHtml(p.business.name || '')}</strong><br />
        <span class="muted">${escapeHtml(p.business.address || '')}</span><br />
        <span class="muted">${escapeHtml(p.business.phone || '')}</span><br />
        <span class="muted">${escapeHtml(p.business.email || '')}</span>
      </div>
    </div>

    <div class="grid">
      <div class="box">
        <div class="label">Customer</div>
        <strong>${escapeHtml(p.customerName)}</strong><br />
        <span class="muted">${escapeHtml(p.customerPhone || '')}</span><br />
        <span class="muted">${escapeHtml(p.customerEmail || '')}</span><br />
        <span class="muted">${escapeHtml(p.customerAddress || '')}</span>
      </div>
      <div class="box">
        <div class="label">Notes</div>
        ${notesBlock}
        ${termsBlock}
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Description</th>
          <th style="text-align:right">Qty</th>
          <th style="text-align:right">Unit Price</th>
          <th style="text-align:right">Line Total</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <div class="totals">
      <div><span>Subtotal</span><span>${money(p.totals.subtotal)}</span></div>
      <div><span>Discount</span><span>${money(p.totals.discount)}</span></div>
      <div class="total"><span>Total</span><span>${money(p.totals.total)}</span></div>
    </div>
  </div>
</body>
</html>`;
};

const withDocumentWindow = async <T>(html: string, task: (win: BrowserWindow) => Promise<T>) => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true
    }
  });

  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    return await task(win);
  } finally {
    if (!win.isDestroyed()) {
      win.close();
    }
  }
};

const buildPdfBuffer = async (payload: PdfPayload) => {
  const html = htmlTemplate(payload);
  return withDocumentWindow(html, (win) =>
    win.webContents.printToPDF({
      margins: { marginType: 'default' },
      pageSize: 'A4',
      printBackground: true
    })
  );
};

export const generatePdfFile = async (payload: PdfPayload) => {
  const result = await dialog.showSaveDialog({
    title: `Export ${docTitle(payload.docType)} PDF`,
    defaultPath: `${payload.number}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });

  if (result.canceled || !result.filePath) {
    return { canceled: true };
  }

  const pdf = await buildPdfBuffer(payload);

  fs.writeFileSync(result.filePath, pdf);
  return { canceled: false, filePath: result.filePath };
};

export const printDocumentFile = async (payload: PdfPayload) => {
  const html = htmlTemplate(payload);

  return withDocumentWindow(html, (win) =>
    new Promise<{ success: boolean; reason?: string }>((resolve) => {
      win.webContents.print(
        {
          silent: false,
          printBackground: true
        },
        (success, failureReason) => {
          resolve({ success, reason: failureReason || undefined });
        }
      );
    })
  );
};

export const previewPdfData = async (payload: PdfPayload) => {
  const pdf = await buildPdfBuffer(payload);
  return {
    dataUrl: `data:application/pdf;base64,${pdf.toString('base64')}`
  };
};
