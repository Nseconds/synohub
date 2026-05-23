import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as schema from './schema';
import dotenv from 'dotenv';

dotenv.config();

const dbName = process.env.DB_NAME || 'synohub';

const connectionConfig: any = {
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: dbName,
};

// Check if socket path is provided and file exists
import fs from 'fs';

let useSocket = false;
if (process.env.DB_SOCKET && process.env.DB_SOCKET.trim() !== '') {
  try {
    if (fs.existsSync(process.env.DB_SOCKET)) {
      useSocket = true;
    } else {
      console.warn(`DATABASE: Socket path ${process.env.DB_SOCKET} provided but file does not exist.`);
    }
  } catch (err) {
    console.warn(`DATABASE: Error checking socket path.`);
  }
}

if (useSocket) {
  connectionConfig.socketPath = process.env.DB_SOCKET;
  console.log('DATABASE: Connecting via socket:', connectionConfig.socketPath);
} else {
  // Use 127.0.0.1 instead of localhost to force TCP
  connectionConfig.host = process.env.DB_HOST && process.env.DB_HOST !== 'localhost' ? process.env.DB_HOST : '127.0.0.1';
  connectionConfig.port = parseInt(process.env.DB_PORT || '3307');
  console.log('DATABASE: Connecting via TCP:', connectionConfig.host, ':', connectionConfig.port);
}

console.log('DATABASE: User:', connectionConfig.user);
console.log('DATABASE: DB:', connectionConfig.database);

export const pool = mysql.createPool(connectionConfig);

export const db = drizzle(pool, { schema, mode: 'default' });
