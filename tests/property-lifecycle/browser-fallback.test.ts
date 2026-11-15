import { afterEach, expect, it, vi } from "vitest";
import { HttpClient } from "@/lib/http/client";
import { BrowserFallbackHttpClient, readSourceInBrowser } from "@/lib/http/browser-fallback";
const response = (status: number) => ({ status, ok: status === 200, url: "https://www.casa.it/srp/", body: "content", headers: new Headers() });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
it("uses HTTP first and only renders an access-denied response when explicitly enabled", async () => {
 vi.stubEnv("LIFECYCLE_BROWSER_SOURCES", "true");
 const get = vi.spyOn(HttpClient.prototype, "get").mockResolvedValue(response(200));
 const render = vi.fn().mockResolvedValue(response(200));
 const http = new BrowserFallbackHttpClient({}, render);
 await http.get("https://www.casa.it/srp/"); expect(render).not.toHaveBeenCalled();
 get.mockResolvedValue(response(403));
 expect((await http.get("https://www.casa.it/srp/")).status).toBe(200); expect(render).toHaveBeenCalledTimes(1);
 vi.stubEnv("LIFECYCLE_BROWSER_SOURCES", "false");
 expect((await http.get("https://www.casa.it/srp/")).status).toBe(403); expect(render).toHaveBeenCalledTimes(1);
});
it("preserves denied responses and reports unavailable browser without fabricating success", async () => {
 vi.stubEnv("LIFECYCLE_BROWSER_SOURCES", "true");
 vi.spyOn(HttpClient.prototype, "get").mockResolvedValue(response(403));
 const render = vi.fn().mockResolvedValue(response(403)); const http = new BrowserFallbackHttpClient({}, render);
 expect((await http.get("https://www.casa.it/srp/")).headers.get("x-listing-radar-browser")).toBe("http-403");
 render.mockRejectedValue(new Error("Browser missing"));
 const failed = await http.get("https://www.casa.it/srp/"); expect(failed.ok).toBe(false); expect(failed.status).toBe(403);
});
it("rejects arbitrary targets before launching Chromium", async () => {
 await expect(readSourceInBrowser("http://127.0.0.1/admin")).rejects.toThrow("outside allowed");
 await expect(readSourceInBrowser("https://www.casa.it.attacker.test/")).rejects.toThrow("outside allowed");
});
