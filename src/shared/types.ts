export type Role = 'Admin' | 'Staff';

export interface User {
  id: number;
  username: string;
  role: Role;
  mustChangePassword: number;
  createdAt: string;
  updatedAt: string;
}

export interface Session {
  userId: number;
  username: string;
  role: Role;
  mustChangePassword: boolean;
}

export interface Customer {
  id: number;
  name: string;
  phone: string;
  email?: string;
  address?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Supplier {
  id: number;
  name: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
  isActive: number;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierSpendRecord {
  id: number;
  supplierId: number;
  inventoryItemId?: number;
  itemName?: string;
  purchaseDate: string;
  quantity: number;
  unitCost: number;
  amount: number;
  referenceNo?: string;
  notes?: string;
  createdBy?: number;
  createdAt: string;
}

export interface InventoryItem {
  id: number;
  name: string;
  brand?: string;
  category?: string;
  sku: string;
  batchNumber?: string;
  serialReference?: string;
  imagePath?: string;
  isSerialized: number;
  unitPrice: number;
  costPrice: number;
  sellingPrice: number;
  itemDiscountType?: DiscountType;
  itemDiscountValue?: number;
  effectiveSellingPrice?: number;
  pricingMethod?: 'MANUAL' | 'PROFIT_PERCENTAGE';
  profitPercentageTarget?: number;
  quantityInStock: number;
  reorderLevel: number;
  supplierId?: number;
  supplierName?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryMovement {
  id: number;
  itemId: number;
  movementType: 'IN' | 'OUT' | 'ADJUSTMENT' | 'ALLOCATE' | 'RESTORE';
  quantity: number;
  referenceType?: 'JOB' | 'MANUAL' | 'INVOICE' | 'SEED';
  referenceId?: string;
  notes?: string;
  createdBy: number;
  createdAt: string;
}

export type DiscountType = 'NONE' | 'PERCENTAGE' | 'FIXED';

export interface Estimate {
  id: number;
  estimateNumber: string;
  customerId: number;
  issueDate: string;
  status: 'Draft' | 'Sent' | 'Approved' | 'Rejected' | 'Converted';
  discountType: DiscountType;
  discountValue: number;
  subtotal: number;
  totalDiscount: number;
  grandTotal: number;
  notes?: string;
  terms?: string;
  createdBy: number;
  createdAt: string;
  updatedAt: string;
}

export interface EstimateItem {
  id: number;
  estimateId: number;
  inventoryItemId?: number;
  description: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  lineTotal: number;
}

export interface Job {
  id: number;
  jobCode: string;
  customerId: number;
  estimateId?: number;
  title: string;
  description?: string;
  location?: string;
  plannedStartDate?: string;
  plannedEndDate?: string;
  actualCompletionDate?: string;
  status: 'New' | 'Scheduled' | 'In Progress' | 'On Hold' | 'Completed' | 'Cancelled';
  estimatedAmount: number;
  laborCharges: number;
  extraCharges: number;
  finalAdjustments: number;
  notes?: string;
  internalRemarks?: string;
  createdBy: number;
  createdAt: string;
  updatedAt: string;
}

export interface JobItem {
  id: number;
  jobId: number;
  inventoryItemId?: number;
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  allocatedFromStock: number;
}

export interface Staff {
  id: number;
  name: string;
  roleTitle?: string;
  phone?: string;
  email?: string;
  monthlySalary: number;
  isActive: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SalaryRecord {
  id: number;
  staffId: number;
  month: string;
  amount: number;
  isPaid: number;
  notes?: string;
  createdAt: string;
}

export interface Invoice {
  id: number;
  invoiceNumber: string;
  customerId: number;
  jobId: number;
  estimateId?: number;
  issueDate: string;
  dueDate?: string;
  discountType: DiscountType;
  discountValue: number;
  subtotal: number;
  discountAmount: number;
  total: number;
  paymentStatus: 'Unpaid' | 'Partially Paid' | 'Paid';
  paymentMethod?: 'Cash' | 'Bank Transfer' | 'Card' | 'Other';
  notes?: string;
  createdBy: number;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceItem {
  id: number;
  invoiceId: number;
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  sourceType?: 'JOB_ITEM' | 'SERVICE';
  sourceId?: number;
}

export interface Setting {
  key: string;
  value: string;
}

export interface ActivityLog {
  id: number;
  action: string;
  entityType: string;
  entityId?: string;
  description: string;
  performedBy?: number;
  createdAt: string;
}

export interface DashboardStats {
  totalInventoryItems: number;
  lowStockItems: number;
  activeJobs: number;
  pendingEstimates: number;
  unpaidInvoices: number;
  monthlyRevenue: number;
  monthlyTrend: {
    month: string;
    revenue: number;
    spend: number;
    profit: number;
  }[];
  topGrossingItems: {
    itemKey: string;
    itemName: string;
    revenue: number;
    quantity: number;
    invoiceCount: number;
  }[];
  wiring: {
    activeJobs: number;
    completedThisMonth: number;
    revenueThisMonth: number;
    averageCompletedJobValue: number;
    statusBreakdown: {
      status: string;
      count: number;
    }[];
  };
}

export interface ApiRequest<T = unknown> {
  route: string;
  payload?: T;
}

export interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface AuthLoginPayload {
  username: string;
  password: string;
}

export interface ListQuery {
  search?: string;
  status?: string;
}

export interface ExportPayload {
  module: 'inventory' | 'customers' | 'suppliers' | 'estimates' | 'jobs' | 'invoices' | 'staff';
  format: 'xlsx' | 'csv';
}

export interface BackupResult {
  path: string;
}

export interface SelectFileResult {
  canceled: boolean;
  filePath?: string;
}
