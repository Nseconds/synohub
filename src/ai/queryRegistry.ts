import type { RowDataPacket } from "mysql2";
import { pool } from "../db";

export type SafeQueryRole = "admin" | "staff" | "guest";
export type TicketStatusGroup = "pending" | "open" | "completed" | "latest";
export type QueryDateRange = "today" | "this_week" | "this_month";

export interface SafeQueryUser {
  role: SafeQueryRole;
  name: string;
}

export interface SafeQueryOptions {
  user?: SafeQueryUser;
  limit?: number;
  dateRange?: QueryDateRange;
  countOnly?: boolean;
  region?: string;
}

export interface StaffQueryParams extends SafeQueryOptions {
  staffName: string;
}

export interface RegionQueryParams extends SafeQueryOptions {
  region: string;
}

export interface ServiceTypeQueryParams extends SafeQueryOptions {
  serviceType: string;
}

export interface TicketIdQueryParams extends SafeQueryOptions {
  ticketId: number;
}

export interface StatusLabelQueryParams extends SafeQueryOptions {
  statusLabel: string;
}

export interface TextSearchQueryParams extends SafeQueryOptions {
  value: string;
  region?: string;
}

export interface CustomerHistoryParams extends SafeQueryOptions {
  customerName: string;
}

export interface CustomerContactParams extends SafeQueryOptions {
  value: string;
}

export interface TicketStatusParams extends SafeQueryOptions {
  statusGroup: TicketStatusGroup;
}

export interface ChatHistoryParams extends SafeQueryOptions {
  channelName?: string;
}

export interface LatestRequestsParams extends SafeQueryOptions {
  limit?: number;
}

export interface RoleScope {
  sql: string;
  params: Array<string>;
}

interface QueryRow extends RowDataPacket {
  [key: string]: any;
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

function normalizeName(value: string | undefined): string {
  return String(value || "").trim().toLowerCase();
}

function normalizeLimit(value: number | undefined, fallback = DEFAULT_LIMIT): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(Math.floor(parsed), MAX_LIMIT));
}

function limitSql(value: number | undefined, fallback = DEFAULT_LIMIT): string {
  return String(normalizeLimit(value, fallback));
}

function createdDateSql(): string {
  return `
    COALESCE(
      STR_TO_DATE(NULLIF(TRIM(created_at), ''), '%Y-%m-%d'),
      STR_TO_DATE(NULLIF(TRIM(created_at), ''), '%d/%m/%Y'),
      STR_TO_DATE(NULLIF(TRIM(created_at), ''), '%d-%m-%Y')
    )
  `;
}

function dateRangeSql(dateRange?: QueryDateRange): string {
  if (dateRange === "today") {
    return `AND DATE(${createdDateSql()}) = CURDATE()`;
  }
  if (dateRange === "this_week") {
    return `AND ${createdDateSql()} >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)`;
  }
  if (dateRange === "this_month") {
    return `AND ${createdDateSql()} >= DATE_FORMAT(CURDATE(), '%Y-%m-01')`;
  }
  return "";
}

function visibleTicketSql(): string {
  return "AND LOWER(COALESCE(job_status, status, '')) NOT IN ('deleted', 'lost', 'duplicate')";
}

function openTicketCaseSql(): string {
  return "LOWER(COALESCE(jobStatus, status, '')) NOT IN ('completed', 'won', 'lost', 'duplicate', 'deleted', 'solved')";
}

function isSafeQueryRole(role: unknown): role is SafeQueryRole {
  return role === "admin" || role === "staff" || role === "guest";
}

function getQueryUser(user?: SafeQueryUser): Required<SafeQueryUser> | null {
  if (!user || !isSafeQueryRole(user.role) || !user.name) return null;
  return {
    role: user.role,
    name: user.name || "",
  };
}

export function applyRoleScope(user?: SafeQueryUser): RoleScope {
  const queryUser = getQueryUser(user);

  if (!queryUser) {
    return { sql: "AND 1 = 0", params: [] };
  }

  if (queryUser.role === "admin") {
    return { sql: "", params: [] };
  }

  const normalizedName = normalizeName(queryUser.name);

  if (queryUser.role === "staff") {
    return {
      sql: `
        AND (
          LOWER(COALESCE(requested_person, '')) = ?
          OR LOWER(COALESCE(sales_person, '')) = ?
          OR LOWER(COALESCE(created_by, '')) = ?
        )
      `,
      params: [normalizedName, normalizedName, normalizedName],
    };
  }

  return {
    sql: "AND LOWER(COALESCE(created_by, '')) = ?",
    params: [normalizedName],
  };
}

export function applyCustomerRoleScope(user?: SafeQueryUser): RoleScope {
  const queryUser = getQueryUser(user);

  if (!queryUser) {
    return { sql: "AND 1 = 0", params: [] };
  }

  if (queryUser.role === "admin") {
    return { sql: "", params: [] };
  }

  const normalizedName = normalizeName(queryUser.name);

  if (queryUser.role === "staff") {
    return {
      sql: `
        AND (
          LOWER(COALESCE(c.created_by, '')) = ?
          OR EXISTS (
            SELECT 1
            FROM service_requests sr_scope
            WHERE LOWER(COALESCE(sr_scope.customer_name, '')) = LOWER(COALESCE(c.name, ''))
              AND (
                LOWER(COALESCE(sr_scope.requested_person, '')) = ?
                OR LOWER(COALESCE(sr_scope.sales_person, '')) = ?
                OR LOWER(COALESCE(sr_scope.created_by, '')) = ?
              )
          )
        )
      `,
      params: [normalizedName, normalizedName, normalizedName, normalizedName],
    };
  }

  return {
    sql: "AND LOWER(COALESCE(c.created_by, '')) = ?",
    params: [normalizedName],
  };
}

