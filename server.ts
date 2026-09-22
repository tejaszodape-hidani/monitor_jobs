/** Local development server for the same Vercel API and static dashboard. */
import "dotenv/config";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join, normalize } from "node:path";
import handler from "./api/jobs.ts";

const port = Number(process.env.PORT || 3000);
const publicDirectory = join(process.cwd(), "public");

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function serveStatic(pathname: string, response: ServerResponse) {
  const safePath = pathname === "/" ? "index.html" : normalize(pathname).replace(/^([/\\])+/, "");
  const filePath = join(publicDirectory, safePath);
  if (!filePath.startsWith(publicDirectory)) return sendJson(response, 403, { error: "Forbidden" });
  try {
    const file = await stat(filePath);
    if (!file.isFile()) return sendJson(response, 404, { error: "Not found" });
    response.writeHead(200, { "Content-Type": filePath.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream" });
    createReadStream(filePath).pipe(response);
  } catch {
    sendJson(response, 404, { error: "Not found" });
  }
}

createServer(async (request: IncomingMessage, response: ServerResponse) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  if (url.pathname === "/api/jobs") {
    const query = Object.fromEntries(url.searchParams.entries());
    const vercelResponse = {
      status: (code: number) => ({ json: (body: unknown) => sendJson(response, code, body) }),
      setHeader: (name: string, value: string) => response.setHeader(name, value),
    };
    await handler({ method: request.method, query } as never, vercelResponse as never);
    return;
  }
  await serveStatic(url.pathname, response);
}).listen(port, () => {
  console.log(`Job Monitor is running at http://localhost:${port}`);
});
