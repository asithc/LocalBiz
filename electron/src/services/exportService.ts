import fs from 'node:fs';
import path from 'node:path';
import { dialog } from 'electron';
import ExcelJS from 'exceljs';
import type { ExportPayload } from '../../../src/shared/types';
import { listForExport, settingsService } from './dataService';
import type { Database } from 'better-sqlite3';

const normalizeHeaders = (row: Record<string, unknown>) => Object.keys(row);

export const exportDataFile = async (db: Database, payload: ExportPayload) => {
  const rows = listForExport(db, payload);
  if (!rows.length) {
    throw new Error(`No ${payload.module} data available for export.`);
  }

  const ext = payload.format === 'xlsx' ? 'xlsx' : 'csv';
  const result = await dialog.showSaveDialog({
    title: `Export ${payload.module}`,
    defaultPath: `${payload.module}-${new Date().toISOString().slice(0, 10)}.${ext}`,
    filters: payload.format === 'xlsx' ? [{ name: 'Excel', extensions: ['xlsx'] }] : [{ name: 'CSV', extensions: ['csv'] }]
  });

  if (result.canceled || !result.filePath) {
    return { canceled: true };
  }

  fs.mkdirSync(path.dirname(result.filePath), { recursive: true });

  if (payload.format === 'xlsx') {
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet(payload.module);
    const settings = settingsService.getAll(db);
    const businessName = settings.business_name || 'Jayakula Brothers';
    const brandPrimary = (settings.brand_primary || '#FB1E2C').replace('#', '');

    const headers = normalizeHeaders(rows[0]);
    ws.columns = headers.map((header, idx) => ({
      header,
      key: header,
      width: Math.max(16, header.length + (idx === 0 ? 12 : 6))
    }));

    ws.mergeCells(1, 1, 1, headers.length);
    ws.getCell('A1').value = `${businessName} - ${payload.module.toUpperCase()} EXPORT`;
    ws.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${brandPrimary}` } };
    ws.getCell('A1').alignment = { vertical: 'middle', horizontal: 'center' };
    ws.getRow(1).height = 28;

    ws.mergeCells(2, 1, 2, headers.length);
    ws.getCell('A2').value = `Generated: ${new Date().toLocaleString()} | Currency: LKR`;
    ws.getCell('A2').font = { size: 10, color: { argb: 'FF475569' } };
    ws.getCell('A2').alignment = { vertical: 'middle', horizontal: 'center' };

    const headerRowIndex = 4;
    const headerRow = ws.getRow(headerRowIndex);
    headers.forEach((header, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = header;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${brandPrimary}` } };
      cell.alignment = { vertical: 'middle', horizontal: 'left' };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
      };
    });

    rows.forEach((row, index) => {
      const targetRow = ws.getRow(headerRowIndex + index + 1);
      headers.forEach((header, i) => {
        targetRow.getCell(i + 1).value = row[header] as any;
      });
      if (index % 2 === 1) {
        headers.forEach((_, i) => {
          targetRow.getCell(i + 1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF8FAFC' }
          };
        });
      }
    });

    ws.views = [{ state: 'frozen', ySplit: headerRowIndex }];
    ws.autoFilter = {
      from: { row: headerRowIndex, column: 1 },
      to: { row: headerRowIndex, column: headers.length }
    };

    await workbook.xlsx.writeFile(result.filePath);
  } else {
    const headers = normalizeHeaders(rows[0]);
    const lines = [headers.join(',')];
    rows.forEach((row) => {
      lines.push(
        headers
          .map((h) => {
            const value = row[h] ?? '';
            const escaped = String(value).replace(/"/g, '""');
            return `"${escaped}"`;
          })
          .join(',')
      );
    });

    fs.writeFileSync(result.filePath, lines.join('\n'), 'utf8');
  }

  return { canceled: false, filePath: result.filePath };
};
