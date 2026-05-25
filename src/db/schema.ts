import { mysqlTable, varchar, serial, text, timestamp, int } from 'drizzle-orm/mysql-core';

export const customers = mysqlTable('customers', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  contactName: varchar('contact_name', { length: 255 }),
  phone: varchar('phone', { length: 50 }),
  email: varchar('email', { length: 255 }),
  region: varchar('region', { length: 100 }),
  implementationType: varchar('implementation_type', { length: 100 }),
  vehicleCount: int('vehicle_count').default(0),
});

export const serviceRequests = mysqlTable('service_requests', {
  id: serial('id').primaryKey(),
  createdAt: varchar('created_at', { length: 100 }),
  source: varchar('source', { length: 100 }),
  region: varchar('region', { length: 100 }),
  status: varchar('status', { length: 50 }).default('New Lead'),
  implementationType: varchar('implementation_type', { length: 100 }),
  customerName: text('customer_name'),
  contactName: varchar('contact_name', { length: 255 }),
  phone: varchar('phone', { length: 50 }),
  email: varchar('email', { length: 255 }),
  address: text('address'),
  mapLink: text('map_link'),
  coordinates: varchar('coordinates', { length: 100 }),
  
  newQty: int('new_qty').default(0),
  migrateQty: int('migrate_qty').default(0),
  tradingQty: int('trading_qty').default(0),
  serviceQty: int('service_qty').default(0),
  otherQty: int('other_qty').default(0),
  accessories: text('accessories'),
  
  requestedPerson: varchar('requested_person', { length: 100 }),
  salesPerson: varchar('sales_person', { length: 100 }),
  salesType: varchar('sales_type', { length: 100 }),
  
  projectValue: varchar('project_value', { length: 100 }),
  priceDetails: text('price_details'),
  comment: text('comment'),
  
  issueDescription: text('issue_description'),
  location: varchar('location', { length: 100 }),
  paymentStatus: varchar('payment_status', { length: 50 }),
  amount: varchar('amount', { length: 50 }),
  vehicleDetails: text('vehicle_details'),
  notes: text('notes'),
  jobStatus: varchar('job_status', { length: 50 }).default('Pending')
});

export const messages = mysqlTable('messages', {
  id: serial('id').primaryKey(),
  role: varchar('role', { length: 20 }).notNull(), // 'user' or 'assistant'
  content: text('content').notNull(),
  timestamp: timestamp('timestamp').defaultNow(),
});
