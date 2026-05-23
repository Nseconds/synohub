import { mysqlTable, varchar, serial, text, timestamp, int, boolean } from 'drizzle-orm/mysql-core';

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

export const registrations = mysqlTable('registrations', {
  id: serial('id').primaryKey(),
  customerName: varchar('customer_name', { length: 255 }).notNull(),
  contactName: varchar('contact_name', { length: 255 }),
  designation: varchar('designation', { length: 255 }),
  phone: varchar('phone', { length: 50 }),
  email: varchar('email', { length: 255 }),
  region: varchar('region', { length: 100 }),
  address: text('address'),
  mapLink: text('map_link'),
  coordinates: varchar('coordinates', { length: 100 }),
  source: varchar('source', { length: 100 }),
  status: varchar('status', { length: 50 }).default('New Lead'),
  implementationType: varchar('implementation_type', { length: 100 }),
  salesPerson: varchar('sales_person', { length: 100 }),
  salesType: varchar('sales_type', { length: 100 }),
  requestedPerson: varchar('requested_person', { length: 100 }),
  comment: text('comment'),
  projectValue: varchar('project_value', { length: 100 }),
  priceDetails: text('price_details'),
  accessories: text('accessories'),
  newQty: int('new_qty').default(0),
  migrateQty: int('migrate_qty').default(0),
  tradingQty: int('trading_qty').default(0),
  serviceQty: int('service_qty').default(0),
  otherQty: int('other_qty').default(0),
  createdAt: timestamp('created_at').defaultNow(),
});

export const services = mysqlTable('services', {
  id: serial('id').primaryKey(),
  ticketId: varchar('ticket_id', { length: 50 }).notNull().unique(),
  customerName: varchar('customer_name', { length: 255 }).notNull(),
  description: text('description'),
  status: varchar('status', { length: 50 }).default('New'),
  quantity: int('quantity').default(1),
  requestedPerson: varchar('requested_person', { length: 100 }),
  payment: varchar('payment', { length: 50 }),
  invoiceStatus: varchar('invoice_status', { length: 50 }).default('Not Invoiced'),
  paymentStatus: varchar('payment_status', { length: 50 }).default('Not Paid'),
  amount: varchar('amount', { length: 50 }),
  assignee: varchar('assignee', { length: 100 }),
  createdAt: timestamp('created_at').defaultNow(),
});

export const messages = mysqlTable('messages', {
  id: serial('id').primaryKey(),
  role: varchar('role', { length: 20 }).notNull(), // 'user' or 'assistant'
  content: text('content').notNull(),
  timestamp: timestamp('timestamp').defaultNow(),
});
