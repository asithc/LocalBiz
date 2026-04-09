import type { ApiRequest, ApiResponse } from '../../../src/shared/types';
import { getDatabase } from '../db';
import { generatePdfFile, previewPdfData, printDocumentFile } from '../services/pdfService';
import {
  buildBusinessDetails,
  openMailComposer,
  backupDatabase,
  restoreDatabase,
  selectLogoFile,
  copyLogoToDataDir,
  selectImageFile,
  copyImageToDataDir
} from '../services/systemService';
import { changePassword, login, logout } from '../services/authService';
import {
  customerService,
  estimateService,
  getDashboardStats,
  inventoryService,
  invoiceService,
  jobService,
  listRecentActivity,
  settingsService,
  supplierService,
  staffService
} from '../services/dataService';
import { getSession, requireAdmin, requireSession } from '../services/session';
import { exportDataFile } from '../services/exportService';
import {
  disconnectGoogleDrive,
  finishGoogleDeviceAuth,
  publishStocksToWebDrive,
  startGoogleDeviceAuth,
  triggerAutoPublishStocks,
  unpublishStocksFromWebDrive,
  uploadBackupToGoogleDrive
} from '../services/googleDriveService';

const ok = <T>(data: T): ApiResponse<T> => ({ ok: true, data });
const fail = (error: unknown): ApiResponse<never> => ({ ok: false, error: error instanceof Error ? error.message : 'Unknown error' });

const getPdfData = (db: ReturnType<typeof getDatabase>, type: 'estimate' | 'job' | 'invoice', id: number) => {
  if (type === 'estimate') {
    const data = estimateService.get(db, id) as any;
    return {
      docType: 'estimate' as const,
      number: data.estimateNumber,
      issueDate: data.issueDate,
      customerName: data.customerName,
      customerPhone: data.customerPhone,
      customerEmail: data.customerEmail,
      customerAddress: data.customerAddress,
      business: buildBusinessDetails(db),
      notes: data.notes,
      terms: data.terms,
      totals: {
        subtotal: Number(data.subtotal || 0),
        discount: Number(data.totalDiscount || 0),
        total: Number(data.grandTotal || 0)
      },
      items: data.items
    };
  }

  if (type === 'job') {
    const data = jobService.get(db, id) as any;
    const subtotal = (data.items || []).reduce((sum: number, item: any) => sum + Number(item.lineTotal || 0), 0);
    const total = subtotal + Number(data.laborCharges || 0) + Number(data.extraCharges || 0) + Number(data.finalAdjustments || 0);

    return {
      docType: 'job' as const,
      number: data.jobCode,
      issueDate: data.updatedAt?.slice(0, 10) || new Date().toISOString().slice(0, 10),
      customerName: data.customerName,
      customerPhone: data.customerPhone,
      customerEmail: data.customerEmail,
      customerAddress: data.customerAddress,
      business: buildBusinessDetails(db),
      notes: data.notes,
      totals: {
        subtotal,
        discount: 0,
        total
      },
      items: data.items
    };
  }

  const data = invoiceService.get(db, id) as any;
  return {
    docType: 'invoice' as const,
    number: data.invoiceNumber,
    issueDate: data.issueDate,
    customerName: data.customerName,
    customerPhone: data.customerPhone,
    customerEmail: data.customerEmail,
    customerAddress: data.customerAddress,
    business: buildBusinessDetails(db),
    notes: data.notes,
    totals: {
      subtotal: Number(data.subtotal || 0),
      discount: Number(data.discountAmount || 0),
      total: Number(data.total || 0)
    },
    items: data.items
  };
};