export function applyChatRoleScope(user?: SafeQueryUser, channelName?: string): RoleScope {
  const queryUser = getQueryUser(user);

  if (!queryUser) {
    return { sql: "AND 1 = 0", params: [] };
  }

  const requestedChannel = String(channelName || "").trim();

  if (queryUser.role === "admin") {
    if (!requestedChannel) {
      return { sql: "", params: [] };
    }
    return {
      sql: "AND username = ?",
      params: [requestedChannel],
    };
  }

  if (queryUser.role === "staff") {
    const staffChannel = `staff:${queryUser.name.trim()}`;
    return {
      sql: "AND (username = ? OR username = ?)",
      params: [staffChannel, queryUser.name.trim()],
    };
  }

  const guestChannel = `guest:${normalizeName(queryUser.name)}`;
  return {
    sql: "AND username = ?",
    params: [guestChannel],
  };
}

async function executeRows<T extends QueryRow>(sql: string, params: Array<string | number>): Promise<T[]> {
  const [rows] = await pool.execute<T[]>(sql, params);
  return rows;
}

function ticketSelectSql(): string {
  return `
    SELECT
      id,
      customer_name AS customerName,
      contact_name AS contactName,
      phone,
      email,
      region,
      location,
      status,
      job_status AS jobStatus,
      implementation_type AS implementationType,
      requested_person AS requestedPerson,
      sales_person AS salesPerson,
      issue_description AS issueDescription,
      comment,
      project_value AS projectValue,
      new_qty AS newQty,
      migrate_qty AS migrateQty,
      trading_qty AS tradingQty,
      service_qty AS serviceQty,
      other_qty AS otherQty,
      created_at AS createdAt,
      created_by AS createdBy
    FROM service_requests
  `;
}

function ticketStatusSql(statusGroup: TicketStatusGroup): string {
  if (statusGroup === "completed") {
    return "AND LOWER(COALESCE(job_status, status, '')) IN ('completed', 'won', 'solved')";
  }
  if (statusGroup === "pending") {
    return "AND LOWER(COALESCE(job_status, status, '')) IN ('pending', 'new', 'new lead', 'hold', 'ongoing')";
  }
  if (statusGroup === "open") {
    return "AND LOWER(COALESCE(job_status, status, '')) NOT IN ('completed', 'won', 'lost', 'duplicate', 'deleted', 'solved')";
  }
  return "";
}

function customerSelectSql(): string {
  return `
    SELECT
      c.id,
      c.name,
      c.contact_name AS contactName,
      c.phone,
      c.email,
      c.region,
      c.implementation_type AS implementationType,
      c.vehicle_count AS vehicleCount,
      c.created_by AS createdBy
    FROM customers c
  `;
}

export async function findCustomerByName(params: CustomerContactParams): Promise<QueryRow[]> {
  const customerRoleScope = applyCustomerRoleScope(params.user);
  const requestRoleScope = applyRoleScope(params.user);
  const normalizedValue = normalizeName(params.value);
  const compactValue = normalizedValue.replace(/\s+/g, "");
  const firstWord = normalizedValue.split(/\s+/).find(Boolean) || normalizedValue;
  const sql = `
    SELECT *
    FROM (
      SELECT
        c.id,
        c.name,
        c.contact_name AS contactName,
        c.phone,
        c.email,
        c.region,
        c.implementation_type AS implementationType,
        c.vehicle_count AS vehicleCount,
        c.created_by AS createdBy,
        'customer' AS sourceType,
        1 AS sourceRank
      FROM customers c
      WHERE (
        LOWER(COALESCE(c.name, '')) LIKE ?
        OR LOWER(REPLACE(COALESCE(c.name, ''), ' ', '')) LIKE ?
        OR SOUNDEX(COALESCE(c.name, '')) = SOUNDEX(?)
        OR LOWER(COALESCE(c.name, '')) LIKE ?
      )
        ${customerRoleScope.sql}

      UNION ALL

      SELECT
        MAX(id) AS id,
        customer_name AS name,
        MAX(contact_name) AS contactName,
        MAX(phone) AS phone,
        MAX(email) AS email,
        MAX(region) AS region,
        MAX(implementation_type) AS implementationType,
        SUM(COALESCE(new_qty, 0) + COALESCE(migrate_qty, 0) + COALESCE(trading_qty, 0) + COALESCE(service_qty, 0) + COALESCE(other_qty, 0)) AS vehicleCount,
        MAX(created_by) AS createdBy,
        'service_request' AS sourceType,
        2 AS sourceRank
      FROM service_requests
      WHERE COALESCE(customer_name, '') <> ''
        AND (
          LOWER(COALESCE(customer_name, '')) LIKE ?
          OR LOWER(REPLACE(COALESCE(customer_name, ''), ' ', '')) LIKE ?
          OR SOUNDEX(COALESCE(customer_name, '')) = SOUNDEX(?)
          OR LOWER(COALESCE(customer_name, '')) LIKE ?
        )
        ${requestRoleScope.sql}
      GROUP BY customer_name
    ) matched_customers
    ORDER BY sourceRank ASC, id DESC
    LIMIT ${limitSql(params.limit, 10)}
  `;

  return executeRows(sql, [
    `%${normalizedValue}%`,
    `%${compactValue}%`,
    normalizedValue,
    `%${firstWord}%`,
    ...customerRoleScope.params,
    `%${normalizedValue}%`,
    `%${compactValue}%`,
    normalizedValue,
    `%${firstWord}%`,
    ...requestRoleScope.params,
  ]);
}

