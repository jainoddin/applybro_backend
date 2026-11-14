import { Injectable, ServiceUnavailableException, UnauthorizedException, ConflictException } from '@nestjs/common';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth, DecodedIdToken } from 'firebase-admin/auth';
import { loadFirebaseAccount } from './firebase-credentials';
import { PrismaService } from '../prisma/prisma.service';
import { planStatus, trialEnd } from './plan-status';
const publicUser = { id: true, firebaseUid: true, email: true, name: true, photoUrl: true, authProvider: true, emailVerified: true, setupSteps: true, setupCompleted: true, createdAt: true, subscription: { select: { planName: true, active: true, trialEnds: true, createdAt: true } } } as const;
@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}
  private async withPlan(user: any) {
    // The unique userId and empty update make retries/concurrent logins idempotent.
    const subscription = user.subscription || await this.prisma.subscription.upsert({
      where: { userId: user.id }, update: {},
      create: { userId: user.id, planName: 'FREE_TRIAL', active: true, createdAt: user.createdAt, trialEnds: trialEnd(new Date(user.createdAt)) },
    });
    return { ...user, subscription: { planName: subscription.planName, active: subscription.active, trialEnds: subscription.trialEnds, createdAt: subscription.createdAt }, plan: planStatus(subscription) };
  }
  private firebase() {
    const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
    const file = process.env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim() || process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
    if (!projectId || !(file || process.env.FIREBASE_SERVICE_ACCOUNT_BASE64?.trim() || process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim())) throw new ServiceUnavailableException('Firebase authentication is awaiting server configuration.');
    try {
      let app = getApps().find(app => app.name === 'applybro-auth');
      if (!app) {
        const account = loadFirebaseAccount();
        app = initializeApp({ projectId, credential: cert(account) }, 'applybro-auth');
      }
      return getAuth(app);
    } catch { throw new ServiceUnavailableException('Firebase server configuration could not be loaded.'); }
  }
  async verify(authorization: string): Promise<DecodedIdToken> {
    const match = /^Bearer (\S+)$/.exec(authorization || '');
    if (!match) throw new UnauthorizedException('Sign in to continue.');
    const firebase = this.firebase();
    let decoded: DecodedIdToken;
    try { decoded = await firebase.verifyIdToken(match[1], true); }
    catch (error) {
      const invalid = new Set(['auth/id-token-expired','auth/id-token-revoked','auth/invalid-id-token','auth/argument-error','auth/user-disabled','auth/user-not-found']);
      if(invalid.has(error?.code))throw new UnauthorizedException('Your session is invalid or expired. Please sign in again.');
      // Network/Google service failures do not prove that the user token is bad.
      // Keep authentication closed, but preserve the user's session for retry.
      throw new ServiceUnavailableException('Sign-in verification is temporarily unavailable. Please try again.');
    }
    if (!['google.com', 'github.com'].includes(decoded.firebase?.sign_in_provider) || !decoded.email) throw new UnauthorizedException('Use Google or GitHub with an email address to sign in.');
    return decoded;
  }
  async sync(decoded: DecodedIdToken) {
    const data = { email: decoded.email.toLowerCase(), name: typeof decoded.name === 'string' ? decoded.name.slice(0, 120) : decoded.email.split('@')[0], photoUrl: typeof decoded.picture === 'string' ? decoded.picture : null, authProvider: decoded.firebase.sign_in_provider, emailVerified: decoded.email_verified === true, lastLoginAt: new Date() };
    try {
      // Keep the candidate name they saved in Profile; subsequent OAuth refreshes
      // must not replace application details with a Google/GitHub display handle.
      const user = await this.prisma.user.upsert({ where: { firebaseUid: decoded.uid }, create: { firebaseUid: decoded.uid, ...data }, update: { ...data, name: undefined }, select: publicUser });
      return await this.withPlan(user);
    } catch (error) {
      if (error?.code === 'P2002') throw new ConflictException('This email is already registered with another account. Sign in with the original provider; accounts are not merged automatically.');
      throw new ServiceUnavailableException('Your account could not be synchronized. Please try again.');
    }
  }
  async current(decoded: DecodedIdToken) {
    const user = await this.prisma.user.findUnique({ where: { firebaseUid: decoded.uid }, select: publicUser });
    if (!user) return this.sync(decoded);
    return this.withPlan(user);
  }
}
