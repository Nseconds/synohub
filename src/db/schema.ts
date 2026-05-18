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
  phone: varchar('phone', { length: 50 }),
  email: varchar('email', { length: 255 }),
  region: varchar('region', { length: 100 }),
  implementationType: varchar('implementation_type', { length: 100 }),
  status: varchar('status', { length: 50 }).default('New Lead'),
  salesPerson: varchar('sales_person', { length: 100 }),
  salesType: varchar('sales_type', { length: 50 }),
  newQty: int('new_qty').default(0),
  migrateQty: int('migrate_qty').default(0),
  tradingQty: int('trading_qty').default(0),
  createdAt: timestamp('created_at').defaultNow(),
});

export const services = mysqlTable('services', {
  id: serial('id').primaryKey(),
  ticketId: varchar('ticket_id', { length: 50 }).notNull().unique(),
  customerName: varchar('customer_name', { length: 255 }).notNull(),
  description: text('description'),
  status: varchar('status', { length: 50 }).default('New'),
  assignee: varchar('assignee', { length: 100 }),
  payment: varchar('payment', { length: 50 }),
  amount: varchar('amount', { length: 50 }),
  createdAt: timestamp('created_at').defaultNow(),
});

export const messages = mysqlTable('messages', {
  id: serial('id').primaryKey(),
  role: varchar('role', { length: 20 }).notNull(), // 'user' or 'assistant'
  content: text('content').notNull(),
  timestamp: timestamp('timestamp').defaultNow(),
});