export async function findCustomerByPhone(params: CustomerContactParams): Promise<QueryRow[]> {
  const roleScope = applyCustomerRoleScope(params.user);
  const sql = `
    ${customerSelectSql()}
    WHERE COALESCE(c.phone, '') LIKE ?
      ${roleScope.sql}
    ORDER BY c.id DESC
    LIMIT ${limitSql(params.limit, 10)}
  `;

  return executeRows(sql, [`%${String(params.value || "").trim()}%`, ...roleScope.params]);
}

export async function findCustomerByEmail(params: CustomerContactParams): Promise<QueryRow[]> {
  const roleScope = applyCustomerRoleScope(params.user);
  const sql = `
    ${customerSelectSql()}
    WHERE LOWER(COALESCE(c.email, '')) LIKE ?
      ${roleScope.sql}
    ORDER BY c.id DESC
    LIMIT ${limitSql(params.limit, 10)}
  `;

  return executeRows(sql, [`%${normalizeName(params.value)}%`, ...roleScope.params]);
}

export async function getCustomerHistory(params: CustomerHistoryParams): Promise<QueryRow[]> {
  const customerName = `%${normalizeName(params.customerName)}%`;
  const roleScope = applyRoleScope(params.user);
  const sql = `
    ${ticketSelectSql()}
    WHERE LOWER(COALESCE(customer_name, '')) LIKE ?
      ${roleScope.sql}
    ORDER BY id DESC
    LIMIT ${limitSql(params.limit, 25)}
  `;

  return executeRows(sql, [customerName, ...roleScope.params]);
}

export async function getCustomerFleetSize(params: CustomerHistoryParams): Promise<QueryRow[]> {
  const roleScope = applyCustomerRoleScope(params.user);
  const sql = `
    SELECT
      c.name AS customerName,
      c.vehicle_count AS vehicleCount,
      c.region,
      c.implementation_type AS implementationType
    FROM customers c
    WHERE LOWER(COALESCE(c.name, '')) LIKE ?
      ${roleScope.sql}
    ORDER BY c.vehicle_count DESC, c.id DESC
    LIMIT ${limitSql(params.limit, 10)}
  `;

  return executeRows(sql, [`%${normalizeName(params.customerName)}%`, ...roleScope.params]);
}

export async function getCustomerRegion(params: CustomerHistoryParams): Promise<QueryRow[]> {
  const roleScope = applyCustomerRoleScope(params.user);
  const sql = `
    SELECT
      c.name AS customerName,
      c.region,
      c.phone,
      c.email
    FROM customers c
    WHERE LOWER(COALESCE(c.name, '')) LIKE ?
      ${roleScope.sql}
    ORDER BY c.id DESC
    LIMIT ${limitSql(params.limit, 10)}
  `;

  return executeRows(sql, [`%${normalizeName(params.customerName)}%`, ...roleScope.params]);
}

export async function getTicketsByStatus(params: TicketStatusParams): Promise<QueryRow[]> {
  const roleScope = applyRoleScope(params.user);
  const sql = `
    SELECT scoped.*, COUNT(*) OVER() AS totalMatches
    FROM (
      ${ticketSelectSql()}
      WHERE 1 = 1
        ${ticketStatusSql(params.statusGroup)}
        ${dateRangeSql(params.dateRange)}
        ${roleScope.sql}
    ) scoped
    ORDER BY id DESC
    LIMIT ${limitSql(params.limit, 10)}
  `;

  return executeRows(sql, roleScope.params);
}

export async function getPendingTickets(params: SafeQueryOptions = {}): Promise<QueryRow[]> {
  return getTicketsByStatus({ ...params, statusGroup: "pending" });
}

export async function getOpenTickets(params: SafeQueryOptions = {}): Promise<QueryRow[]> {
  return getTicketsByStatus({ ...params, statusGroup: "open" });
}

export async function getCompletedTickets(params: SafeQueryOptions = {}): Promise<QueryRow[]> {
  return getTicketsByStatus({ ...params, statusGroup: "completed" });
}

export async function getLatestRequests(params: LatestRequestsParams = {}): Promise<QueryRow[]> {
  const roleScope = applyRoleScope(params.user);
  const sql = `
    SELECT scoped.*, COUNT(*) OVER() AS totalMatches
    FROM (
      ${ticketSelectSql()}
      WHERE 1 = 1
        ${visibleTicketSql()}
        ${dateRangeSql(params.dateRange)}
        ${roleScope.sql}
    ) scoped
    ORDER BY id DESC
    LIMIT ${limitSql(params.limit)}
  `;

  return executeRows(sql, roleScope.params);
}

export async function getTicketById(params: TicketIdQueryParams): Promise<QueryRow[]> {
  const roleScope = applyRoleScope(params.user);
  const sql = `
    ${ticketSelectSql()}
    WHERE id = ?
      ${roleScope.sql}
    LIMIT 1
  `;

  return executeRows(sql, [params.ticketId, ...roleScope.params]);
}

export async function getTicketsByStatusLabel(params: StatusLabelQueryParams): Promise<QueryRow[]> {
  const roleScope = applyRoleScope(params.user);
  const statusLabel = normalizeName(params.statusLabel);
  const sql = `
    SELECT scoped.*, COUNT(*) OVER() AS totalMatches
    FROM (
      ${ticketSelectSql()}
      WHERE (
          LOWER(COALESCE(job_status, '')) = ?
          OR LOWER(COALESCE(status, '')) = ?
        )
        ${roleScope.sql}
    ) scoped
    ORDER BY id DESC
    LIMIT ${limitSql(params.limit, 50)}
  `;

  return executeRows(sql, [statusLabel, statusLabel, ...roleScope.params]);
}

