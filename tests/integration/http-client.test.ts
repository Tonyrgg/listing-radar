import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HttpClient, parseHtml, parseJson } from "@/lib/http/client";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((request, response) => {
    if (request.url === "/slow") {
      setTimeout(() => {
        response.writeHead(200, { "Content-Type": "text/plain" });
        response.end("slow");
      }, 100);
      return;
    }

    if (request.method === "POST") {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        response.setHeader("Content-Type", "application/json");
        response.writeHead(200);
        response.end(JSON.stringify({ body }));
      });
      return;
    }

    response.setHeader("Last-Modified", "Wed, 21 Oct 2015 07:28:00 GMT");
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    if (request.method === "HEAD") {
      response.writeHead(200);
      response.end();
      return;
    }

    response.writeHead(200);
    response.end('<main data-testid="fixture">Listing fixture</main>');
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("The HTTP fixture did not expose a TCP address");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("HTTP client readiness", () => {
  it("supports GET, HTML parsing, JSON parsing, and response headers", async () => {
    const client = new HttpClient({ retries: 0, timeoutMs: 1_000 });
    const response = await client.get(`${baseUrl}/fixture`);

    expect(response.ok).toBe(true);
    expect(response.headers.get("last-modified")).toBe("Wed, 21 Oct 2015 07:28:00 GMT");
    expect(parseHtml(response.body)("[data-testid=fixture]").text()).toBe("Listing fixture");
    expect(parseJson<{ ready: boolean }>(JSON.stringify({ ready: true }))).toEqual({ ready: true });
  });

  it("supports HEAD and exposes headers without downloading a body", async () => {
    const response = await new HttpClient({ retries: 0 }).head(`${baseUrl}/fixture`);

    expect(response.status).toBe(200);
    expect(response.body).toBe("");
    expect(response.headers.get("last-modified")).toBe("Wed, 21 Oct 2015 07:28:00 GMT");
  });

  it("supports form-encoded POST requests", async () => {
    const response = await new HttpClient({
      retries: 0,
      headers: { "content-type": "application/x-www-form-urlencoded" },
    }).post(`${baseUrl}/fixture`, new URLSearchParams({ action: "read", id: "50" }));

    expect(parseJson<{ body: string }>(response.body)).toEqual({ body: "action=read&id=50" });
  });

  it("turns a timeout into a controlled error", async () => {
    await expect(new HttpClient({ retries: 0, timeoutMs: 20 }).get(`${baseUrl}/slow`)).rejects.toThrow("timed out");
  });
});
