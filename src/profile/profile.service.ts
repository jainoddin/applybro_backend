import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GeminiService } from './gemini.service';
import { ApplyMode } from '@prisma/client';
import { decodeResume, savePrivateResume } from './private-resume';
const PORTALS=['Company Career Portals','LinkedIn','Google for Jobs','Naukri.com','Indeed','Wellfound / AngelList','Glassdoor','ZipRecruiter'];
const LEGACY_PORTALS:Record<string,string>={LINKEDIN:'LinkedIn',NAUKRI:'Naukri.com',INDEED:'Indeed',ATS_DIRECT:'Company Career Portals'};

@Injectable()
export class ProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly geminiService: GeminiService,
  ) {}

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        preferences: true,
        resumes: { take: 1, orderBy: { createdAt: 'desc' } },
        portalConnections: true,
      },
    });

    if (!user) throw new NotFoundException('User profile not found');

    const rawSteps = user.setupSteps && user.setupSteps.length === 4
      ? user.setupSteps
      : [false, false, false, false];

    // Strict sequential flow: step N can only be true if steps 0..(N-1) are completed
    const steps = [false, false, false, false];
    if (rawSteps[0]) {
      steps[0] = true;
      if (rawSteps[1]) {
        steps[1] = true;
        if (rawSteps[2]) {
          steps[2] = true;
          if (rawSteps[3]) {
            steps[3] = true;
          }
        }
      }
    }
    const count = steps.filter(Boolean).length;
    const privateFiles:any[]=await this.prisma.$queryRaw`SELECT "id","fileName","parsedData" FROM "Resume" WHERE "userId"=${userId} AND "fileBytes" IS NOT NULL ORDER BY "isDefault" DESC,"createdAt" DESC LIMIT 1`;

    const saved:any[]=await this.prisma.$queryRaw`SELECT "selectedPortals" FROM "User" WHERE "id"=${userId}`;
    const portalNames = user.portalConnections.map(p => LEGACY_PORTALS[p.portal.toString()]).filter(Boolean);
    // NULL means an old account without explicit preferences; [] means the user cleared them.
    const defaultPortals = Array.isArray(saved[0]?.selectedPortals)?saved[0].selectedPortals:
      portalNames.length > 0 ? [...new Set(portalNames)] : ['LinkedIn', 'Google for Jobs', 'Naukri.com'];

    return {
      name: user.name || '',
      email: user.email || '',
      phone: user.phone || '',
      currentTitle: user.currentTitle || '',
      linkedIn: user.linkedIn || '',
      portfolio: user.portfolio || '',
      resume: user.resumeName || user.resumes[0]?.fileName || '',
      resumeSize: user.resumeSize || 0,
      resumeStored:!!privateFiles.length,
      resumeParsed:!!privateFiles[0]?.parsedData,
      autoApplyConsent:user.autoApplyConsent,

      roles: user.preferences?.titles?.join(', ') || '',
      suggestedRoles: user.preferences?.includeKeywords || [],
      locations: user.preferences?.locations?.join(', ') || '',
      workMode: user.preferences?.workModes?.[0] || 'Remote',
      experience: user.experience || '1–3 years',
      currentCtc: user.currentCtc || '',
      expectedCtc: user.expectedCtc || '',
      noticePeriod: user.noticePeriod || 'Immediate Joiner',
      skills: user.skills || '',

      portals: defaultPortals,
      primaryPortal: user.primaryPortal || defaultPortals[0] || '',

      mode: user.activeMode || 'APPROVE_FIRST',
      limit: user.dailyApplyLimit || 5,
      threshold: user.minMatchScore || 70,
      workAuthorization: user.workAuthorization || 'Authorized to work in India (Citizen/PR)',
      relocation: user.relocation || 'Open to Relocation',

      steps,
      completed: user.setupCompleted,
      count,
      percentage: count * 25,
    };
  }

  async saveSetup(userId: string, data: any) {
    if(!data||typeof data!=='object')throw new BadRequestException('Profile data is required.');
    let selectedPortals:string[]|undefined;
    if(data.portals!==undefined){
      if(!Array.isArray(data.portals)||data.portals.length>PORTALS.length||data.portals.some((name:any)=>typeof name!=='string'||!PORTALS.includes(name)))throw new BadRequestException('Choose valid job platforms.');
      selectedPortals=[...new Set<string>(data.portals)];
    }
    if(data.primaryPortal!==undefined&&(typeof data.primaryPortal!=='string'||(data.primaryPortal&&!PORTALS.includes(data.primaryPortal))))throw new BadRequestException('Choose a valid primary platform.');
    const primaryPortal=selectedPortals!==undefined?(selectedPortals.includes(data.primaryPortal)?data.primaryPortal:selectedPortals[0]||null):data.primaryPortal;
    const rawSteps: boolean[] = Array.isArray(data.steps) && data.steps.length === 4
      ? data.steps
      : [false, false, false, false];

    // Strict sequential enforcement
    const steps = [false, false, false, false];
    if (rawSteps[0]) {
      steps[0] = true;
      if (rawSteps[1]) {
        steps[1] = true;
        if (rawSteps[2]) {
          steps[2] = true;
          if (rawSteps[3]) {
            steps[3] = true;
          }
        }
      }
    }

    const completed = data.completed === true || steps.every(Boolean);

    let activeMode: ApplyMode = ApplyMode.APPROVE_FIRST;
    if (data.mode === 'AUTO_APPLY') {
      if(data.autoApplyConsent!==true)throw new BadRequestException('Enable automatic submission consent before saving Auto-Apply.');
      const files:any[]=await this.prisma.$queryRaw`SELECT "id" FROM "Resume" WHERE "userId"=${userId} AND "fileBytes" IS NOT NULL LIMIT 1`;
      const devices:any[]=await this.prisma.$queryRaw`SELECT "id" FROM "BrowserDevice" WHERE "userId"=${userId} AND "revokedAt" IS NULL AND "expiresAt">NOW() LIMIT 1`;
      if(!files.length)throw new BadRequestException('Upload your resume file before enabling Auto-Apply.');
      if(!devices.length)throw new BadRequestException('Connect Browser Companion before enabling Auto-Apply.');
      activeMode=ApplyMode.AUTO_APPLY;
    }
    else if (data.mode === 'ASSISTED_APPLY') activeMode = ApplyMode.ASSISTED_APPLY;

    await this.prisma.$transaction(async tx=>{
    await tx.user.update({
      where: { id: userId },
      data: {
        name: typeof data.name === 'string' && data.name.trim() ? data.name.trim() : undefined,
        phone: typeof data.phone === 'string' ? data.phone.trim() : undefined,
        currentTitle: typeof data.currentTitle === 'string' ? data.currentTitle.trim() : undefined,
        linkedIn: typeof data.linkedIn === 'string' ? data.linkedIn.trim() : undefined,
        portfolio: typeof data.portfolio === 'string' ? data.portfolio.trim() : undefined,
        experience: typeof data.experience === 'string' ? data.experience : undefined,
        currentCtc: typeof data.currentCtc === 'string' ? data.currentCtc.trim() : undefined,
        expectedCtc: typeof data.expectedCtc === 'string' ? data.expectedCtc.trim() : undefined,
        noticePeriod: typeof data.noticePeriod === 'string' ? data.noticePeriod : undefined,
        skills: typeof data.skills === 'string' ? data.skills.trim() : undefined,
        workAuthorization: typeof data.workAuthorization === 'string' ? data.workAuthorization : undefined,
        relocation: typeof data.relocation === 'string' ? data.relocation : undefined,
        primaryPortal,
        resumeName: typeof data.resume === 'string' && data.resume ? data.resume : undefined,
        resumeSize: typeof data.resumeSize === 'number' ? data.resumeSize : undefined,
        activeMode,
        autoApplyConsent: activeMode===ApplyMode.AUTO_APPLY,
        consentTimestamp: activeMode===ApplyMode.AUTO_APPLY?new Date():undefined,
        dailyApplyLimit: typeof data.limit === 'number' ? Math.max(1, Math.min(100, data.limit)) : undefined,
        minMatchScore: typeof data.threshold === 'number' ? Math.max(0, Math.min(100, data.threshold)) : undefined,
        setupSteps: steps,
        setupCompleted: completed,
      },
    });

    // Sync preferences
    if (data.roles || data.locations || data.suggestedRoles) {
      const titles = typeof data.roles === 'string'
        ? data.roles.split(',').map((s: string) => s.trim()).filter(Boolean)
        : [];
      const locations = typeof data.locations === 'string'
        ? data.locations.split(',').map((s: string) => s.trim()).filter(Boolean)
        : [];
      const workModes = data.workMode ? [data.workMode] : ['Remote'];
      const includeKeywords = Array.isArray(data.suggestedRoles) && data.suggestedRoles.length > 0
        ? data.suggestedRoles
        : undefined;

      await tx.jobPreference.upsert({
        where: { userId },
        create: {
          userId,
          titles,
          locations,
          workModes,
          includeKeywords: includeKeywords || [],
        },
        update: {
          titles,
          locations,
          workModes,
          ...(includeKeywords ? { includeKeywords } : {}),
        },
      });
    }

    // Sync resume record if provided
    if (data.resume) {
      const existingResume = await tx.resume.findFirst({
        where: { userId, fileName: data.resume },
      });
      if (!existingResume) {
        await tx.resume.create({
          data: {
            userId,
            fileName: data.resume,
            fileUrl: data.resumeUrl || `local://${data.resume}`,
            isDefault: true,
          },
        });
      }
    }

    if(selectedPortals!==undefined){
      await tx.$executeRaw`UPDATE "User" SET "selectedPortals"=${JSON.stringify(selectedPortals)}::jsonb WHERE "id"=${userId}`;
    }
    if(activeMode!==ApplyMode.AUTO_APPLY)await tx.$executeRaw`UPDATE "BrowserRun" SET "stage"='CANCELLED',"updatedAt"=NOW() WHERE "userId"=${userId} AND ("details"->>'autoSubmit'='true' OR "details"->>'autoDiscover'='true' OR "details"->>'autoPrepare'='true') AND "stage" IN ('CREATED','OPENED','REVIEW_REQUIRED')`;
    });

    return this.getProfile(userId);
  }

  async parseResumeWithAi(
    userId: string,
    data: { fileBase64: string; fileName: string; mimeType?: string },
  ) {
    const file=decodeResume(data);
    const resumeId=await savePrivateResume(this.prisma,userId,file);
    let parsed:any;
    try{parsed = await this.geminiService.parseResume(
      data.fileBase64,
      data.mimeType || 'application/pdf',
      data.fileName || 'resume.pdf',
    );}catch{return {stored:true,parsed:false,resumeId,message:'Resume file saved privately. AI parsing failed; review your profile details manually.'};}
    await this.prisma.resume.update({where:{id:resumeId},data:{parsedData:parsed}});

    // Save resume filename to user record if provided
    if (data.fileName) {
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          resumeName: data.fileName,
        },
      });
    }

    return {...parsed,stored:true,parsed:true,resumeId};
  }
}