export async function getCompletedTicketsThisWeek(params: SafeQueryOptions = {}): Promise<QueryRow[]> {
  const roleScope = applyRoleScope(params.user);
  const sql = `
    SELECT scoped.*, COUNT(*) OVER() AS totalMatches
    FROM (
      ${ticketSelectSql()}
      WHERE 1 = 1
        ${ticketStatusSql("completed")}
        ${dateRangeSql("this_week")}
        ${roleScope.sql}
    ) scoped
    ORDER BY id DESC
    LIMIT ${limitSql(params.limit, 50)}
  `;

  return executeRows(sql, roleScope.params);
}

export async function getPendingTicketsByStaff(params: StaffQueryParams): Promise<QueryRow[]> {
  const staffName = normalizeName(params.staffName);
  const roleScope = applyRoleScope(params.user);
  const sql = `
    SELECT scoped.*,
      COUNT(*) OVER() AS totalMatches,
      SUM(CASE WHEN ${openTicketCaseSql()} THEN 1 ELSE 0 END) OVER() AS openMatches
    FROM (
      ${ticketSelectSql()}
      WHERE (
          LOWER(COALESCE(requested_person, '')) = ?
          OR LOWER(COALESCE(sales_person, '')) = ?
          OR LOWER(COALESCE(created_by, '')) = ?
        )
        ${ticketStatusSql("pending")}
        ${dateRangeSql(params.dateRange)}
        ${roleScope.sql}
    ) scoped
    ORDER BY id DESC
    LIMIT ${limitSql(params.limit)}
  `;

  return executeRows(sql, [staffName, staffName, staffName, ...roleScope.params]);
}

export async function getTicketsByStaff(params: StaffQueryParams): Promise<QueryRow[]> {
  const staffName = normalizeName(params.staffName);
  const roleScope = applyRoleScope(params.user);
  const sql = `
    SELECT scoped.*,
      COUNT(*) OVER() AS totalMatches,
      SUM(CASE WHEN ${openTicketCaseSql()} THEN 1 ELSE 0 END) OVER() AS openMatches
    FROM (
      ${ticketSelectSql()}
      WHERE (
          LOWER(COALESCE(requested_person, '')) = ?
          OR LOWER(COALESCE(sales_person, '')) = ?
          OR LOWER(COALESCE(created_by, '')) = ?
        )
        ${dateRangeSql(params.dateRange)}
        ${roleScope.sql}
    ) scoped
    ORDER BY id DESC
    LIMIT ${limitSql(params.limit)}
  `;

  return executeRows(sql, [staffName, staffName, staffName, ...roleScope.params]);
}

export async function getOpenTicketsByRegion(params: RegionQueryParams): Promise<QueryRow[]> {
  const region = normalizeName(params.region);
  const roleScope = applyRoleScope(params.user);
  const sql = `
    SELECT scoped.*, COUNT(*) OVER() AS totalMatches
    FROM (
      ${ticketSelectSql()}
      WHERE (
          LOWER(COALESCE(region, '')) = ?
          OR LOWER(COALESCE(location, '')) = ?
        )
        ${ticketStatusSql("open")}
        ${dateRangeSql(params.dateRange)}
        ${roleScope.sql}
    ) scoped
    ORDER BY id DESC
    LIMIT ${limitSql(params.limit)}
  `;

  return executeRows(sql, [region, region, ...roleScope.params]);
}

export async function getTicketsByRegion(params: RegionQueryParams): Promise<QueryRow[]> {
  const region = normalizeName(params.region);
  const roleScope = applyRoleScope(params.user);
  const sql = `
    SELECT scoped.*, COUNT(*) OVER() AS totalMatches
    FROM (
      ${ticketSelectSql()}
      WHERE (
          LOWER(COALESCE(region, '')) = ?
          OR LOWER(COALESCE(location, '')) = ?
        )
        ${visibleTicketSql()}
        ${dateRangeSql(params.dateRange)}
        ${roleScope.sql}
    ) scoped
    ORDER BY id DESC
    LIMIT ${limitSql(params.limit)}
  `;

  return executeRows(sql, [region, region, ...roleScope.params]);
}

export async function getTicketsByServiceType(params: ServiceTypeQueryParams): Promise<QueryRow[]> {
  const serviceType = normalizeName(params.serviceType);
  const roleScope = applyRoleScope(params.user);
  const searchTerm = `%${serviceType}%`;
  const sql = `
    SELECT scoped.*, COUNT(*) OVER() AS totalMatches
    FROM (
      ${ticketSelectSql()}
      WHERE (
          LOWER(COALESCE(implementation_type, '')) LIKE ?
          OR LOWER(COALESCE(issue_description, '')) LIKE ?
          OR LOWER(COALESCE(comment, '')) LIKE ?
        )
        ${ticketStatusSql("open")}
        ${dateRangeSql(params.dateRange)}
        ${roleScope.sql}
    ) scoped
    ORDER BY id DESC
    LIMIT ${limitSql(params.limit, 50)}
  `;

  return executeRows(sql, [searchTerm, searchTerm, searchTerm, ...roleScope.params]);
}

