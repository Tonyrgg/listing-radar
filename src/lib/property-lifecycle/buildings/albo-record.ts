import {hashValue} from '@/lib/property-lifecycle/contracts/normalized-listing';
import {parseAlboDetail,type AlboItem} from './albo';
import {extractTerritorialReferences,extractDeclaredCadastralReferences,type RegistryStreet} from './territorial-extraction';
import {PUBLIC_RECORD_POLICY as P,RECORD_TYPES,classifyPublicRecord,territorialSignalType,judicialArchiveOnly} from './public-record-policy';
import {extractAdministrativeIdentity} from './practice-documents';
export function prepareAlboRecord(item:AlboItem,detail:ReturnType<typeof parseAlboDetail>,streets:RegistryStreet[],observedAt:string){
      const archiveOnly=judicialArchiveOnly(detail.subject);
      const territories=archiveOnly?[]:extractTerritorialReferences(detail.subject,streets), type=classifyPublicRecord(detail.subject,item.category);
      const addresses=territories.flatMap(r=>r.civics.map((n,i)=>({displayName:`${r.streetName} ${n}, ${r.locality}`,streetName:r.streetName,streetNumber:n,locality:r.locality,normalizedKey:r.normalizedKeys[i]})).filter(a=>a.normalizedKey));
      const area=/\bMARIOTTO\b/i.test(detail.subject)?"Mariotto":/\bPALOMBAIO\b/i.test(detail.subject)?"Palombaio":territories.length?null:"Bitonto";
      // Generated from administrative fields + recognized streets only. Never store person/company names from free text.
      const title=`${RECORD_TYPES[type.type]} · ${item.act}${territories.length?` · ${[...new Set(territories.map(r=>r.streetName+(r.civicText?` ${r.civicText}`:"")))].join("; ")}`:area?` · ${area}`:""}`;
      const subject=RECORD_TYPES[type.type]+(territories.length?" riferito ai luoghi dichiarati nell’atto.":" con contesto comunale; localizzazione puntuale non verificata.");
      const payload={title,subject,addresses,cadastralReferences:archiveOnly?[]:extractDeclaredCadastralReferences(detail.subject),territorialReferences:territories,sourceStatus:detail.status,
        originalMetadataHash:hashValue({item,detail}),documentUrls:detail.documents,documentDate:detail.documentDate,actDate:detail.actDate,
        publicationStart:detail.start??item.start,publicationEnd:detail.end??item.end,office:detail.office,
        classification:type,unitMatch:"REVIEW_REQUIRED",administrativeReferences:extractAdministrativeIdentity(detail.subject),
        ...(judicialArchiveOnly(detail.subject)?{treatment:"ARCHIVE_ONLY_JUDICIAL"}:{})};
      return {sourceRecordKey:item.id,title,subject,recordType:type.type,practiceNumber:item.act,year:item.act.match(/^\d{4}/)?.[0]??null,
        sourceUrl:item.url,documentUrl:detail.documents[0]??null,documentUrls:detail.documents,documentDate:detail.documentDate,
        publicationStart:detail.start??item.start,publicationEnd:detail.end??item.end,office:detail.office,sourceStatus:detail.status,
        areaName:area,classificationConfidence:type.confidence,classificationVersion:type.version,signalType:territorialSignalType(type.type),
        territorialReferences:territories,sanitizedPayload:payload,contentHash:hashValue(payload),
        metadata:{policyVersion:P.version,inventoryMarker:item.marker,detailObservedAt:observedAt,originalTitleNotStored:true,pdfDownloaded:false,
          precision:addresses.length?"BUILDING":territories.length?"STREET":"ZONE",unitMatch:"REVIEW_REQUIRED",cadastralIdentity:"NOT_ASSERTED"}};
}
