import type { Express } from "express";
import { getAuthUser, requireAuth } from "../auth/middleware";
import { getDashboardData } from "../services/dashboardService";

export function registerDashboardRoutes(app: Express) {
  app.get("/api/data", requireAuth, async (req, res) => {
    try {
      res.json(await getDashboardData(getAuthUser(req)));
    } catch (error) {
      console.error("Dashboard data fetch failed:", error);
      res.status(500).json({
        error: (error as Error).message,
        details: "Check database connection and table existence. Ensure initDB completed successfully.",
        connectionConfig: {
          host: process.env.DB_HOST || "localhost (127.0.0.1)",
          port: process.env.DB_PORT || "3306/3307",
          user: process.env.DB_USER || "root",
          database: process.env.DB_NAME || "testdb",
          socketPath: process.env.DB_SOCKET || "not provided",
          passwordProvided: !!process.env.DB_PASSWORD,
        },
      });
    }
  });
}