export async function getTicketsByCustomer(params: CustomerHistoryParams): Promise<QueryRow[]> {
  const roleScope = applyRoleScope(params.user);
  const searchTerm = `%${normalizeName(params.customerName)}%`;
  const sql = `
    SELECT scoped.*, COUNT(*) OVER() AS totalMatches
    FROM (
      ${ticketSelectSql()}
      WHERE LOWER(COALESCE(customer_name, '')) LIKE ?
        ${dateRangeSql(params.dateRange)}
        ${roleScope.sql}
    ) scoped
    ORDER BY id DESC
    LIMIT ${limitSql(params.limit, 50)}
  `;

  return executeRows(sql, [searchTerm, ...roleScope.params]);
}

export async function getOpenTicketsByCustomer(params: CustomerHistoryParams): Promise<QueryRow[]> {
  const roleScope = applyRoleScope(params.user);
  const searchTerm = `%${normalizeName(params.customerName)}%`;
  const sql = `
    SELECT scoped.*, COUNT(*) OVER() AS totalMatches
    FROM (
      ${ticketSelectSql()}
      WHERE LOWER(COALESCE(customer_name, '')) LIKE ?
        ${ticketStatusSql("open")}
        ${dateRangeSql(params.dateRange)}
        ${roleScope.sql}
    ) scoped
    ORDER BY id DESC
    LIMIT ${limitSql(params.limit, 50)}
  `;

  return executeRows(sql, [searchTerm, ...roleScope.params]);
}

export async function getTicketsByIssue(params: TextSearchQueryParams): Promise<QueryRow[]> {
  const roleScope = applyRoleScope(params.user);
  const normalizedValue = normalizeName(params.value);
  const searchTerm = `%${normalizedValue}%`;
  const region = normalizeName(params.region);
  const regionSql = region
    ? "AND (LOWER(COALESCE(region, '')) = ? OR LOWER(COALESCE(location, '')) = ?)"
    : "";
  const serviceTypeSql = ["installation", "reinstallation", "migration", "device removal"].includes(normalizedValue)
    ? "OR LOWER(COALESCE(implementation_type, '')) LIKE ?"
    : "";
  const sql = `
    SELECT scoped.*, COUNT(*) OVER() AS totalMatches
    FROM (
      ${ticketSelectSql()}
      WHERE (
          LOWER(COALESCE(issue_description, '')) LIKE ?
          OR LOWER(COALESCE(comment, '')) LIKE ?
          OR LOWER(COALESCE(vehicle_details, '')) LIKE ?
          OR LOWER(COALESCE(notes, '')) LIKE ?
          ${serviceTypeSql}
        )
        ${regionSql}
        ${ticketStatusSql("open")}
        ${dateRangeSql(params.dateRange)}
        ${roleScope.sql}
    ) scoped
    ORDER BY id DESC
    LIMIT ${limitSql(params.limit, 50)}
  `;

  return executeRows(sql, [
    searchTerm,
    searchTerm,
    searchTerm,
    searchTerm,
    ...(serviceTypeSql ? [searchTerm] : []),
    ...(region ? [region, region] : []),
    ...roleScope.params,
  ]);
}

export async function getUnassignedTickets(params: SafeQueryOptions = {}): Promise<QueryRow[]> {
  const roleScope = applyRoleScope(params.user);
  const sql = `
    SELECT scoped.*, COUNT(*) OVER() AS totalMatches
    FROM (
      ${ticketSelectSql()}
      WHERE COALESCE(NULLIF(requested_person, ''), NULLIF(sales_person, '')) IS NULL
        ${ticketStatusSql("open")}
        ${dateRangeSql(params.dateRange)}
        ${roleScope.sql}
    ) scoped
    ORDER BY id DESC
    LIMIT ${limitSql(params.limit, 50)}
  `;

  return executeRows(sql, roleScope.params);
}

export async function getTicketsNeedingAttention(params: SafeQueryOptions = {}): Promise<QueryRow[]> {
  const roleScope = applyRoleScope(params.user);
  const sql = `
    SELECT scoped.*, COUNT(*) OVER() AS totalMatches
    FROM (
      ${ticketSelectSql()}
      WHERE 1 = 1
        ${ticketStatusSql("open")}
        ${dateRangeSql(params.dateRange)}
        AND (
          LOWER(COALESCE(issue_description, '')) LIKE ?
          OR LOWER(COALESCE(issue_description, '')) LIKE ?
          OR LOWER(COALESCE(issue_description, '')) LIKE ?
          OR LOWER(COALESCE(issue_description, '')) LIKE ?
          OR LOWER(COALESCE(issue_description, '')) LIKE ?
          OR LOWER(COALESCE(comment, '')) LIKE ?
          OR LOWER(COALESCE(comment, '')) LIKE ?
          OR LOWER(COALESCE(comment, '')) LIKE ?
          OR LOWER(COALESCE(comment, '')) LIKE ?
          OR LOWER(COALESCE(comment, '')) LIKE ?
          OR COALESCE(NULLIF(requested_person, ''), NULLIF(sales_person, '')) IS NULL
        )
        ${roleScope.sql}
    ) scoped
    ORDER BY id DESC
    LIMIT ${limitSql(params.limit, 50)}
  `;
  const attentionTerms = ["%no connection%", "%offline%", "%ignition%", "%tracker not working%", "%battery%"];

  return executeRows(sql, [...attentionTerms, ...attentionTerms, ...roleScope.params]);
}

