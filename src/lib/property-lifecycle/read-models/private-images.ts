/** Only gallery assets, never a portal's loading/no-photo illustration. */
export function privateGalleryImages(value:unknown):string[]{
 if(!Array.isArray(value))return [];
 return [...new Set(value.filter((item):item is string=>{
  if(typeof item!=="string")return false;
  try{const url=new URL(item);return url.protocol==="https:"&&!/\.(?:svg|gif)(?:$|\?)|(?:no[_-]?photo|no[_-]?image|placeholder|spacer|loading)/i.test(url.pathname);}catch{return false;}
 }))].slice(0,8);
}
