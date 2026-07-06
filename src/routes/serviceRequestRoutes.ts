import type { Express } from "express";
import { getAuthUser, requireAuth } from "../auth/middleware";
import {
  createLeadRegistration,
  createServiceTicket,
  deleteLeadRegistration,
  deleteServiceTicket,
  updateLeadRegistration,
  updateServiceTicket,
} from "../services/serviceRequestService";

export function registerServiceRequestRoutes(app: Express) {
  app.post("/api/leads/new", requireAuth, async (req, res) => {
    try {
      const result = await createLeadRegistration(req.body, getAuthUser(req));
      res.json({ success: true, id: result.insertId, message: "Registration created" });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.post("/api/services", requireAuth, async (req, res) => {
    try {
      const result = await createServiceTicket(req.body, getAuthUser(req));
      res.json({ success: true, id: result.insertId, ticket_id: result.insertId ? ("TKT-" + result.insertId) : "", message: "Service ticket created" });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.put("/api/leads/:id", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const authUser = getAuthUser(req);
      const userRole = authUser.role;

      if (userRole === "guest") {
        return res.status(403).json({ error: "Access Denied. Public guest users cannot update records." });
      }

      const recordId = parseInt(id);
      if (userRole === "staff") {
        return res.status(403).json({ error: "Access Denied: Staff users can create and view records but cannot modify or delete existing records. Please contact a Manager or Administrator." });
      }

      await updateLeadRegistration(recordId, req.body);
      res.json({ success: true, message: "Lead registration updated and customer synchronized successfully" });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.delete("/api/leads/:id", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const userRole = getAuthUser(req).role;
      if (userRole === "staff") {
        return res.status(403).json({ error: "Access Denied: Staff users can create and view records but cannot modify or delete existing records. Please contact a Manager or Administrator." });
      }
      if (userRole !== "admin") {
        return res.status(403).json({ error: "Access Denied. Only system administrators can delete records." });
      }

      await deleteLeadRegistration(parseInt(id));
      res.json({ success: true, message: "Lead registration deleted successfully by Admin" });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.put("/api/services/:id", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const userRole = getAuthUser(req).role;

      if (userRole === "guest") {
        return res.status(403).json({ error: "Access Denied. Public guest users cannot update records." });
      }

      const recordId = parseInt(id);
      if (userRole === "staff") {
        return res.status(403).json({ error: "Access Denied: Staff users can create and view records but cannot modify or delete existing records. Please contact a Manager or Administrator." });
      }

      await updateServiceTicket(recordId, req.body);
      res.json({ success: true, message: "Service ticket updated successfully" });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.delete("/api/services/:id", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const userRole = getAuthUser(req).role;
      if (userRole === "staff") {
        return res.status(403).json({ error: "Access Denied: Staff users can create and view records but cannot modify or delete existing records. Please contact a Manager or Administrator." });
      }
      if (userRole !== "admin") {
        return res.status(403).json({ error: "Access Denied. Only system administrators can delete records." });
      }

      await deleteServiceTicket(parseInt(id));
      res.json({ success: true, message: "Service ticket deleted successfully by Admin" });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });
}