export async function getTechnicianWorkload(params: SafeQueryOptions = {}): Promise<QueryRow[]> {
  const roleScope = applyRoleScope(params.user);
  const sql = `
    SELECT
      COALESCE(NULLIF(requested_person, ''), NULLIF(sales_person, ''), 'Unassigned') AS staffName,
      COUNT(*) AS totalTickets,
      SUM(CASE WHEN LOWER(COALESCE(job_status, status, '')) NOT IN ('completed', 'won', 'lost', 'duplicate', 'deleted', 'solved') THEN 1 ELSE 0 END) AS openTickets,
      SUM(CASE WHEN LOWER(COALESCE(job_status, status, '')) IN ('pending', 'new', 'new lead', 'hold', 'ongoing') THEN 1 ELSE 0 END) AS pendingTickets,
      SUM(CASE WHEN LOWER(COALESCE(job_status, status, '')) IN ('completed', 'won', 'solved') THEN 1 ELSE 0 END) AS completedTickets
    FROM service_requests
    WHERE 1 = 1
      ${dateRangeSql(params.dateRange)}
      ${roleScope.sql}
    GROUP BY COALESCE(NULLIF(requested_person, ''), NULLIF(sales_person, ''), 'Unassigned')
    ORDER BY openTickets DESC, totalTickets DESC, staffName ASC
    LIMIT ${limitSql(params.limit, 25)}
  `;

  return executeRows(sql, roleScope.params);
}

export async function getMostCommonIssues(params: SafeQueryOptions = {}): Promise<QueryRow[]> {
  const roleScope = applyRoleScope(params.user);
  const sql = `
    SELECT
      COALESCE(NULLIF(issue_description, ''), NULLIF(comment, ''), NULLIF(implementation_type, ''), 'Unspecified') AS issue,
      COUNT(*) AS totalRecords,
      SUM(CASE WHEN LOWER(COALESCE(job_status, status, '')) NOT IN ('completed', 'won', 'lost', 'duplicate', 'deleted', 'solved') THEN 1 ELSE 0 END) AS openRecords
    FROM service_requests
    WHERE 1 = 1
      ${visibleTicketSql()}
      ${dateRangeSql(params.dateRange)}
      ${roleScope.sql}
    GROUP BY COALESCE(NULLIF(issue_description, ''), NULLIF(comment, ''), NULLIF(implementation_type, ''), 'Unspecified')
    ORDER BY totalRecords DESC, openRecords DESC
    LIMIT ${limitSql(params.limit, 20)}
  `;

  return executeRows(sql, roleScope.params);
}

export async function getCustomerWithMostRequests(params: SafeQueryOptions = {}): Promise<QueryRow[]> {
  const roleScope = applyRoleScope(params.user);
  const sql = `
    SELECT
      COALESCE(NULLIF(customer_name, ''), 'Unknown customer') AS customerName,
      COUNT(*) AS totalRecords,
      SUM(CASE WHEN LOWER(COALESCE(job_status, status, '')) NOT IN ('completed', 'won', 'lost', 'duplicate', 'deleted', 'solved') THEN 1 ELSE 0 END) AS openRecords
    FROM service_requests
    WHERE 1 = 1
      ${visibleTicketSql()}
      ${dateRangeSql(params.dateRange)}
      ${roleScope.sql}
    GROUP BY COALESCE(NULLIF(customer_name, ''), 'Unknown customer')
    ORDER BY totalRecords DESC, openRecords DESC
    LIMIT ${limitSql(params.limit, 20)}
  `;

  return executeRows(sql, roleScope.params);
}

export async function getHighestWorkload(params: SafeQueryOptions = {}): Promise<QueryRow[]> {
  return getTechnicianWorkload({ ...params, limit: 1 });
}

export async function getLowestWorkload(params: SafeQueryOptions = {}): Promise<QueryRow[]> {
  const roleScope = applyRoleScope(params.user);
  const sql = `
    SELECT
      COALESCE(NULLIF(requested_person, ''), NULLIF(sales_person, ''), 'Unassigned') AS staffName,
      COUNT(*) AS totalTickets,
      SUM(CASE WHEN LOWER(COALESCE(job_status, status, '')) NOT IN ('completed', 'won', 'lost', 'duplicate', 'deleted', 'solved') THEN 1 ELSE 0 END) AS openTickets
    FROM service_requests
    WHERE 1 = 1
      ${dateRangeSql(params.dateRange)}
      ${roleScope.sql}
    GROUP BY COALESCE(NULLIF(requested_person, ''), NULLIF(sales_person, ''), 'Unassigned')
    ORDER BY openTickets ASC, totalTickets ASC, staffName ASC
    LIMIT ${limitSql(params.limit, 1)}
  `;

  return executeRows(sql, roleScope.params);
}

export async function getStaffPerformance(params: SafeQueryOptions = {}): Promise<QueryRow[]> {
  const roleScope = applyRoleScope(params.user);
  const sql = `
    SELECT
      COALESCE(NULLIF(requested_person, ''), NULLIF(sales_person, ''), 'Unassigned') AS staffName,
      COUNT(*) AS totalRecords,
      SUM(CASE WHEN LOWER(COALESCE(status, job_status, '')) IN ('completed', 'won', 'solved') THEN 1 ELSE 0 END) AS completedRecords,
      SUM(CASE WHEN LOWER(COALESCE(status, job_status, '')) IN ('lost', 'deleted', 'duplicate') THEN 1 ELSE 0 END) AS closedNegativeRecords,
      SUM(CASE WHEN LOWER(COALESCE(status, job_status, '')) NOT IN ('completed', 'won', 'solved', 'lost', 'deleted', 'duplicate') THEN 1 ELSE 0 END) AS activeRecords
    FROM service_requests
    WHERE 1 = 1
      ${dateRangeSql(params.dateRange)}
      ${roleScope.sql}
    GROUP BY COALESCE(NULLIF(requested_person, ''), NULLIF(sales_person, ''), 'Unassigned')
    ORDER BY completedRecords DESC, totalRecords DESC, staffName ASC
    LIMIT ${limitSql(params.limit, 25)}
  `;

  return executeRows(sql, roleScope.params);
}

