import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";

export const PAGE_SIZE = 50;
const timezone = process.env.APP_TIMEZONE || "Asia/Kolkata";

type JobRow = RowDataPacket & {
  id: number;
  jobId: string | null;
  jobTitle: string | null;
  companyName: string | null;
  companyLogo: string | null;
  companyLocation: string | null;
  jobLocation: string | null;
  jobType: string | null;
  skills: unknown;
  jobSource: string | null;
  category: string | null;
  jobUrl: string | null;
  createdAt: Date | string | null;
};

export type Job = Omit<JobRow, "skills" | "createdAt"> & { skills: string[]; createdAt: string | null };
export type Breakdown = { source: string; category: string; count: number };

declare global {
  // Keeps one pool per warm Vercel function instance during development and production.
  var jobMonitorPool: Pool | undefined;
}

function getPool(): Pool {
  if (global.jobMonitorPool) return global.jobMonitorPool;
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) throw new Error("DATABASE_URL is not configured.");

  // Python SQLAlchemy URLs use mysql+pymysql; mysql2 expects mysql.
  const url = new URL(rawUrl.replace(/^mysql\+pymysql:/, "mysql:"));
  global.jobMonitorPool = mysql.createPool({
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)),
    waitForConnections: true,
    connectionLimit: 3,
    enableKeepAlive: true,
    ssl: process.env.DATABASE_SSL === "false" ? undefined : { rejectUnauthorized: false },
  });
  return global.jobMonitorPool;
}

function todayInTimezone(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date())
    .split("/")
    .reverse()
    .join("-");
}

function addDays(day: string, days: number): string {
  const value = new Date(`${day}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function bounds(day: string): [string, string] {
  return [`${day} 00:00:00`, `${addDays(day, 1)} 00:00:00`];
}

function serialiseJob(row: JobRow): Job {
  let skills: string[] = [];
  if (Array.isArray(row.skills)) skills = row.skills.map(String);
  else if (typeof row.skills === "string") {
    try {
      const parsed = JSON.parse(row.skills);
      skills = Array.isArray(parsed) ? parsed.map(String) : [row.skills];
    } catch {
      skills = [row.skills];
    }
  }
  return { ...row, skills, createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null };
}

export async function getDashboard(input: { date?: string; source?: string; q?: string; page?: string | number }) {
  const today = todayInTimezone();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(input.date || "") ? input.date! : today;
  const source = input.source?.trim() || "";
  const q = input.q?.trim() || "";
  const page = Math.max(Number(input.page) || 1, 1);
  const [start, end] = bounds(date);
  const pool = getPool();

  const dayParams: unknown[] = [start, end];
  const filters = ["createdAt >= ?", "createdAt < ?"];
  if (source) {
    filters.push("COALESCE(jobSource, 'Unknown') = ?");
    dayParams.push(source);
  }
  const summaryWhere = filters.join(" AND ");
  const jobFilters = [...filters];
  const jobParams = [...dayParams];
  if (q) {
    jobFilters.push("(jobTitle LIKE ? OR companyName LIKE ? OR jobLocation LIKE ?)");
    const term = `%${q}%`;
    jobParams.push(term, term, term);
  }
  const jobsWhere = jobFilters.join(" AND ");

  const [[todayCountRow]] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) AS count FROM `Job` WHERE createdAt >= ? AND createdAt < ?", bounds(today));
  const yesterday = addDays(today, -1);
  const [[yesterdayCountRow]] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) AS count FROM `Job` WHERE createdAt >= ? AND createdAt < ?", bounds(yesterday));
  const [[totalRow]] = await pool.query<RowDataPacket[]>(`SELECT COUNT(*) AS count FROM \`Job\` WHERE ${jobsWhere}`, jobParams);
  const [jobRows] = await pool.query<JobRow[]>(
    `SELECT id, jobId, jobTitle, companyName, companyLogo, companyLocation, jobLocation, jobType, skills, jobSource, category, jobUrl, createdAt
     FROM \`Job\` WHERE ${jobsWhere} ORDER BY createdAt DESC, id DESC LIMIT ? OFFSET ?`,
    [...jobParams, PAGE_SIZE, (page - 1) * PAGE_SIZE],
  );
  const [sourceRows] = await pool.query<RowDataPacket[]>(
    "SELECT DISTINCT COALESCE(jobSource, 'Unknown') AS source FROM `Job` WHERE createdAt >= ? AND createdAt < ? ORDER BY source",
    [start, end],
  );
  const [breakdown] = await pool.query<Breakdown[]>(
    `SELECT COALESCE(jobSource, 'Unknown') AS source, COALESCE(category, 'General') AS category, COUNT(*) AS count
     FROM \`Job\` WHERE ${summaryWhere} GROUP BY jobSource, category ORDER BY count DESC, source, category`,
    dayParams,
  );

  return {
    jobs: jobRows.map(serialiseJob), total: Number(totalRow.count), sources: sourceRows.map((row) => String(row.source)), breakdown,
    today, yesterday, todayCount: Number(todayCountRow.count), yesterdayCount: Number(yesterdayCountRow.count),
    date, source, q, page, timezone,
  };
}
