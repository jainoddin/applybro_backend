import { dailyProgress } from './daily-progress';
import { hasSubmissionEvidence } from './application-evidence';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { ApplicationStatus, ApplyMode, PortalType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LiveSources, trustedApplicationUrl } from './live-sources';
import { browserJobUrl, CompanionService } from './companion.service';
import { skillMatch,minimumExperience,roleMatches } from './skill-match';

const VERSION = 'official-feed-v1';
const meta = (app: any): any => app.matchReasons && !Array.isArray(app.matchReasons) ? app.matchReasons : {};
const isLive = (app: any) => [VERSION,'browser-listing-v1'].includes(meta(app).version) && browserJobUrl(meta(app).url);

@Injectable()
export class JobsService {
  constructor(private readonly prisma: PrismaService, private readonly sources: LiveSources, private readonly companion:CompanionService) {}

  async getMatchedJobs(userId: string) {
    const apps = await this.prisma.jobApplication.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
    // Legacy generated records are retained for review, but never presented as real jobs or submissions.
    const user=await this.prisma.user.findUnique({where:{id:userId},include:{preferences:true}});
    const live = apps.filter(app=>isLive(app)&&roleMatches(app.jobTitle,user?.preferences?.titles||[])).sort((a,b)=>b.matchScore-a.matchScore);
    const confirmed = apps.filter(app => hasSubmissionEvidence(app));
    const runs:any[]=await this.prisma.$queryRaw`SELECT "applicationId","stage","updatedAt" FROM "BrowserRun" WHERE "userId"=${userId} AND "kind"='APPLY' UNION ALL SELECT "applicationId",CASE "state" WHEN 'QUEUED' THEN 'CREATED' WHEN 'RUNNING' THEN 'OPENED' WHEN 'WAITING_USER' THEN 'REVIEW_REQUIRED' ELSE "state" END AS "stage","updatedAt" FROM "AgentRun" WHERE "userId"=${userId} AND "kind"='APPLY' ORDER BY "updatedAt" DESC`;
    const latest=new Map<string,string>();for(const run of runs)if(run.applicationId&&!latest.has(run.applicationId))latest.set(run.applicationId,run.stage);
    const active=[...latest.values()].filter(stage=>['CREATED','OPENED','SUBMITTING'].includes(stage));
    const needsReview=[...latest.values()].filter(stage=>stage==='REVIEW_REQUIRED').length;
    const unconfirmed=[...latest.values()].filter(stage=>stage==='UNKNOWN').length;
    return {
      jobs: live.map(app => {
        const m = meta(app);
        return { id: app.id, title: app.jobTitle, company: app.companyName,
          companyInitial: app.companyName[0]?.toUpperCase(), location: m.location,
          workMode: /remote/i.test(m.location) ? 'Remote' : 'See job details', portal: app.portal,
          portalLabel: m.source === 'greenhouse' ? 'Greenhouse · Company career page' : m.source==='lever'?'Lever · Company career page':m.source+' · Browser observed',
          salary: 'See employer listing', matchScore: app.matchScore, matchReasons: m.reasons || [], skills: m.skills || [],
          status: confirmed.some(c => c.id === app.id) ? 'APPLIED' : app.status === ApplicationStatus.APPLIED ? 'NEEDS_MANUAL_ACTION' : app.status,
          appliedAt: (m.providerReceipt||m.browserConfirmation||m.agentConfirmation) ? app.appliedAt : null, experienceRequired: 'See employer requirements',
          postedAgo: 'Live employer feed', applicationUrl: m.url, checkedAt: m.checkedAt,
          applicationMode: 'EMPLOYER_FORM',
          confirmationSource: m.providerReceipt?'PROVIDER':m.browserConfirmation?'BROWSER':m.agentConfirmation?'HOSTED_BROWSER':null,
          matchAssessed:m.matchAssessed===true,
        };
      }),
      today: dailyProgress(apps, runs, user?.dailyApplyLimit ?? 5),
      unverifiedRecords: apps.filter(app => app.status === 'APPLIED' && !hasSubmissionEvidence(app)).length,
      stats: { matched: live.length, applied: confirmed.length, inProgress: active.length, needsReview, unconfirmed, completed: confirmed.length },
      autoApplyActive: user?.activeMode==='AUTO_APPLY'&&user?.autoApplyConsent===true,
      portalStatuses: { LinkedIn: 'PARTNER_ACCESS_REQUIRED', Naukri: 'INTEGRATION_UNAVAILABLE', GoogleJobs: 'DISCOVERY_ONLY' },
      message: 'Jobs come from official employer feeds. Complete the application on the employer website. Opening a form does not count as submitted.',
    };
  }