export async function getDuplicateRequests(params: SafeQueryOptions = {}): Promise<QueryRow[]> {
  const roleScope = applyRoleScope(params.user);
  const sql = `
    SELECT
      LOWER(TRIM(COALESCE(customer_name, ''))) AS customerKey,
      LOWER(TRIM(COALESCE(issue_description, comment, ''))) AS issueKey,
      MIN(id) AS firstId,
      MAX(id) AS latestId,
      COUNT(*) AS duplicateCount,
      MAX(customer_name) AS customerName,
      MAX(issue_description) AS issueDescription,
      MAX(comment) AS comment
    FROM service_requests
    WHERE
      TRIM(COALESCE(customer_name, '')) <> ''
      AND TRIM(COALESCE(issue_description, comment, '')) <> ''
      ${roleScope.sql}
    GROUP BY
      LOWER(TRIM(COALESCE(customer_name, ''))),
      LOWER(TRIM(COALESCE(issue_description, comment, '')))
    HAVING COUNT(*) > 1
    ORDER BY duplicateCount DESC, latestId DESC
    LIMIT ${limitSql(params.limit, 25)}
  `;

  return executeRows(sql, roleScope.params);
}

export async function getDashboardSummary(params: SafeQueryOptions = {}): Promise<QueryRow[]> {
  const roleScope = applyRoleScope(params.user);
  const customerRoleScope = applyCustomerRoleScope(params.user);
  const sql = `
    SELECT
      COUNT(*) AS totalRecords,
      (SELECT COUNT(*) FROM customers c WHERE 1 = 1 ${customerRoleScope.sql}) AS registeredCustomers,
      SUM(CASE WHEN LOWER(COALESCE(job_status, status, '')) NOT IN ('completed', 'won', 'lost', 'duplicate', 'deleted', 'solved') THEN 1 ELSE 0 END) AS openRecords,
      SUM(CASE WHEN LOWER(COALESCE(status, '')) IN ('new lead', 'new') OR LOWER(COALESCE(job_status, '')) = 'new' THEN 1 ELSE 0 END) AS newRecords,
      SUM(CASE WHEN LOWER(COALESCE(status, job_status, '')) IN ('completed', 'won', 'solved') THEN 1 ELSE 0 END) AS completedRecords,
      SUM(COALESCE(new_qty, 0) + COALESCE(migrate_qty, 0) + COALESCE(trading_qty, 0) + COALESCE(service_qty, 0) + COALESCE(other_qty, 0)) AS totalUnits,
      COUNT(DISTINCT customer_name) AS uniqueCustomers
    FROM service_requests
    WHERE 1 = 1
      ${dateRangeSql(params.dateRange)}
      ${roleScope.sql}
  `;

  return executeRows(sql, [...customerRoleScope.params, ...roleScope.params]);
}

export async function getRegionSummary(params: SafeQueryOptions = {}): Promise<QueryRow[]> {
  const roleScope = applyRoleScope(params.user);
  const regionFilter = params.region
    ? "AND LOWER(COALESCE(NULLIF(region, ''), NULLIF(location, ''), 'Unknown')) = ?"
    : "";
  const sql = `
    SELECT
      COALESCE(NULLIF(region, ''), NULLIF(location, ''), 'Unknown') AS region,
      COUNT(*) AS totalRecords,
      SUM(CASE WHEN LOWER(COALESCE(job_status, status, '')) NOT IN ('completed', 'won', 'lost', 'duplicate', 'deleted', 'solved') THEN 1 ELSE 0 END) AS openRecords,
      SUM(COALESCE(new_qty, 0) + COALESCE(migrate_qty, 0) + COALESCE(trading_qty, 0) + COALESCE(service_qty, 0) + COALESCE(other_qty, 0)) AS totalUnits
    FROM service_requests
    WHERE 1 = 1
      ${dateRangeSql(params.dateRange)}
      ${regionFilter}
      ${roleScope.sql}
    GROUP BY COALESCE(NULLIF(region, ''), NULLIF(location, ''), 'Unknown')
    ORDER BY totalRecords DESC, region ASC
    LIMIT ${limitSql(params.limit, 25)}
  `;

  return executeRows(sql, [
    ...(params.region ? [normalizeName(params.region)] : []),
    ...roleScope.params,
  ]);
}

export async function getStatusSummary(params: SafeQueryOptions = {}): Promise<QueryRow[]> {
  const roleScope = applyRoleScope(params.user);
  const sql = `
    SELECT
      COALESCE(NULLIF(status, ''), NULLIF(job_status, ''), 'Unknown') AS status,
      COUNT(*) AS totalRecords
    FROM service_requests
    WHERE 1 = 1
      ${dateRangeSql(params.dateRange)}
      ${roleScope.sql}
    GROUP BY COALESCE(NULLIF(status, ''), NULLIF(job_status, ''), 'Unknown')
    ORDER BY totalRecords DESC, status ASC
    LIMIT ${limitSql(params.limit, 25)}
  `;

  return executeRows(sql, roleScope.params);
}

