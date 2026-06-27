export interface Registration {
  id: number;
  customerName: string;
  contactName: string;
  designation?: string;
  phone: string;
  email: string;
  region: string;
  address?: string;
  mapLink?: string;
  coordinates?: string;
  source?: string;
  status: string;
  implementationType: string;
  salesPerson: string;
  salesType: string;
  requestedPerson?: string;
  comment?: string;
  projectValue?: string;
  priceDetails?: string;
  accessories?: string;
  newQty: number;
  migrateQty: number;
  tradingQty: number;
  serviceQty: number;
  otherQty: number;
  createdAt: string;
}

export interface ServiceTicket {
  id: number;
  ticketId: string;
  customerName: string;
  description: string;
  status: string;
  quantity?: number;
  requestedPerson?: string;
  payment?: string;
  invoiceStatus?: string;
  paymentStatus?: string;
  amount: string;
  assignee: string;
  createdAt: string;
}
