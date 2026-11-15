export function isRentalOnlyOffer(input:{title?:unknown;description?:unknown}):boolean{
 const title=typeof input.title==="string"?input.title:"",body=typeof input.description==="string"?input.description:"";
 if(/\b(?:affitto|affittasi|fittasi|locazione)\b/i.test(title)&&!/\b(?:vendo|vendesi|vendita)\b/i.test(title))return true;
 const sale=/\b(?:vendo|vendesi|vendiamo|vendita|si vende)\b/i.test(body)||/\b(?:vendo|vendesi)\b/i.test(title);
 if(sale)return false;
 return /\b(?:affitto|affittasi|fittasi|locazione)\b/i.test(title)
  ||/(?:^|[.!?\n])\s*(?:affitto|fitto|affittasi|fittasi|si affitta|si fitta)\b/i.test(body)
  ||/\b(?:propongo|proponiamo|offro|offriamo|disponibile|concedo)\s+(?:in\s+)?(?:affitto|locazione)\b/i.test(body)
  ||/\bcanone\b[^.!?\n]{0,40}\b(?:mensile|locazione|mese)\b/i.test(body);
}
