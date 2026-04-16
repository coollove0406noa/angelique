import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  // angelique は独自の admin_token / super_admin_token Cookie で認証するため
  // Manus OAuth SDK は使用しない。user は常に null。
  return {
    req: opts.req,
    res: opts.res,
    user: null as User | null,
  };
}
