import { TRPCError } from "@trpc/server";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  createCarryover,
  createClient,
  createSession,
  deleteClient,
  deleteSession,
  getAdminPasswordHash,
  getAllClients,
  getAllSessions,
  getAllSettings,
  getCarryoverByClient,
  getClientById,
  getMessagesBySession,
  getPendingCarryover,
  getSessionById,
  getSessionByToken,
  getSetting,
  markCarryoverApplied,
  setAdminPasswordHash,
  setSetting,
  updateClient,
  updateSession,
} from "./db";
import { sendSessionInviteEmail } from "./mailer";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";

// ── Admin session token (simple JWT-like approach using nanoid stored in cookie) ──
// We use a simple approach: admin sets password, gets a signed token back

const adminRouter = router({
  login: publicProcedure
    .input(z.object({ password: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const hash = await getAdminPasswordHash();
      if (!hash) {
        // First time setup: set password
        const newHash = await bcrypt.hash(input.password, 12);
        await setAdminPasswordHash(newHash);
        const token = nanoid(32);
        ctx.res.cookie("admin_token", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          maxAge: 24 * 60 * 60 * 1000, // 24h
          path: "/",
        });
        // Store token in DB settings
        await setSetting("admin_session_token", token, "管理者セッショントークン");
        return { success: true, firstSetup: true };
      }
      const valid = await bcrypt.compare(input.password, hash);
      if (!valid) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "パスワードが違います" });
      }
      const token = nanoid(32);
      ctx.res.cookie("admin_token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 24 * 60 * 60 * 1000,
        path: "/",
      });
      await setSetting("admin_session_token", token, "管理者セッショントークン");
      return { success: true, firstSetup: false };
    }),

  logout: publicProcedure.mutation(async ({ ctx }) => {
    ctx.res.clearCookie("admin_token", { path: "/" });
    return { success: true };
  }),

  check: publicProcedure.query(async ({ ctx }) => {
    const cookieHeader = ctx.req.headers.cookie || "";
    const match = cookieHeader.match(/admin_token=([^;]+)/);
    const token = match ? match[1] : null;
    if (!token) return { authenticated: false };
    const stored = await getSetting("admin_session_token");
    return { authenticated: stored === token };
  }),

  changePassword: publicProcedure
    .input(z.object({ currentPassword: z.string(), newPassword: z.string().min(6) }))
    .mutation(async ({ input }) => {
      const hash = await getAdminPasswordHash();
      if (!hash) throw new TRPCError({ code: "NOT_FOUND", message: "パスワード未設定" });
      const valid = await bcrypt.compare(input.currentPassword, hash);
      if (!valid) throw new TRPCError({ code: "UNAUTHORIZED", message: "現在のパスワードが違います" });
      const newHash = await bcrypt.hash(input.newPassword, 12);
      await setAdminPasswordHash(newHash);
      return { success: true };
    }),
});

// ── Clients ────────────────────────────────────────────────────────────────

const clientsRouter = router({
  list: publicProcedure.query(async () => {
    return getAllClients();
  }),

  get: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const client = await getClientById(input.id);
      if (!client) throw new TRPCError({ code: "NOT_FOUND" });
      return client;
    }),

  create: publicProcedure
    .input(
      z.object({
        name: z.string().min(1),
        email: z.string().email(),
        sessionMinutes: z.number().min(5).max(480),
        carryoverMinutes: z.number().min(0).default(0),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const id = await createClient(input);
      return { id };
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(1).optional(),
        email: z.string().email().optional(),
        sessionMinutes: z.number().min(5).max(480).optional(),
        carryoverMinutes: z.number().min(0).optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await updateClient(id, data);
      return { success: true };
    }),

  delete: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await deleteClient(input.id);
      return { success: true };
    }),
});

// ── Sessions ───────────────────────────────────────────────────────────────

