const groups:Record<string,string[]>={
 React:['react','react.js','reactjs'],NextJS:['next.js','nextjs'],TypeScript:['typescript'],NodeJS:['node.js','nodejs'],Express:['express.js','expressjs'],PostgreSQL:['postgresql','postgres'],MongoDB:['mongodb','mongo db'],JavaScript:['javascript','ecmascript'],Tailwind:['tailwind','tailwind css'],REST:['restful','rest api','rest apis'],Rust:['rust'],Redux:['redux','redux toolkit'],Git:['git'],Python:['python'],Java:['java'],Go:['golang'],Kubernetes:['kubernetes','k8s'],Docker:['docker'],AWS:['aws','amazon web services'],Azure:['azure'],GCP:['gcp','google cloud'],SQL:['sql'],Redis:['redis'],GraphQL:['graphql'],HTML:['html','html5'],CSS:['css','css3'],Vue:['vue.js','vuejs'],Angular:['angular'],CSharp:['c#','csharp'],DotNet:['.net','dotnet'],Ruby:['ruby'],PHP:['php'],Swift:['swift'],Kotlin:['kotlin'],Django:['django'],Spring:['spring boot'],Terraform:['terraform']
};
const contains=(text:string,alias:string)=>new RegExp('(^|[^a-z0-9])'+alias.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?=$|[^a-z0-9])','i').test(text);
export function skillMatch(profile:string,description:string){
 const requested=Object.keys(groups).filter(key=>groups[key].some(alias=>contains(description,alias)));
 const matched=requested.filter(key=>groups[key].some(alias=>contains(profile,alias)));
 return {score:requested.length>=3?Math.round(100*matched.length/requested.length):0,matched,requested};
}
export function roleMatches(title:string,preferences:string[]){
 if(!preferences.length)return true;
 const desired=preferences.join(' ').toLowerCase(),job=title.toLowerCase();
 const specialties=[/machine learning|\bml\b|data scien/,/security|cyber/,/systems engineer|infrastructure|site reliability|\bsre\b/,/hardware|firmware|embedded/];
 if(specialties.some(pattern=>pattern.test(job)&&!pattern.test(desired)))return false;
 const families=[/front[ -]?end|react|\bui\b|\bweb\b/,/back[ -]?end|\bnode\b/,/full[ -]?stack/,/mobile|android|\bios\b|flutter/,/software|\bsde\b|member of technical staff|product engineer/];
 const selected=families.filter(pattern=>pattern.test(desired));
 if(selected.length)return selected.some(pattern=>pattern.test(job));
 const words=desired.split(/[^a-z0-9]+/).filter(word=>word.length>2);return words.some(word=>job.includes(word));
}
export function minimumExperience(description:string){
 const match=/(?:at least|minimum(?: of)?|min\.?|requires?)\s+(\d{1,2})(?:\s*[-–]\s*\d{1,2})?\+?\s*(?:years?|yrs?)/i.exec(description);
 return match?Number(match[1]):null;
}
