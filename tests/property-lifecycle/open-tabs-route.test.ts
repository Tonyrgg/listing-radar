import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openTabSignature } from "../../worker/src/agency-browser/open-tab-contract";
import { POST } from "../../app/api/worker/open-tabs/route";

const mocks = vi.hoisted(() => ({
  publication: vi.fn(), persist: vi.fn(), finalize: vi.fn(),
}));
vi.mock("next/cache", () => ({revalidatePath: vi.fn()}));
vi.mock("@/lib/supabase/service", () => ({
  getSupabaseServiceClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({maybeSingle: mocks.publication}),
        }),
      }),
    }),
  }),
}));
vi.mock("@/lib/property-lifecycle/persistence/repository", () => ({
  PropertyLifecycleRepository: class {
    getAgencyBySlug() { return Promise.resolve({id:"fixture-agency"}); }
    createSyncRun() { return Promise.resolve("fixture-run"); }
    persistObservation = mocks.persist;
    finalizeSyncRun = mocks.finalize;
  },
}));

afterEach(() => {vi.unstubAllEnvs();vi.resetAllMocks();});
const endpoint="https://listing-radar.example.test/api/worker/open-tabs";

function request(body:string,key?:string) {
  const stamp=Date.now().toString();
  return new Request(endpoint,{method:"POST",body,headers:{
    "Content-Length":String(Buffer.byteLength(body)),
    ...(key?{"X-Worker-Time":stamp,"X-Worker-Signature":openTabSignature(key,stamp,body)}:{}),
  }});
}

describe("Acquisizione delle schede già aperte", () => {
  it("rifiuta input senza firma o con una firma diversa", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY","fixture-key");
    expect((await POST(request("{}"))).status).toBe(401);
    expect((await POST(request("{}","other-key"))).status).toBe(401);
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it.each([
    "https://studisantiimmobiliare.it/it/Vendite/bitonto/appartamento/v000797/3902/",
    "http://studisantiimmobiliare.it/it/Vendite/bitonto/appartamento/v000797/3902/",
    "https://studisantiimmobiliare.it/it/Vendite/",
  ])("salva la scheda Studi Santi con canonical %s quando il riferimento coincide", async declaredUrl => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY","fixture-key");
    mocks.publication.mockResolvedValue({data:null,error:null});
    mocks.persist.mockResolvedValue({createdPublication:true,identityDecision:{outcome:"NEW_PROPERTY"}});
    mocks.finalize.mockResolvedValue(undefined);
    const html=await readFile("tests/fixtures/property-lifecycle/studisanti-active-detail.html","utf8");
    const canonical=html.match(/https?:\/\/[^"\s]+\/it\/Vendite\/bitonto\/[^"\s<>]+/i)?.[0];
    expect(canonical).toBeTruthy();
    const url=canonical!.replace("://studisantiimmobiliare.it","://www.studisantiimmobiliare.it").replace(/\/$/,"");
    const declaredHtml = html.replaceAll(canonical!, declaredUrl);
    const acquisitionId = "31ffba37-5b09-4283-8df6-eb17fbf09629";
    const result=await POST(request(JSON.stringify({acquisitionId,captures:[{url,html:declaredHtml,capturedAt:new Date().toISOString()}]}),"fixture-key"));
    expect(await result.json()).toEqual({results:[{url,state:"new"}]});
    expect(mocks.persist).toHaveBeenCalledOnce();
    expect(mocks.finalize).toHaveBeenCalledWith(expect.objectContaining({inventoryComplete:false,absenceEvaluationAllowed:false,diagnostics:expect.objectContaining({acquisitionId,created:1})}));
  });

  it("rifiuta il canonical di un altro annuncio e non scrive nell’archivio", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY","fixture-key");
    const html = await readFile("tests/fixtures/property-lifecycle/studisanti-active-detail.html","utf8");
    const url = "https://www.studisantiimmobiliare.it/it/Vendite/bitonto/appartamento/v000779/3881";
    const response = await POST(request(JSON.stringify({captures:[{url,html,capturedAt:new Date().toISOString()}]}),"fixture-key"));
    expect(await response.json()).toEqual({results:[{url,state:"review",message:"La pagina dichiara il codice di un altro annuncio."}]});
    expect(mocks.persist).not.toHaveBeenCalled();
  });
});
