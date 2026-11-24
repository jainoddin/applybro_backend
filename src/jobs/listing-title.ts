// Portal action labels can link back to a selected job. They are not titles.
export function validListingTitle(value:unknown):value is string{
 if(typeof value!=='string'||!value.trim())return false;
 const title=value.replace(/\s+/g,' ').trim();
 if(/^(?:use ai to assess how you fit|about the job|about this job|your profile and resume|how you match|meet the hiring team)(?:\b|$)/i.test(title))return false;
 if(/^\d+\s+(?:new\s+)?notifications?(?:\s+total)?[.!]?$/i.test(title))return false;
 return !/^(?:(?:share|send|give|provide)\s+(?:(?:negative|positive|your)\s+)?feedback|feedback|more(?: options)?|report(?: this)? job|save(?: this)? job|dismiss(?: this)? job|apply(?: now)?|easy apply|show (?:more|all)|see (?:more|all))[.!?…]?$/i.test(title);
}

// A portal hostname is source metadata, not an observed employer name.
export function observedCompany(value:unknown):string{
 if(typeof value!=='string')return '';
 const name=value.replace(/\s+/g,' ').trim().slice(0,150);
 return /^(?:(?:www\.)?(?:linkedin|naukri)\.com|google for jobs(?: \(ats\))?|ats(?:_direct)?)$/i.test(name)?'':name;
}
