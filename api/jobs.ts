import type { VercelRequest, VercelResponse } from "@vercel/node";
import mysql, { type Pool } from "mysql2/promise";

type Job = {
  id: number;
  jobId: string | null;
  jobTitle: string | null;
  companyName: string | null;
  companyLogo: string | null;
  companyLocation: string | null;
  jobLocation: string | null;
  jobType: string | null;
  yearOfExperience: string | null;
  skills: unknown;
  jobPostTime: string | null;
  jobDescription: string | null;
  salary: string | null;
  jobSource: string | null;
  category: string | null;
  jobUrl: string | null;
  country: string | null;
  createdAt: string | null;
};

let pool: Pool | undefined;

function getPool(): Pool {
  if (pool) return pool;
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) throw new Error("DATABASE_URL is not configured");
  // SQLAlchemy calls this driver mysql+pymysql; Node's mysql2 uses mysql.
  const connectionUrl = rawUrl.replace(/^mysql\+pymysql:\/\//, "mysql://");
  pool = mysql.createPool(connectionUrl);
  return pool;
}

function dateInKolkata(offsetDays = 0): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: process.env.APP_TIMEZONE || "Asia/Kolkata",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value || "";
  const localMidnight = new Date(`${part("year")}-${part("month")}-${part("day")}T00:00:00Z`);
  localMidnight.setUTCDate(localMidnight.getUTCDate() + offsetDays);
  return localMidnight.toISOString().slice(0, 10);
}

function isDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function nextDay(day: string): string {
  const value = new Date(`${day}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const requestedDate = typeof req.query.date === "string" && req.query.date.trim() !== "" ? req.query.date.trim() : dateInKolkata();
  if (!isDate(requestedDate)) return res.status(400).json({ error: "date must be YYYY-MM-DD" });
  const source = typeof req.query.source === "string" ? req.query.source.trim() : "";
  const country = typeof req.query.country === "string" ? req.query.country.trim() : "";
  const search = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "";
  const requestedPage = Number(typeof req.query.page === "string" ? req.query.page : 1);
  const page = Number.isSafeInteger(requestedPage) ? Math.max(requestedPage, 1) : 1;
  const pageSize = 50;
  const start = `${requestedDate} 00:00:00`;
  const end = `${nextDay(requestedDate)} 00:00:00`;
  const filters = ["`createdAt` >= ?", "`createdAt` < ?"];
  const filterParams: (string | number)[] = [start, end];
  if (source) { filters.push("COALESCE(`jobSource`, 'Unknown') = ?"); filterParams.push(source); }
  if (country) { filters.push("COALESCE(`country`, 'Unknown') = ?"); filterParams.push(country); }
  if (search) {
    const term = `%${search}%`;
    filters.push("(`jobTitle` LIKE ? OR `companyName` LIKE ? OR `jobLocation` LIKE ?)");
    filterParams.push(term, term, term);
  }
  const where = filters.join(" AND ");

  try {
    const db = getPool();
    const [[{ total }]] = await db.query<mysql.RowDataPacket[]>(`SELECT COUNT(*) AS total FROM \`Job\` WHERE ${where}`, filterParams);
    const [jobs] = await db.query<mysql.RowDataPacket[]>(
      `SELECT \`id\`, \`jobId\`, \`jobTitle\`, \`companyName\`, \`companyLogo\`, \`companyLocation\`, \`jobLocation\`, \`jobType\`, \`yearOfExperience\`, \`skills\`, \`jobPostTime\`, \`jobDescription\`, \`salary\`, \`jobSource\`, \`category\`, \`jobUrl\`, \`country\`, \`createdAt\`
       FROM \`Job\` WHERE ${where} ORDER BY \`createdAt\` DESC, \`id\` DESC LIMIT ? OFFSET ?`,
      [...filterParams, pageSize, (page - 1) * pageSize],
    );
    const [sources] = await db.query<mysql.RowDataPacket[]>(
      "SELECT DISTINCT COALESCE(`jobSource`, 'Unknown') AS source FROM `Job` WHERE `createdAt` >= ? AND `createdAt` < ? ORDER BY source",
      [start, end],
    );
    const [countries] = await db.query<mysql.RowDataPacket[]>(
      "SELECT DISTINCT COALESCE(`country`, 'Unknown') AS country FROM `Job` WHERE `createdAt` >= ? AND `createdAt` < ? ORDER BY country",
      [start, end],
    );
    const breakdownFilters = ["`createdAt` >= ?", "`createdAt` < ?"];
    const breakdownParams: string[] = [start, end];
    if (source) { breakdownFilters.push("COALESCE(`jobSource`, 'Unknown') = ?"); breakdownParams.push(source); }
    if (country) { breakdownFilters.push("COALESCE(`country`, 'Unknown') = ?"); breakdownParams.push(country); }
    const [breakdown] = await db.query<mysql.RowDataPacket[]>(
      `SELECT COALESCE(\`jobSource\`, 'Unknown') AS source, COALESCE(\`category\`, 'General') AS category, COUNT(*) AS count
       FROM \`Job\` WHERE ${breakdownFilters.join(" AND ")} GROUP BY \`jobSource\`, \`category\` ORDER BY count DESC, source, category`,
      breakdownParams,
    );
    const [countryBreakdown] = await db.query<mysql.RowDataPacket[]>(
      `SELECT COALESCE(\`country\`, 'Unknown') AS country, COUNT(*) AS count
       FROM \`Job\` WHERE \`createdAt\` >= ? AND \`createdAt\` < ? GROUP BY \`country\` ORDER BY count DESC`,
      [start, end],
    );
    const today = dateInKolkata();
    const yesterday = dateInKolkata(-1);
    const [[todayRow]] = await db.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS count FROM `Job` WHERE `createdAt` >= ? AND `createdAt` < ?", [`${today} 00:00:00`, `${nextDay(today)} 00:00:00`]);
    const [[yesterdayRow]] = await db.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS count FROM `Job` WHERE `createdAt` >= ? AND `createdAt` < ?", [`${yesterday} 00:00:00`, `${today} 00:00:00`]);

    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60");
    return res.status(200).json({ date: requestedDate, today, yesterday, total: Number(total), page, pageSize, jobs: jobs as Job[], sources: sources.map((row) => row.source), countries: countries.map((row) => row.country), breakdown, countryBreakdown, todayCount: Number(todayRow.count), yesterdayCount: Number(yesterdayRow.count) });
  } catch (error) {
    console.error("Job monitor database error", error);
    return res.status(500).json({ error: "Unable to load jobs. Check the Vercel DATABASE_URL setting." });
  }
}