  async discoverMoreJobs(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { preferences: true } });
    if (!user) throw new NotFoundException('User not found');
    const { jobs, warnings } = await this.sources.discover();
    const skills = (user.skills || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    const titles = user.preferences?.titles || [];
    const roleWords = titles.join(' ').toLowerCase().split(/[^a-z0-9+#]+/).filter(w => w.length > 2 && !['senior', 'junior', 'and', 'the'].includes(w));
    const locations = (user.preferences?.locations || []).map(s => s.toLowerCase());
    const ranked = jobs.filter(job => roleMatches(job.title,titles))
      .filter(job => !locations.length || locations.some(location => job.location.toLowerCase().includes(location)) || /remote/i.test(job.location))
      .map(job => {
        const text = `${job.title} ${job.description}`.toLowerCase();
        const match=skillMatch(user.skills||'',text);
        return { job, matched:match.matched, requested:match.requested, score:match.score,minimumYears:minimumExperience(text) };
      }).sort((a, b) => b.score - a.score).slice(0, 50);
    for (const { job, matched, requested, score,minimumYears } of ranked) {
      const id = createHash('sha256').update(`${userId}:${job.key}`).digest('hex');
      const data = { jobTitle: job.title, companyName: job.company, matchScore: score,
        matchReasons: { version: VERSION, key: job.key, url: job.url, source: job.source, location: job.location,
          skills: matched, minimumYears, matchAssessed:requested.length>=3, checkedAt: new Date().toISOString(),
          reasons: [requested.length>=3?`${matched.length} of ${requested.length} recognized technologies in the employer description match your profile`:'Insufficient skill detail to score reliably; review this job manually', 'Keyword coverage estimate only. Review experience and all employer requirements.'] } };
      await this.prisma.jobApplication.upsert({ where: { id },
        create: { id, userId, ...data, portal: PortalType.ATS_DIRECT, applyMode: ApplyMode.ASSISTED_APPLY, status: ApplicationStatus.WAITING_FOR_APPROVAL },
        update: {jobTitle:data.jobTitle,companyName:data.companyName,matchScore:data.matchScore} });
      // Merge public matching facts atomically so a concurrent employer/browser
      // confirmation cannot be overwritten by a discovery refresh.
      await this.prisma.$executeRaw`UPDATE "JobApplication" SET "matchReasons"=COALESCE("matchReasons",'{}'::jsonb) || ${JSON.stringify(data.matchReasons)}::jsonb WHERE "id"=${id} AND "userId"=${userId}`;
    }
    return { ...await this.getMatchedJobs(userId), warnings, discovered: ranked.length,
      message: ranked.length ? 'Live employer jobs loaded. Skill matching is a keyword estimate, not an eligibility guarantee.' : 'No live jobs match your current roles and locations. Adjust preferences or try again later.' };
  }

  async applyJob(userId: string, applicationId: string) {
    const app = await this.prisma.jobApplication.findFirst({ where: { id: applicationId, userId } });
    if (!app || !isLive(app)) throw new NotFoundException('Live employer job not found. Refresh job discovery.');
    const m = meta(app);
    if(m.version==='browser-listing-v1')return {success:false,action:'OPEN_EMPLOYER_FORM',applicationUrl:m.url,message:'Live portal link observed in your browser. Complete the portal application or use the companion; no submission is recorded on opening.'};
    // Recheck the listing in its authoritative feed; never open a stale/removed job as active.
    const current = await this.sources.discover();
    const listing = current.jobs.find(job => job.key === m.key);
    if (!listing) throw new BadRequestException('This listing is unavailable or has closed. Refresh jobs and try another listing.');
    return { success: false, requiresLogin: false, action: 'OPEN_EMPLOYER_FORM', applicationUrl: listing.url,
      message: 'Complete and submit the employer form. ApplyBro has not submitted this application and cannot verify its outcome yet.' };
  }

  async connectPortal(_userId: string, _portal: string) {
    throw new BadRequestException('Verified portal integration is not configured. Signing in on another website cannot connect its browser session to ApplyBro.');
  }
  async runAutoApplyBatch(userId: string) {
    if(process.env.COMPANION_AUTO_APPLY_ENABLED!=='true')return {appliedCount:0,autoApplyActive:false,runs:[],skipped:[],message:'Automatic processing has moved to Hosted Agent. Open /agent to configure server-side processing.'};
    const user=await this.prisma.user.findUnique({where:{id:userId},include:{subscription:true}});
    if(user?.activeMode!=='AUTO_APPLY'||!user.autoApplyConsent)return {appliedCount:0,autoApplyActive:false,runs:[],message:'Enable Auto-Apply in your saved application settings first.'};
    if(!user.subscription?.active || user.subscription.trialEnds<=new Date())throw new BadRequestException('Your plan has expired.');
    const day=new Date(Date.now()+19800000).toISOString().slice(0,10),from=new Date(day+'T00:00:00+05:30');
    const submitted=await this.prisma.jobApplication.findMany({where:{userId,status:'APPLIED',appliedAt:{gte:from}}});
    const sent=submitted.filter(app=>hasSubmissionEvidence(app)).length;
    const remaining=Math.max(0,user.dailyApplyLimit-sent);
    const inFlight:any[]=await this.prisma.$queryRaw`SELECT "id" FROM "BrowserRun" WHERE "userId"=${userId} AND "kind"='APPLY' AND "stage" IN ('OPENED','SUBMITTING') AND "updatedAt" > NOW() - INTERVAL '3 minutes'`;
    if(inFlight.length)return {appliedCount:0,autoApplyActive:true,runs:[],skipped:[],message:'An application step is currently in flight in your browser. Waiting for it to finish.'};
    let data=await this.getMatchedJobs(userId);
    if(!data.jobs.length)data=await this.discoverMoreJobs(userId);
    const inProgress:any[]=await this.prisma.$queryRaw`SELECT "applicationId" FROM "BrowserRun" WHERE "userId"=${userId} AND "stage" IN ('OPENED','SUBMITTING','BROWSER_CONFIRMED') AND "createdAt" > NOW() - INTERVAL '24 hours'`;
    const inProgressIds=new Set(inProgress.map(r=>r.applicationId).filter(Boolean));
    const candidates=data.jobs.filter(job=>job.status!=='APPLIED'&&!inProgressIds.has(job.id)&&job.matchAssessed&&job.matchScore>=user.minMatchScore).slice(0,remaining);
    const runs=[],skipped=[];
    for(const job of candidates){try{runs.push(await this.companion.create(userId,{kind:'APPLY',applicationId:job.id,autoSubmit:true}));}catch(error){skipped.push({jobId:job.id,message:typeof error.message==='string'?error.message:'Could not queue job'});}}
    if(!runs.length&&remaining>0){
      const selected:any[]=await this.prisma.$queryRaw`SELECT "selectedPortals" FROM "User" WHERE "id"=${userId}`;
      const portals=Array.isArray(selected[0]?.selectedPortals)?selected[0].selectedPortals:['LinkedIn','Naukri.com'];
      for(const portal of ['Naukri.com','LinkedIn'].filter(name=>portals.includes(name))){try{runs.push(await this.companion.create(userId,{kind:'DISCOVER',portal,autoDiscover:true}));}catch(error){skipped.push({jobId:portal,message:error.message});}}
    }
    return {appliedCount:0,autoApplyActive:true,runs,skipped,message:runs.length?`${runs.length} browser steps queued. Search pages import jobs, inspect descriptions and prepare eligible applications. Unknown questions pause for review; counts increase only after confirmation.`:'No eligible jobs could be queued. Check match threshold, daily limit and existing browser runs.'};
  }
  async toggleAutoApply(userId: string, enable: boolean) {
    if (enable) {
      const resume = await this.prisma.resume.findFirst({ where: { userId } });
      if (!resume) throw new BadRequestException('Please upload a resume first.');
      await this.prisma.user.update({
        where: { id: userId },
        data: { activeMode: ApplyMode.AUTO_APPLY, autoApplyConsent: true, consentTimestamp: new Date() },
      });
      return { success: true, autoApplyActive: true, activeMode: ApplyMode.AUTO_APPLY };
    }
    await this.prisma.user.update({ where: { id: userId }, data: { activeMode: ApplyMode.APPROVE_FIRST, autoApplyConsent: false } });
    return { success: true, autoApplyActive: false, activeMode: ApplyMode.APPROVE_FIRST };
  }
  async getAppliedJobs(userId: string) {
    const rows = await this.prisma.jobApplication.findMany({ where: { userId, status: ApplicationStatus.APPLIED }, orderBy: { appliedAt: 'desc' } });
    return rows.filter(row => hasSubmissionEvidence(row)).map(row => ({ ...row, portalLabel: meta(row).source,
      status: meta(row).agentConfirmation?'Hosted browser confirmed':'Browser confirmed', appliedAtFormatted: row.appliedAt?.toISOString() || '', mode: row.applyMode }));
  }
}