const sessionsRouter = router({
  list: publicProcedure.query(async () => {
    return getAllSessions();
  }),

  get: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const session = await getSessionById(input.id);
      if (!session) throw new TRPCError({ code: "NOT_FOUND" });
      return session;
    }),

  getByToken: publicProcedure
    .input(z.object({ token: z.string() }))
    .query(async ({ input }) => {
      const session = await getSessionByToken(input.token);
      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "セッションが見つかりません" });
      return session;
    }),

  create: publicProcedure
    .input(
      z.object({
        clientId: z.number(),
        scheduledAt: z.string(), // ISO string
        durationMinutes: z.number().min(5).max(480),
        carryoverMinutes: z.number().min(0).default(0),
        sendEmail: z.boolean().default(true),
        origin: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const token = nanoid(48);
      const sessionId = await createSession({
        clientId: input.clientId,
        clientToken: token,
        scheduledAt: new Date(input.scheduledAt),
        durationMinutes: input.durationMinutes,
        carryoverMinutes: input.carryoverMinutes,
      });

      // Apply pending carryover
      const pending = await getPendingCarryover(input.clientId);
      let totalCarryover = input.carryoverMinutes;
      for (const c of pending) {
        totalCarryover += c.minutes;
        await markCarryoverApplied(c.id, sessionId);
      }
      if (totalCarryover !== input.carryoverMinutes) {
        await updateSession(sessionId, { carryoverMinutes: totalCarryover });
      }

      // Send email
      if (input.sendEmail) {
        const client = await getClientById(input.clientId);
        if (client) {
          const origin = input.origin || "https://3000-i0a9gsx1vp6h24cg6hrua-153279cf.sg1.manus.computer";
          const sessionUrl = `${origin}/session/${token}`;
          await sendSessionInviteEmail({
            toEmail: client.email,
            toName: client.name,
            sessionUrl,
            scheduledAt: new Date(input.scheduledAt),
            durationMinutes: input.durationMinutes + totalCarryover,
          });
        }
      }

      return { id: sessionId, token };
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.number(),
        status: z.enum(["scheduled", "active", "paused", "completed", "cancelled"]).optional(),
        startedAt: z.string().nullable().optional(),
        endedAt: z.string().nullable().optional(),
        remainingSeconds: z.number().optional(),
        timerStartedAt: z.number().nullable().optional(),
        carryoverMinutes: z.number().optional(),
        durationMinutes: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { id, startedAt, endedAt, ...rest } = input;
      await updateSession(id, {
        ...rest,
        ...(startedAt !== undefined ? { startedAt: startedAt ? new Date(startedAt) : null } : {}),
        ...(endedAt !== undefined ? { endedAt: endedAt ? new Date(endedAt) : null } : {}),
      });
      return { success: true };
    }),

  delete: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await deleteSession(input.id);
      return { success: true };
    }),

  start: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const session = await getSessionById(input.id);
      if (!session) throw new TRPCError({ code: "NOT_FOUND" });
      const totalSeconds = (session.durationMinutes + session.carryoverMinutes) * 60;
      const now = Date.now();
      await updateSession(input.id, {
        status: "active",
        startedAt: new Date(),
        remainingSeconds: totalSeconds,
        timerStartedAt: now,
      });
      return { success: true, remainingSeconds: totalSeconds, timerStartedAt: now };
    }),

  addExtensionTime: publicProcedure
    .input(z.object({ id: z.number(), addMinutes: z.number().min(1) }))
    .mutation(async ({ input }) => {
      const session = await getSessionById(input.id);
      if (!session) throw new TRPCError({ code: "NOT_FOUND" });
      const addSeconds = input.addMinutes * 60;
      const newRemaining = (session.remainingSeconds ?? 0) + addSeconds;
      const now = Date.now();
      await updateSession(input.id, {
        status: "active",
        remainingSeconds: newRemaining,
        timerStartedAt: now,
      });
      return { success: true, remainingSeconds: newRemaining, timerStartedAt: now };
    }),
});

// ── Messages ───────────────────────────────────────────────────────────────

const messagesRouter = router({
  list: publicProcedure
    .input(z.object({ sessionId: z.number() }))
    .query(async ({ input }) => {
      return getMessagesBySession(input.sessionId);
    }),
});

// ── Carryover ──────────────────────────────────────────────────────────────

const carryoverRouter = router({
  list: publicProcedure
    .input(z.object({ clientId: z.number() }))
    .query(async ({ input }) => {
      return getCarryoverByClient(input.clientId);
    }),

  pending: publicProcedure
    .input(z.object({ clientId: z.number() }))
    .query(async ({ input }) => {
      return getPendingCarryover(input.clientId);
    }),

  save: publicProcedure
    .input(
      z.object({
        clientId: z.number(),
        sessionId: z.number(),
        minutes: z.number().min(1),
        note: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      await createCarryover(input);
      // Also update client's carryover balance
      const client = await getClientById(input.clientId);
      if (client) {
        await updateClient(input.clientId, {
          carryoverMinutes: (client.carryoverMinutes || 0) + input.minutes,
        });
      }
      return { success: true };
    }),
});

// ── Settings ───────────────────────────────────────────────────────────────

const settingsRouter = router({
  list: publicProcedure.query(async () => {
    return getAllSettings();
  }),

  get: publicProcedure
    .input(z.object({ key: z.string() }))
    .query(async ({ input }) => {
      const value = await getSetting(input.key);
      return { key: input.key, value };
    }),

  set: publicProcedure
    .input(z.object({ key: z.string(), value: z.string(), label: z.string().optional() }))
    .mutation(async ({ input }) => {
      await setSetting(input.key, input.value, input.label);
      return { success: true };
    }),

  setBulk: publicProcedure
    .input(
      z.array(
        z.object({ key: z.string(), value: z.string(), label: z.string().optional() })
      )
    )
    .mutation(async ({ input }) => {
      for (const item of input) {
        await setSetting(item.key, item.value, item.label);
      }
      return { success: true };
    }),
});

// ── Email resend ───────────────────────────────────────────────────────────

const emailRouter = router({
  resendInvite: publicProcedure
    .input(z.object({ sessionId: z.number(), origin: z.string().optional() }))
    .mutation(async ({ input }) => {
      const session = await getSessionById(input.sessionId);
      if (!session) throw new TRPCError({ code: "NOT_FOUND" });
      const client = await getClientById(session.clientId);
      if (!client) throw new TRPCError({ code: "NOT_FOUND" });
      const origin = input.origin || "https://3000-i0a9gsx1vp6h24cg6hrua-153279cf.sg1.manus.computer";
      const sessionUrl = `${origin}/session/${session.clientToken}`;
      const result = await sendSessionInviteEmail({
        toEmail: client.email,
        toName: client.name,
        sessionUrl,
        scheduledAt: session.scheduledAt,
        durationMinutes: session.durationMinutes + session.carryoverMinutes,
      });
      return result;
    }),
});

// ── App Router ─────────────────────────────────────────────────────────────

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  admin: adminRouter,
  clients: clientsRouter,
  sessions: sessionsRouter,
  messages: messagesRouter,
  carryover: carryoverRouter,
  settings: settingsRouter,
  email: emailRouter,
});

export type AppRouter = typeof appRouter;
