import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from "@nestjs/common";
import { Observable } from "rxjs";
import { runInTenant } from "./tenant-scope";

/**
 * Runs every HTTP handler and socket message handler inside a tenant context.
 *
 * For a signed-in request the AuthGuard has already resolved the user from the
 * verified token and put their workspace on `req.orgId`; the handler runs bound
 * to it. A public request (a webhook, the chat widget) starts unbound, in a
 * context the handler binds into once it has worked out — from a channel key or
 * a signed token — which workspace the request is for.
 *
 * An interceptor rather than middleware because the binding has to survive into
 * the handler's own promise chain, and Express middleware does not reliably
 * carry an AsyncLocalStorage context past the body parser. Interceptors run
 * after guards, which is the order this needs: the guard decides who you are,
 * then the handler runs as their workspace.
 */
@Injectable()
export class TenantInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    let orgId: string | undefined;
    if (ctx.getType() === "http") {
      orgId = ctx.switchToHttp().getRequest<{ orgId?: string }>().orgId;
    } else if (ctx.getType() === "ws") {
      orgId = ctx.switchToWs().getClient<{ data?: { orgId?: string } }>().data?.orgId;
    }
    return new Observable((subscriber) =>
      runInTenant(orgId, () => {
        const sub = next.handle().subscribe(subscriber);
        return () => sub.unsubscribe();
      }),
    );
  }
}
