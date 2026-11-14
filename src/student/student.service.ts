import { Injectable, BadRequestException, UnauthorizedException, ConflictException, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StudentSubmissionDto, StudentReviewDto } from './student.dto';
import { offerPrice } from '../offers/offer-prices';
export const normalizeName = (name: string) => name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
@Injectable()
export class StudentService {
  private sessions = new Map<string, number>();
  private attempts = new Map<string, { count: number; until: number }>();
  constructor(private readonly prisma: PrismaService) {}
  rateLimit(ip: string, limit = 10) {
    const now = Date.now();
    for (const [key, value] of this.attempts) if (value.until < now) this.attempts.delete(key);
    const value = this.attempts.get(ip) || { count: 0, until: now + 15 * 60000 };
    if (++value.count > limit) throw new BadRequestException('Too many attempts. Try again in 15 minutes.');
    this.attempts.set(ip, value);
  }
  login(key: string) {
    const expected = process.env.STUDENT_REVIEW_KEY || '';
    if (!expected || !timingSafeEqual(Buffer.from(hash(key)), Buffer.from(hash(expected)))) throw new UnauthorizedException('Invalid review key');
    const token = randomBytes(32).toString('hex');
    for (const [key, until] of this.sessions) if (until < Date.now()) this.sessions.delete(key);
    this.sessions.set(hash(token), Date.now() + 8 * 3600000);
    return token;
  }
  authorize(cookie: string) {
    const token = cookie?.split(';').map(p => p.trim()).find(p => p.startsWith('student_review='))?.slice(15);
    if (!token || (this.sessions.get(hash(token)) || 0) < Date.now()) throw new UnauthorizedException('Sign in to review student IDs.');
  }
  logout(cookie: string) {
    const token = cookie?.split(';').map(p => p.trim()).find(p => p.startsWith('student_review='))?.slice(15);
    if (token) this.sessions.delete(hash(token));
  }
  private validateImage(file: Express.Multer.File) {
    if (!file || file.size > 5 * 1024 * 1024) throw new BadRequestException('Upload a student ID image up to 5 MB.');
    const b = file.buffer;
    const png = b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const jpg = b[0] === 255 && b[1] === 216 && b[2] === 255;
    const webp = b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP';
    if (!((png && file.mimetype === 'image/png') || (jpg && file.mimetype === 'image/jpeg') || (webp && file.mimetype === 'image/webp'))) throw new BadRequestException('Choose a valid PNG, JPEG or WebP photo.');
    return { imageBytes: b, imageMime: file.mimetype };
  }
  private async summary(record: any) {
    const plan = await this.prisma.pricingPlan.findFirst({ where: { isActive: true, requiresStudentVerification: true }, orderBy: { order: "asc" } });
    return { id: record.id, fullName: record.fullName, status: record.status, reason: record.reviewReason, claimed: !!record.claimId, claimId: record.claimId, discountPercent: 50, monthlyPrice: plan?.monthlyPrice ?? offerPrice(50), yearlyPrice: plan?.yearlyPrice ?? Number((offerPrice(50) * 12).toFixed(2)), currency: 'INR', gstIncluded: true };
  }
  private async owned(id: string, token: string, userId?: string) {
    const record = await this.prisma.studentVerification.findUnique({ where: { id } });
    if (userId) { if (!record || record.userId !== userId) throw new UnauthorizedException('This application belongs to a different account.'); return record; }
    if (!record || !token || !timingSafeEqual(Buffer.from(record.tokenHash), Buffer.from(hash(token)))) throw new UnauthorizedException('Invalid application access.');
    return record;
  }
  async submit(data: StudentSubmissionDto, file: Express.Multer.File, id?: string, token?: string, userId?: string) {
    const image = this.validateImage(file);
    if (id) {
      const previous = await this.owned(id, token, userId);
      if (previous.status !== 'REJECTED') throw new ConflictException('Only rejected applications can be resubmitted.');
    }
    const accessToken = id ? token : randomBytes(32).toString('hex');
    const matches = normalizeName(data.fullName) === normalizeName(data.nameOnId);
    const values = { ...data, ...image, ...(userId ? { userId } : {}), status: matches ? 'PENDING' : 'REJECTED', reviewReason: matches ? '' : 'Your name and the name entered from your ID do not match. Correct the details and re-upload a clear student ID.', reviewedAt: null, claimId: null, claimedAt: null };
    const record = id ? await this.prisma.studentVerification.update({ where: { id }, data: values }) : await this.prisma.studentVerification.create({ data: { ...values, tokenHash: hash(accessToken) } });
    return { ...await this.summary(record), accessToken };
  }
  async status(id: string, token: string, userId?: string) { return this.summary(await this.owned(id, token, userId)); }
  async mine(userId: string) { const record = await this.prisma.studentVerification.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } }); return record ? this.summary(record) : null; }
  list() { return this.prisma.studentVerification.findMany({ select: { id: true, fullName: true, nameOnId: true, email: true, institution: true, studentId: true, status: true, reviewReason: true, createdAt: true, claimedAt: true }, orderBy: { updatedAt: 'desc' }, take: 200 }); }
  async image(id: string) {
    const record = await this.prisma.studentVerification.findUnique({ where: { id }, select: { imageBytes: true, imageMime: true } });
    if (!record) throw new NotFoundException();
    return record;
  }
  async review(id: string, data: StudentReviewDto) {
    const record = await this.prisma.studentVerification.findUnique({ where: { id } });
    if (!record) throw new NotFoundException();
    if (data.status === 'REJECTED' && !data.reason.trim()) throw new BadRequestException('Give a reason so the student can correct and re-upload.');
    if (data.status === 'APPROVED' && normalizeName(data.documentName) !== normalizeName(record.fullName)) throw new BadRequestException('The name read from the ID photo must match the student name. Reject with a reason if it does not.');
    const result = await this.prisma.studentVerification.updateMany({ where: { id, status: 'PENDING' }, data: { status: data.status, reviewReason: data.status === 'REJECTED' ? data.reason : '', reviewedAt: new Date() } });
    if (!result.count) throw new ConflictException('This application has already been reviewed.');
    return { success: true };
  }
  async claim(id: string, token: string, userId?: string) {
    const record = await this.owned(id, token, userId);
    if (record.status !== 'APPROVED') throw new ConflictException('Admin approval is required before claiming the student offer.');
    if (!await this.prisma.pricingPlan.findFirst({ where: { isActive: true, requiresStudentVerification: true } })) throw new ConflictException('The student offer is not currently available.');
    await this.prisma.studentVerification.updateMany({ where: { id, status: 'APPROVED', claimId: null }, data: { claimId: randomUUID(), claimedAt: new Date() } });
    return this.summary(await this.owned(id, token, userId));
  }
}
