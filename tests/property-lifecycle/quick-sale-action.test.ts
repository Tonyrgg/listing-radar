import {beforeEach,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({rpc:vi.fn(),requireUser:vi.fn(),path:vi.fn(),tag:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("next/cache",()=>({revalidatePath:mocks.path,revalidateTag:mocks.tag}));
vi.mock("@/lib/auth",()=>({requireUser:mocks.requireUser,getCurrentUser:async()=>({id:"reviewer"})}));
vi.mock("@/lib/property-lifecycle/read-models/server",()=>({LIFECYCLE_CACHE_TAG:"lifecycle"}));
vi.mock("@/lib/supabase/service",()=>({getSupabaseServiceClient:()=>({rpc:mocks.rpc})}));
import {saveQuickPropertySaleDecision} from "../../app/(private)/lifecycle/actions";
beforeEach(()=>{vi.clearAllMocks();mocks.rpc.mockResolvedValue({data:"decision",error:null});});
function form(){const f=new FormData();f.set("propertyId","property");f.set("saleStatus","SOLD_CONFIRMED");return f;}
it("saves through one atomic RPC and invalidates both archive tabs and the map",async()=>{
 const result=await saveQuickPropertySaleDecision({ok:false,message:""},form());
 expect(result).toMatchObject({ok:true,status:"SOLD_CONFIRMED"});
 expect(mocks.requireUser).toHaveBeenCalled();
 expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("record_radar_sale_decision",expect.objectContaining({p_property_id:"property",p_status:"SOLD_CONFIRMED",p_created_by:"reviewer"}));
 for(const path of ["/intelligence","/map","/casa/property"])expect(mocks.path).toHaveBeenCalledWith(path);
 expect(mocks.tag).toHaveBeenCalledWith("lifecycle",{expire:0});
});
it("keeps the operator's note and reports an unconfirmed save on RPC failure",async()=>{
 mocks.rpc.mockResolvedValue({data:null,error:{message:"failure"}});
 const f=form();f.set("reason","Confermato dal proprietario");
 expect(await saveQuickPropertySaleDecision({ok:false,message:""},f)).toMatchObject({ok:false});
 expect(mocks.rpc.mock.calls[0][1].p_reason).toBe("Confermato dal proprietario");
 expect(mocks.tag).not.toHaveBeenCalled();
});
