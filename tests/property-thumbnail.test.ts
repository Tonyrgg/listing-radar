import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../app/api/property-thumbnail/route";

const { requireUser } = vi.hoisted(() => ({ requireUser: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUser }));

const path = `1f20cfb4-eae9-4329-adc9-6d2f7f8dd548/preview-640-${"a".repeat(64)}.webp`;
const request = (value: string) => new Request(`https://radar.test/api/property-thumbnail?${new URLSearchParams({ path: value })}`);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe("foto archiviate nelle tabelle", () => {
  it("legge la miniatura privata dal bucket previsto e restituisce i byte sullo stesso dominio", async () => {
    requireUser.mockResolvedValue({ id: "operator" });
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://storage.test");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-only");
    const fetch = vi.fn(async () => new Response("test image", { headers: { "Content-Type": "image/webp" } }));
    vi.stubGlobal("fetch", fetch);
    const response = await GET(request(path));
    expect(fetch).toHaveBeenCalledWith(new URL(`https://storage.test/storage/v1/object/authenticated/property-lifecycle-visuals/${path}`), expect.objectContaining({ redirect: "error" }));
    expect(response.headers.get("Cache-Control")).toMatch(/^private/);
    expect(await response.text()).toBe("test image");
  });

  it("rifiuta gli oggetti fuori dal formato previsto e chi non è autenticato", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect((await GET(request("../other-bucket/file.webp"))).status).toBe(400);
    expect((await GET(request(path))).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });
});
