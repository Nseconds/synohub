import { db } from "../db";
import { customers, serviceRequests } from "../db/schema";
import { normalizeUserName, type AuthUser } from "../auth/users";

export async function getDashboardData(authUser: AuthUser) {
  const userRole = authUser.role;
  const userName = normalizeUserName(authUser.name);

  const allCustomers = await db.select().from(customers);
  let allRequests = await db.select().from(serviceRequests);

  let filteredCustomers = allCustomers;
  if (userRole === "guest") {
    allRequests = allRequests.filter(r => {
      const createdByVal = (r.createdBy || "").trim().toLowerCase();
      return createdByVal === userName;
    });
    filteredCustomers = allCustomers.filter(c => {
      const createdByVal = (c.createdBy || "").trim().toLowerCase();
      return createdByVal === userName;
    });
  } else if (userRole === "staff" && userName) {
    allRequests = allRequests.filter(r => {
      const reqPerson = (r.requestedPerson || "").trim().toLowerCase();
      const salesPerson = (r.salesPerson || "").trim().toLowerCase();
      const createdByVal = (r.createdBy || "").trim().toLowerCase();
      return reqPerson === userName || salesPerson === userName || createdByVal === userName;
    });

    const myCustomerNames = new Set(allRequests.map(r => (r.customerName || "").trim().toLowerCase()));
    filteredCustomers = allCustomers.filter(c => {
      const cName = (c.name || "").trim().toLowerCase();
      const cCreatedBy = (c.createdBy || "").trim().toLowerCase();
      return myCustomerNames.has(cName) || cCreatedBy === userName;
    });
  }

  const allRegistrations = allRequests.map(r => ({
    id: r.id,
    customerName: r.customerName || "",
    contactName: r.contactName || "",
    designation: r.requestedPerson || "",
    phone: r.phone || "",
    email: r.email || "",
    region: r.region || "",
    address: r.address || "",
    mapLink: r.mapLink || "",
    coordinates: r.coordinates || "",
    source: r.source || "",
    status: r.status || "New Lead",
    implementationType: r.implementationType || "",
    salesPerson: r.salesPerson || "",
    salesType: r.salesType || "",
    requestedPerson: r.requestedPerson || "",
    comment: r.comment || "",
    projectValue: r.projectValue ? r.projectValue.toString() : "",
    priceDetails: r.priceDetails || "",
    accessories: r.accessories || "",
    newQty: r.newQty || 0,
    migrateQty: r.migrateQty || 0,
    tradingQty: r.tradingQty || 0,
    serviceQty: r.serviceQty || 0,
    otherQty: r.otherQty || 0,
    createdAt: r.createdAt
  }));

  const allServices = allRequests.map(s => ({
    id: s.id,
    ticketId: s.id ? ("TKT-" + s.id) : "",
    customerName: s.customerName || "",
    description: s.issueDescription || s.notes || s.comment || "",
    status: s.jobStatus || "Pending",
    quantity: (s.newQty || 0) + (s.migrateQty || 0) + (s.tradingQty || 0) + (s.serviceQty || 0) + (s.otherQty || 0) || 1,
    requestedPerson: s.requestedPerson || "",
    payment: s.paymentStatus || "",
    invoiceStatus: s.paymentStatus === "PAID" ? "Invoiced" : "Not Invoiced",
    paymentStatus: s.paymentStatus || "",
    amount: s.amount ? s.amount.toString() : "",
    assignee: s.salesPerson || s.requestedPerson || "",
    createdAt: s.createdAt,
    location: s.location || s.region || ""
  }));

  return { registrations: allRegistrations, services: allServices, customers: filteredCustomers };
}
