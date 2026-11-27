import {describe,expect,it} from "vitest";
import {nextPropertyCheck} from "../../src/lib/property-lifecycle/read-models/next-check";

describe("controllo suggerito nel registro e nel dossier",()=>{
 const base={hasAgency:true};
 it("dà priorità all’esito rispetto al civico e alla data",()=>{
   expect(nextPropertyCheck({...base,classification:"UNKNOWN_EXIT"}).label).toBe("Verifica l’esito");
   expect(nextPropertyCheck({...base,saleStatus:"SOLD_CONFIRMED"}).label).toBe("Consulta la vendita");
 });
 it("un pin preciso da solo lascia aperta la verifica del civico",()=>{
   expect(nextPropertyCheck({...base,precision:"EXACT_COORDINATES"}).label).toBe("Individua il civico");
 });
 it("chiede la data solo dopo avere identificato l’indirizzo e l’agenzia",()=>{
   const facts={...base,civic:"16",precision:"EXACT_ADDRESS"};
   expect(nextPropertyCheck(facts).label).toBe("Verifica la data in agenzia");
   expect(nextPropertyCheck({...facts,hasAgency:false}).target).toBe("storico");
 });
});