export async function getDailySummary(params: SafeQueryOptions = {}): Promise<QueryRow[]> {
  const roleScope = applyRoleScope(params.user);
  const sql = `
    SELECT
      CASE
        WHEN created_at IS NULL OR TRIM(created_at) = '' THEN DATE_FORMAT(CURRENT_DATE(), '%Y-%m-%d')
        ELSE TRIM(created_at)
      END AS day,
      COUNT(*) AS totalRecords,
      SUM(CASE WHEN LOWER(COALESCE(status, job_status, '')) IN ('completed', 'won', 'solved') THEN 1 ELSE 0 END) AS completedRecords,
      SUM(CASE WHEN LOWER(COALESCE(job_status, status, '')) NOT IN ('completed', 'won', 'lost', 'duplicate', 'deleted', 'solved') THEN 1 ELSE 0 END) AS openRecords
    FROM service_requests
    WHERE 1 = 1
      ${roleScope.sql}
    GROUP BY CASE
        WHEN created_at IS NULL OR TRIM(created_at) = '' THEN DATE_FORMAT(CURRENT_DATE(), '%Y-%m-%d')
        ELSE TRIM(created_at)
      END
    ORDER BY day DESC
    LIMIT ${limitSql(params.limit, 7)}
  `;

  return executeRows(sql, roleScope.params);
}

export async function getMonthlySummary(params: SafeQueryOptions = {}): Promise<QueryRow[]> {
  const roleScope = applyRoleScope(params.user);
  const sql = `
    SELECT
      LEFT(CASE
        WHEN created_at IS NULL OR TRIM(created_at) = '' THEN DATE_FORMAT(CURRENT_DATE(), '%Y-%m-%d')
        ELSE TRIM(created_at)
      END, 7) AS month,
      COUNT(*) AS totalRecords,
      SUM(CASE WHEN LOWER(COALESCE(status, job_status, '')) IN ('completed', 'won', 'solved') THEN 1 ELSE 0 END) AS completedRecords,
      SUM(CASE WHEN LOWER(COALESCE(job_status, status, '')) NOT IN ('completed', 'won', 'lost', 'duplicate', 'deleted', 'solved') THEN 1 ELSE 0 END) AS openRecords
    FROM service_requests
    WHERE 1 = 1
      ${roleScope.sql}
    GROUP BY LEFT(CASE
        WHEN created_at IS NULL OR TRIM(created_at) = '' THEN DATE_FORMAT(CURRENT_DATE(), '%Y-%m-%d')
        ELSE TRIM(created_at)
      END, 7)
    ORDER BY month DESC
    LIMIT ${limitSql(params.limit, 12)}
  `;

  return executeRows(sql, roleScope.params);
}

export async function getStaffChatHistory(params: ChatHistoryParams = {}): Promise<QueryRow[]> {
  const roleScope = applyChatRoleScope(params.user, params.channelName);
  const sql = `
    SELECT id, role, content, timestamp, username
    FROM messages
    WHERE username LIKE 'staff:%'
      ${roleScope.sql}
    ORDER BY timestamp DESC
    LIMIT ${limitSql(params.limit, 25)}
  `;

  return executeRows(sql, roleScope.params);
}

export async function getGuestChatHistory(params: ChatHistoryParams = {}): Promise<QueryRow[]> {
  const roleScope = applyChatRoleScope(params.user, params.channelName);
  const sql = `
    SELECT id, role, content, timestamp, username
    FROM messages
    WHERE username LIKE 'guest:%'
      ${roleScope.sql}
    ORDER BY timestamp DESC
    LIMIT ${limitSql(params.limit, 25)}
  `;

  return executeRows(sql, roleScope.params);
}

export const formatterExamples = {
  findCustomerByName: "Found 2 customers matching ARKAN ALDAR.",
  getPendingTicketsByStaff: "Athul currently has 8 pending tickets.",
  getOpenTicketsByRegion: "Dubai currently has 12 open tickets.",
  getTechnicianWorkload: "Technician workload summary: Athul: 8 open / 12 total.",
  getDashboardSummary: "Dashboard summary: Total records: 120, Open records: 34.",
};

export const validationRules = {
  noDynamicSql: true,
  noAiGeneratedSql: true,
  maxLimit: MAX_LIMIT,
  requireBackendUser: true,
  staffScope: "requested_person OR sales_person OR created_by must match authenticated staff name",
  guestScope: "created_by must match authenticated guest username",
};

export const queryRegistry = {
  applyRoleScope,
  applyCustomerRoleScope,
  applyChatRoleScope,
  findCustomerByName,
  findCustomerByPhone,
  findCustomerByEmail,
  getCustomerHistory,
  getCustomerFleetSize,
  getCustomerRegion,
  getTicketsByStatus,
  getPendingTickets,
  getOpenTickets,
  getCompletedTickets,
  getLatestRequests,
  getTicketById,
  getTicketsByStatusLabel,
  getCompletedTicketsThisWeek,
  getPendingTicketsByStaff,
  getTicketsByStaff,
  getOpenTicketsByRegion,
  getTicketsByRegion,
  getTicketsByServiceType,
  getTicketsByCustomer,
  getOpenTicketsByCustomer,
  getTicketsByIssue,
  getUnassignedTickets,
  getTicketsNeedingAttention,
  getTechnicianWorkload,
  getMostCommonIssues,
  getCustomerWithMostRequests,
  getHighestWorkload,
  getLowestWorkload,
  getStaffPerformance,
  getDuplicateRequests,
  getDashboardSummary,
  getRegionSummary,
  getStatusSummary,
  getDailySummary,
  getMonthlySummary,
  getStaffChatHistory,
  getGuestChatHistory,
  formatterExamples,
  validationRules,
};

export default queryRegistry;
