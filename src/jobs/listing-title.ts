// Portal action labels can link back to a selected job. They are not titles.
export function validListingTitle(value:unknown):value is string{
 if(typeof value!=='string'||!value.trim())return false;
 const title=value.replace(/\s+/g,' ').trim();
 if(/^\d+\s+(?:new\s+)?notifications?(?:\s+total)?[.!]?$/i.test(title))return false;
 return !/^(?:(?:share|send|give|provide)\s+(?:(?:negative|positive|your)\s+)?feedback|feedback|more(?: options)?|report(?: this)? job|save(?: this)? job|dismiss(?: this)? job|apply(?: now)?|easy apply|show (?:more|all)|see (?:more|all))[.!?…]?$/i.test(title);
}
