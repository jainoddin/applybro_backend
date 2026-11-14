import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AuthService } from './auth.service';
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const decoded = await this.auth.verify(request.headers.authorization);
    request.authUser = await this.auth.current(decoded);
    request.firebaseToken = decoded;
    return true;
  }
}
