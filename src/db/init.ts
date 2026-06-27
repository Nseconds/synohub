import fs from "fs";
import mysql from "mysql2/promise";
import { pool } from "./index";

export async function initDB() {
  try {
    console.log("Ensuring database exists...");

    const initConfig: any = {
      user: process.env.DB_USER || "root",
      password: process.env.DB_PASSWORD || "",
    };

    let useSocket = false;
    if (process.env.DB_SOCKET && process.env.DB_SOCKET.trim() !== "") {
      try {
        if (fs.existsSync(process.env.DB_SOCKET)) {
          useSocket = true;
        } else {
          console.warn(`INIT DB: Socket path ${process.env.DB_SOCKET} provided but file does not exist. Falling back to TCP.`);
        }
      } catch (err) {
        console.warn("INIT DB: Error checking socket path. Falling back to TCP.");
      }
    }

    if (useSocket) {
      initConfig.socketPath = process.env.DB_SOCKET;
      console.log("INIT DB: Using socket:", initConfig.socketPath);
    } else {
      initConfig.host = process.env.DB_HOST && process.env.DB_HOST !== "localhost" ? process.env.DB_HOST : "127.0.0.1";
      initConfig.port = parseInt(process.env.DB_PORT || "3307");
      console.log("INIT DB: Using TCP:", initConfig.host, initConfig.port);
    }

    const initPool = mysql.createPool(initConfig);

    await initPool.execute(`CREATE DATABASE IF NOT EXISTS \`${process.env.DB_NAME || "synohub"}\``);
    await initPool.end();

    console.log("Ensuring tables exist...");

    await pool.execute(`
      CREATE TABLE IF NOT EXISTS customers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        contact_name VARCHAR(255),
        phone VARCHAR(50),
        email VARCHAR(255),
        region VARCHAR(100),
        implementation_type VARCHAR(100),
        vehicle_count INT DEFAULT 0
      )
    `);

    await pool.execute(`
      CREATE TABLE IF NOT EXISTS service_requests (
        id INT AUTO_INCREMENT PRIMARY KEY,
        created_at VARCHAR(100),
        source VARCHAR(100),
        region VARCHAR(100),
        status VARCHAR(50) DEFAULT 'New Lead',
        implementation_type VARCHAR(100),
        customer_name TEXT,
        contact_name VARCHAR(255),
        phone VARCHAR(50),
        email VARCHAR(255),
        address TEXT,
        map_link TEXT,
        coordinates VARCHAR(100),
        new_qty INT DEFAULT 0,
        migrate_qty INT DEFAULT 0,
        trading_qty INT DEFAULT 0,
        service_qty INT DEFAULT 0,
        other_qty INT DEFAULT 0,
        accessories TEXT,
        requested_person VARCHAR(100),
        sales_person VARCHAR(100),
        sales_type VARCHAR(100),
        project_value VARCHAR(100),
        price_details TEXT,
        comment TEXT,
        issue_description TEXT,
        location VARCHAR(100),
        payment_status VARCHAR(50),
        amount VARCHAR(50),
        vehicle_details TEXT,
        notes TEXT,
        job_status VARCHAR(50) DEFAULT 'Pending'
      )
    `);

    await pool.execute(`
      CREATE TABLE IF NOT EXISTS messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        role VARCHAR(20) NOT NULL,
        content TEXT NOT NULL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.execute(`
      CREATE TABLE IF NOT EXISTS salesplus_entries (
        id INT AUTO_INCREMENT PRIMARY KEY,
        synohub_request_id INT,
        sales_plus_id INT DEFAULT 0,
        sales_plus_date VARCHAR(20),
        sales_plus_source VARCHAR(100),
        sales_plus_region VARCHAR(100),
        sales_plus_status VARCHAR(50),
        sales_plus_implementation_type VARCHAR(100),
        locator_plan VARCHAR(100),
        sales_plus_price VARCHAR(100),
        sales_plus_project_value VARCHAR(100),
        sales_plus_company_name TEXT,
        sales_plus_customer_name VARCHAR(255),
        sales_plus_phone VARCHAR(50),
        sales_plus_email VARCHAR(255),
        sales_plus_designation VARCHAR(255),
        sales_plus_address TEXT,
        sales_plus_address_map TEXT,
        sales_plus_address_coordinates VARCHAR(100),
        sales_plus_person VARCHAR(50),
        sales_plus_type VARCHAR(100),
        sales_plus_quantity_new INT DEFAULT 0,
        sales_plus_quantity_migrate INT DEFAULT 0,
        sales_plus_quantity_trading INT DEFAULT 0,
        sales_plus_quantity_service INT DEFAULT 0,
        sales_plus_quantity_others INT DEFAULT 0,
        sales_plus_supplier VARCHAR(255),
        sales_plus_accessories TEXT,
        sales_plus_comment TEXT,
        sales_plus_requested_by VARCHAR(50),
        schedule_note TEXT,
        schedule_phone VARCHAR(50),
        priority VARCHAR(50),
        clientName TEXT,
        itcUsername VARCHAR(255),
        itcPassword VARCHAR(255),
        projectImplementationType VARCHAR(100),
        leadType VARCHAR(100),
        tradeNumber VARCHAR(100),
        notes TEXT,
        create_new_nob INT DEFAULT 0,
        existing_customer INT DEFAULT 0,
        customer_id INT DEFAULT 0,
        additional_contact_details TEXT,
        synohub_requested_person VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    try {
      await pool.execute(`ALTER TABLE messages ADD COLUMN username VARCHAR(255) DEFAULT 'guest'`);
      console.log("Database table 'messages' verified with 'username' column.");
    } catch (columnErr) {
      // Column already exists, which is normal on subsequent boots
    }

    try {
      await pool.execute(`ALTER TABLE service_requests ADD COLUMN created_by VARCHAR(255) DEFAULT 'guest'`);
      console.log("Database table 'service_requests' verified with 'created_by' column.");
    } catch (err) {
      // Column already exists
    }

    try {
      await pool.execute(`ALTER TABLE customers ADD COLUMN created_by VARCHAR(255) DEFAULT 'guest'`);
      console.log("Database table 'customers' verified with 'created_by' column.");
    } catch (err) {
      // Column already exists
    }

    console.log("Database initialized.");
  } catch (e) {
    console.error("Database initialization failed:", (e as Error).message);
  }
}