export const handleApiRequest = async (req: ApiRequest): Promise<ApiResponse> => {
  const db = getDatabase();

  try {
    switch (req.route) {
      case 'auth/login': {
        const session = login(db, req.payload as any);
        return ok(session);
      }
      case 'auth/session':
        return ok(getSession());
      case 'auth/logout':
        return ok(logout());
      case 'auth/change-password': {
        const session = requireSession();
        const payload = req.payload as any;
        return ok(changePassword(db, { ...payload, userId: payload.userId || session.userId }));
      }

      case 'dashboard/stats':
        requireSession();
        return ok(getDashboardStats(db));
      case 'activity/list':
        requireSession();
        return ok(listRecentActivity(db, Number((req.payload as any)?.limit || 30)));

      case 'meta/options':
        requireSession();
        return ok({
          customers: customerService.list(db),
          inventory: inventoryService.list(db),
          suppliers: supplierService.list(db),
          staff: staffService.list(db),
          estimates: estimateService.list(db),
          jobs: jobService.list(db)
        });

      case 'inventory/list':
        requireSession();
        return ok(inventoryService.list(db, (req.payload as any)?.search));
      case 'inventory/create': {
        const session = requireSession();
        const result = inventoryService.create(db, req.payload as any, session.userId);
        triggerAutoPublishStocks(db);
        return ok(result);
      }
      case 'inventory/update': {
        const session = requireSession();
        const payload = req.payload as any;
        const result = inventoryService.update(db, payload.id, payload.data, session.userId);
        triggerAutoPublishStocks(db);
        return ok(result);
      }
      case 'inventory/delete': {
        const session = requireSession();
        const result = inventoryService.delete(db, (req.payload as any).id, session.userId);
        triggerAutoPublishStocks(db);
        return ok(result);
      }
      case 'inventory/movements':
        requireSession();
        return ok(inventoryService.movements(db, (req.payload as any)?.itemId));
      case 'inventory/analytics':
        requireSession();
        return ok(inventoryService.analytics(db, req.payload as any));
      case 'inventory/adjust': {
        const session = requireSession();
        const result = inventoryService.adjustStock(db, req.payload as any, session.userId);
        triggerAutoPublishStocks(db);
        return ok(result);
      }
      case 'inventory/allocate': {
        const session = requireSession();
        const result = inventoryService.allocateToJob(db, req.payload as any, session.userId);
        triggerAutoPublishStocks(db);
        return ok(result);
      }

      case 'customers/list':
        requireSession();
        return ok(customerService.list(db, (req.payload as any)?.search));
      case 'customers/insights':
        requireSession();
        return ok(customerService.insights(db, (req.payload as any)?.customerId));
      case 'customers/create': {
        const session = requireSession();
        return ok(customerService.create(db, req.payload as any, session.userId));
      }
      case 'customers/update': {
        const session = requireSession();
        const payload = req.payload as any;
        return ok(customerService.update(db, payload.id, payload.data, session.userId));
      }
      case 'customers/delete': {
        const session = requireSession();
        return ok(customerService.delete(db, (req.payload as any).id, session.userId));
      }

      case 'suppliers/list':
        requireSession();
        return ok(supplierService.list(db, (req.payload as any)?.search));
      case 'suppliers/get':
        requireSession();
        return ok(supplierService.get(db, (req.payload as any).id));
      case 'suppliers/create': {
        const session = requireSession();
        return ok(supplierService.create(db, req.payload as any, session.userId));
      }
      case 'suppliers/update': {
        const session = requireSession();
        const payload = req.payload as any;
        return ok(supplierService.update(db, payload.id, payload.data, session.userId));
      }
      case 'suppliers/delete': {
        const session = requireAdmin();
        return ok(supplierService.delete(db, (req.payload as any).id, session.userId));
      }
      case 'suppliers/spend/add': {
        const session = requireSession();
        return ok(supplierService.addSpend(db, req.payload as any, session.userId));
      }
      case 'suppliers/spend/delete': {
        const session = requireSession();
        return ok(supplierService.deleteSpend(db, req.payload as any, session.userId));
      }

      case 'estimates/list':
        requireSession();
        return ok(estimateService.list(db, (req.payload as any)?.search, (req.payload as any)?.status));
      case 'estimates/get':
        requireSession();
        return ok(estimateService.get(db, (req.payload as any).id));
      case 'estimates/create': {
        const session = requireSession();
        return ok(estimateService.create(db, req.payload as any, session.userId));
      }
      case 'estimates/update': {
        const session = requireSession();
        const payload = req.payload as any;
        return ok(estimateService.update(db, payload.id, payload.data, session.userId));
      }
      case 'estimates/status': {
        const session = requireSession();
        const payload = req.payload as any;
        return ok(estimateService.updateStatus(db, payload.id, payload.status, session.userId));
      }
      case 'estimates/delete': {
        const session = requireAdmin();
        return ok(estimateService.delete(db, (req.payload as any).id, session.userId));
      }
      case 'estimates/convert': {
        const session = requireSession();
        const payload = req.payload as any;
        return ok(estimateService.convertToJob(db, payload.id, payload.data || {}, session.userId));
      }

      case 'jobs/list':
        requireSession();
        return ok(jobService.list(db, (req.payload as any)?.search, (req.payload as any)?.status));
      case 'jobs/get':
        requireSession();
        return ok(jobService.get(db, (req.payload as any).id));
      case 'jobs/create': {
        const session = requireSession();
        return ok(jobService.create(db, req.payload as any, session.userId));
      }
      case 'jobs/update': {
        const session = requireSession();
        const payload = req.payload as any;
        return ok(jobService.update(db, payload.id, payload.data, session.userId));
      }
      case 'jobs/delete': {
        const session = requireAdmin();
        return ok(jobService.delete(db, (req.payload as any).id, session.userId));
      }
      case 'jobs/status': {
        const session = requireSession();
        return ok(jobService.updateStatus(db, req.payload as any, session.userId));
      }
      case 'jobs/add-service-item': {
        const session = requireSession();
        return ok(jobService.addServiceItem(db, req.payload as any, session.userId));
      }
      case 'jobs/remove-item': {
        const session = requireSession();
        return ok(jobService.removeItem(db, req.payload as any, session.userId));
      }

      case 'invoices/list':
        requireSession();
        return ok(invoiceService.list(db, (req.payload as any)?.search, (req.payload as any)?.status));
      case 'invoices/get':
        requireSession();
        return ok(invoiceService.get(db, (req.payload as any).id));
      case 'invoices/create-from-job': {
        const session = requireSession();
        return ok(invoiceService.createFromJob(db, req.payload as any, session.userId));
      }
      case 'invoices/update': {
        const session = requireSession();
        const payload = req.payload as any;
        return ok(invoiceService.update(db, payload.id, payload.data, session.userId));
      }
      case 'invoices/payment-status': {
        const session = requireSession();
        return ok(invoiceService.updatePayment(db, req.payload as any, session.userId));
      }
      case 'invoices/delete': {
        const session = requireAdmin();
        return ok(invoiceService.delete(db, (req.payload as any).id, session.userId));
      }

      case 'staff/list':
        requireSession();
        return ok(staffService.list(db, (req.payload as any)?.search));
      case 'staff/create': {
        const session = requireSession();
        return ok(staffService.create(db, req.payload as any, session.userId));
      }
      case 'staff/update': {
        const session = requireSession();
        const payload = req.payload as any;
        return ok(staffService.update(db, payload.id, payload.data, session.userId));
      }
      case 'staff/delete': {
        const session = requireAdmin();
        return ok(staffService.delete(db, (req.payload as any).id, session.userId));
      }
      case 'staff/jobs':
        requireSession();
        return ok(staffService.jobsByStaff(db, (req.payload as any).staffId));
      case 'staff/salaries':
        requireSession();
        return ok(staffService.salaryList(db, (req.payload as any)?.staffId));
      case 'staff/salary/create': {
        const session = requireSession();
        return ok(staffService.addSalaryRecord(db, req.payload as any, session.userId));
      }
      case 'staff/salary/status': {
        const session = requireSession();
        const payload = req.payload as any;
        return ok(staffService.updateSalaryStatus(db, payload.id, payload.isPaid, session.userId));
      }

      case 'settings/get':
        requireSession();
        return ok(settingsService.getAll(db));
      case 'settings/update': {
        const session = requireAdmin();
        return ok(settingsService.updateMany(db, (req.payload as any)?.data || {}, session.userId));
      }
      case 'settings/select-logo':
        requireAdmin();
        return ok(await selectLogoFile());
      case 'settings/save-logo': {
        requireAdmin();
        return ok({ path: copyLogoToDataDir((req.payload as any).filePath) });
      }
      case 'files/select-image':
        requireSession();
        return ok(await selectImageFile((req.payload as any)?.title || 'Select image'));
      case 'files/save-image': {
        requireSession();
        return ok({ path: copyImageToDataDir((req.payload as any).filePath) });
      }

      case 'export/run':
        requireSession();
        return ok(await exportDataFile(db, req.payload as any));

      case 'pdf/generate': {
        requireSession();
        const payload = req.payload as any;
        const data = getPdfData(db, payload.type, payload.id);
        return ok(await generatePdfFile(data));
      }
      case 'pdf/preview': {
        requireSession();
        const payload = req.payload as any;
        const data = getPdfData(db, payload.type, payload.id);
        return ok(await previewPdfData(data));
      }
      case 'pdf/print': {
        requireSession();
        const payload = req.payload as any;
        const data = getPdfData(db, payload.type, payload.id);
        return ok(await printDocumentFile(data));
      }

      case 'mail/compose':
        requireSession();
        return ok(await openMailComposer(db, req.payload as any));

      case 'backup/create':
        requireAdmin();
        return ok(await backupDatabase());
      case 'backup/restore':
        requireAdmin();
        return ok(await restoreDatabase());
      case 'gdrive/device/start':
        requireAdmin();
        return ok(await startGoogleDeviceAuth(db));
      case 'gdrive/device/finish':
        requireAdmin();
        return ok(await finishGoogleDeviceAuth(db, req.payload as any));
      case 'gdrive/backup/upload':
        requireAdmin();
        return ok(await uploadBackupToGoogleDrive(db));
      case 'gdrive/disconnect':
        requireAdmin();
        return ok(disconnectGoogleDrive(db));
      case 'gdrive/stocks/publish':
        requireAdmin();
        return ok(await publishStocksToWebDrive(db));
      case 'gdrive/stocks/unpublish':
        requireAdmin();
        return ok(await unpublishStocksFromWebDrive(db));

      default:
        throw new Error(`Unknown API route: ${req.route}`);
    }
  } catch (error) {
    return fail(error);
  }
};
