import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as schema from './schema';
import dotenv from 'dotenv';

dotenv.config();

// Debugging: Check if process.env is actually loaded
if (!process.env.DB_SOCKET && !process.env.DB_HOST) {
  console.warn('WARNING: No database environment variables found. Using defaults.');
}

const connectionConfig: any = {
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'synohub',
};

// If socketPath is provided, it takes precedence in mysql2 and ignores host/port
if (process.env.DB_SOCKET) {
  connectionConfig.socketPath = process.env.DB_SOCKET;
  console.log('DB: Connecting via Socket:', connectionConfig.socketPath);
} else {
  connectionConfig.host = process.env.DB_HOST || '127.0.0.1';
  connectionConfig.port = parseInt(process.env.DB_PORT || '3307');
  console.log('DB: Connecting via TCP:', connectionConfig.host, ':', connectionConfig.port);
}

console.log('DB: User:', connectionConfig.user);
console.log('DB: Database:', connectionConfig.database);

export const pool = mysql.createPool(connectionConfig);

export const db = drizzle(pool, { schema, mode: 'default' });
