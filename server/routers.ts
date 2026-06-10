import { TRPCError } from "@trpc/server";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  createCarryover,
  createClient,
  createFortuneTeller,
  createSession,
  deleteClient,
  deleteSession,
  getAllClients,
  getAllFortuneTellers,
  getAllSessions,
  getAllSettingsForFortuneTeller,
  getSettingForFortuneTeller,
  getCarryoverByClient,
  getClientById,
  getFortuneTellerById,
  getFortuneTellerBySlug,
  getFortuneTellerByToken,
  getMessagesBySession,
  getPendingCarryover,
  getSessionById,
  getSessionByToken,
  getSessionsByClientId,
  getSuperAdminPasswordHash,
  getSuperAdminSessionToken,
  markCarryoverApplied,
  setSuperAdminPasswordHash,
  setSuperAdminSessionToken,
  setSettingForFortuneTeller,
  updateClient,
  updateFortuneTeller,
  updateSession,
} from "./db";
import { sendSessionInviteEmail } from "./mailer";
import { storagePut } from "./storage";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";

// ── Helpers ────────────────────────────────────────────────────────────────

/** 本番(HTTPS)では sameSite: "none" + secure: true、開発では lax + non-secure */
function authCookieOptions() {
  const isProd = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: (isProd ? "none" : "lax") as "none" | "lax",
    maxAge: 24 * 60 * 60 * 1000,
    path: "/",
  };
}

async function getAdminTokenFromCookie(cookieHeader: string): Promise<string | null> {
  const match = cookieHeader.match(/admin_token=([^;]+)/);
  return match ? match[1] : null;
}

async function getSuperAdminTokenFromCookie(cookieHeader: string): Promise<string | null> {
  const match = cookieHeader.match(/super_admin_token=([^;]+)/);
  return match ? match[1] : null;
}

// ── Admin Router (per fortune teller) ─────────────────────────────────────

const adminRouter = router({
  login: publicProcedure
    .input(z.object({ slug: z.string(), password: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const ft = await getFortuneTellerBySlug(input.slug);
      if (!ft || !ft.isActive) {
        throw new TRPCError({ code: "NOT_FOUND", message: "アカウントが見つかりません" });
      }

      const valid = await bcrypt.compare(input.password, ft.passwordHash);
      if (!valid) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "パスワードが違います" });
      }

      const token = nanoid(32);
      ctx.res.cookie("admin_token", token, authCookieOptions());
      await updateFortuneTeller(ft.id, { sessionToken: token });

      return {
        success: true,
        fortuneTellerId: ft.id,
        slug: ft.slug,
        brandName: ft.brandName,
        themeColor: ft.themeColor,
        accentColor: ft.accentColor,
      };
    }),

  logout: publicProcedure.mutation(async ({ ctx }) => {
    const cookieHeader = ctx.req.headers.cookie || "";
    const token = await getAdminTokenFromCookie(cookieHeader);
    if (token) {
      const ft = await getFortuneTellerByToken(token);
      if (ft) {
        await updateFortuneTeller(ft.id, { sessionToken: null });
      }
    }
    ctx.res.clearCookie("admin_token", { path: "/" });
    return { success: true };
  }),

  check: publicProcedure.query(async ({ ctx }) => {
    const cookieHeader = ctx.req.headers.cookie || "";
    const token = await getAdminTokenFromCookie(cookieHeader);
    if (!token) return { authenticated: false };

    const ft = await getFortuneTellerByToken(token);
    if (!ft || !ft.isActive) return { authenticated: false };

    return {
      authenticated: true,
      fortuneTellerId: ft.id,
      slug: ft.slug,
      brandName: ft.brandName,
      themeColor: ft.themeColor,
      accentColor: ft.accentColor,
    };
  }),

  changePassword: publicProcedure
    .input(z.object({
      slug: z.string(),
      currentPassword: z.string(),
      newPassword: z.string().min(6),
    }))
    .mutation(async ({ input, ctx }) => {
      // Verify currently logged in as this fortune teller
      const cookieHeader = ctx.req.headers.cookie || "";
      const token = await getAdminTokenFromCookie(cookieHeader);
      const ft = token ? await getFortuneTellerByToken(token) : null;
      if (!ft || ft.slug !== input.slug) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "認証エラー" });
      }
      const valid = await bcrypt.compare(input.currentPassword, ft.passwordHash);
      if (!valid) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "現在のパスワードが違います" });
      }
      const newHash = await bcrypt.hash(input.newPassword, 12);
      await updateFortuneTeller(ft.id, { passwordHash: newHash });
      return { success: true };
    }),

  updateBrand: publicProcedure
    .input(z.object({
      slug: z.string(),
      brandName: z.string().min(1).optional(),
      themeColor: z.string().optional(),
      accentColor: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const cookieHeader = ctx.req.headers.cookie || "";
      const token = await getAdminTokenFromCookie(cookieHeader);
      const ft = token ? await getFortuneTellerByToken(token) : null;
      if (!ft || ft.slug !== input.slug) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "認証エラー" });
      }
      const updateData: Parameters<typeof updateFortuneTeller>[1] = {};
      if (input.brandName !== undefined) updateData.brandName = input.brandName;
      if (input.themeColor !== undefined) updateData.themeColor = input.themeColor;
      if (input.accentColor !== undefined) updateData.accentColor = input.accentColor;
      await updateFortuneTeller(ft.id, updateData);
      return { success: true };
    }),
});

// ── Super Admin Router ─────────────────────────────────────────────────────

const superAdminRouter = router({
  login: publicProcedure
    .input(z.object({ password: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const hash = await getSuperAdminPasswordHash();
      if (!hash) {
        // First-time setup
        const newHash = await bcrypt.hash(input.password, 12);
        await setSuperAdminPasswordHash(newHash);
        const token = nanoid(32);
        await setSuperAdminSessionToken(token);
        ctx.res.cookie("super_admin_token", token, authCookieOptions());
        return { success: true, firstSetup: true };
      }

      const valid = await bcrypt.compare(input.password, hash);
      if (!valid) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "パスワードが違います" });
      }
      const token = nanoid(32);
      await setSuperAdminSessionToken(token);
      ctx.res.cookie("super_admin_token", token, authCookieOptions());
      return { success: true, firstSetup: false };
    }),

  logout: publicProcedure.mutation(async ({ ctx }) => {
    ctx.res.clearCookie("super_admin_token", { path: "/" });
    return { success: true };
  }),

  check: publicProcedure.query(async ({ ctx }) => {
    const cookieHeader = ctx.req.headers.cookie || "";
    const token = await getSuperAdminTokenFromCookie(cookieHeader);
    if (!token) return { authenticated: false };
    const stored = await getSuperAdminSessionToken();
    return { authenticated: stored === token };
  }),

  listFortuneTellers: publicProcedure.query(async ({ ctx }) => {
    const cookieHeader = ctx.req.headers.cookie || "";
    const token = await getSuperAdminTokenFromCookie(cookieHeader);
    const stored = await getSuperAdminSessionToken();
    if (!token || stored !== token) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }
    const all = await getAllFortuneTellers();
    // Count clients and sessions per fortune teller
    return all.map((ft) => ({
      id: ft.id,
      slug: ft.slug,
      brandName: ft.brandName,
      themeColor: ft.themeColor,
      isActive: ft.isActive,
      createdAt: ft.createdAt,
    }));
  }),

  createFortuneTeller: publicProcedure
    .input(
      z.object({
        slug: z.string().min(2).max(50).regex(/^[a-z0-9-]+$/, "英小文字・数字・ハイフンのみ使用可能"),
        brandName: z.string().min(1).max(100),
        password: z.string().min(6),
        themeColor: z.string().default("#f3e7e5"),
        accentColor: z.string().default("#c9a8a3"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const cookieHeader = ctx.req.headers.cookie || "";
      const token = await getSuperAdminTokenFromCookie(cookieHeader);
      const stored = await getSuperAdminSessionToken();
      if (!token || stored !== token) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }

      // Check slug uniqueness
      const existing = await getFortuneTellerBySlug(input.slug);
      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "このスラッグはすでに使用されています" });
      }

      const passwordHash = await bcrypt.hash(input.password, 12);
      const id = await createFortuneTeller({
        slug: input.slug,
        brandName: input.brandName,
        passwordHash,
        themeColor: input.themeColor,
        accentColor: input.accentColor,
      });
      return { id, slug: input.slug };
    }),

  updateFortuneTeller: publicProcedure
    .input(
      z.object({
        id: z.number(),
        brandName: z.string().min(1).max(100).optional(),
        themeColor: z.string().optional(),
        accentColor: z.string().optional(),
        isActive: z.boolean().optional(),
        newPassword: z.string().min(6).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const cookieHeader = ctx.req.headers.cookie || "";
      const token = await getSuperAdminTokenFromCookie(cookieHeader);
      const stored = await getSuperAdminSessionToken();
      if (!token || stored !== token) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }

      const updateData: Parameters<typeof updateFortuneTeller>[1] = {};
      if (input.brandName !== undefined) updateData.brandName = input.brandName;
      if (input.themeColor !== undefined) updateData.themeColor = input.themeColor;
      if (input.accentColor !== undefined) updateData.accentColor = input.accentColor;
      if (input.isActive !== undefined) updateData.isActive = input.isActive;
      if (input.newPassword) {
        updateData.passwordHash = await bcrypt.hash(input.newPassword, 12);
      }
      await updateFortuneTeller(input.id, updateData);
      return { success: true };
    }),

  getFortuneTellerStats: publicProcedure
    .input(z.object({ fortuneTellerId: z.number() }))
    .query(async ({ input, ctx }) => {
      const cookieHeader = ctx.req.headers.cookie || "";
      const token = await getSuperAdminTokenFromCookie(cookieHeader);
      const stored = await getSuperAdminSessionToken();
      if (!token || stored !== token) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }

      const [clientList, sessionList] = await Promise.all([
        getAllClients(input.fortuneTellerId),
        getAllSessions(input.fortuneTellerId),
      ]);
      return {
        clientCount: clientList.length,
        sessionCount: sessionList.length,
        completedSessions: sessionList.filter((s) => s.status === "completed").length,
      };
    }),
});

// ── Fortune Teller Public Info (for client session theming) ───────────────

const fortuneTellerRouter = router({
  getPublicInfo: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const ft = await getFortuneTellerById(input.id);
      if (!ft) throw new TRPCError({ code: "NOT_FOUND" });
      return {
        id: ft.id,
        brandName: ft.brandName,
        themeColor: ft.themeColor,
        accentColor: ft.accentColor,
      };
    }),
});

// ── Clients ────────────────────────────────────────────────────────────────

const clientsRouter = router({
  list: publicProcedure
    .input(z.object({ fortuneTellerId: z.number() }))
    .query(async ({ input }) => {
      return getAllClients(input.fortuneTellerId);
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
        fortuneTellerId: z.number(),
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
  list: publicProcedure
    .input(z.object({ fortuneTellerId: z.number() }))
    .query(async ({ input }) => {
      return getAllSessions(input.fortuneTellerId);
    }),

  listByClient: publicProcedure
    .input(z.object({ clientId: z.number() }))
    .query(async ({ input }) => {
      return getSessionsByClientId(input.clientId);
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
        fortuneTellerId: z.number(),
        clientId: z.number(),
        scheduledAt: z.string(),
        durationMinutes: z.number().min(5).max(480),
        carryoverMinutes: z.number().min(0).default(0),
        sendEmail: z.boolean().default(true),
        origin: z.string().optional(),
        sessionType: z.enum(["chat", "voice", "video"]).default("chat"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const token = nanoid(48);
      const sessionId = await createSession({
        fortuneTellerId: input.fortuneTellerId,
        clientId: input.clientId,
        clientToken: token,
        scheduledAt: new Date(input.scheduledAt),
        durationMinutes: input.durationMinutes,
        carryoverMinutes: input.carryoverMinutes,
        sessionType: input.sessionType,
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
      let emailResult: { success: boolean; error?: string } = { success: false, error: "skipped" };
      if (input.sendEmail) {
        const [client, ft] = await Promise.all([
          getClientById(input.clientId),
          getFortuneTellerById(input.fortuneTellerId),
        ]);
        if (client) {
          const origin = input.origin || "https://angeliqueapp-b6ezj6ne.manus.space";
          const sessionUrl = `${origin}/session/${token}`;
          console.log(`[Mailer] Sending invite to ${client.email} (session ${sessionId})`);
          emailResult = await sendSessionInviteEmail({
            toEmail: client.email,
            toName: client.name,
            sessionUrl,
            scheduledAt: new Date(input.scheduledAt),
            durationMinutes: input.durationMinutes + totalCarryover,
            brandName: ft?.brandName ?? "angelique",
            mainColor: ft?.themeColor ?? "#f3e7e5",
            accentColor: ft?.accentColor ?? "#c9a8a3",
          });
          if (emailResult.success) {
            console.log(`[Mailer] Email sent successfully to ${client.email}`);
          } else {
            console.error(`[Mailer] Email failed: ${emailResult.error}`);
          }
        }
      }

      return { id: sessionId, token, emailResult };
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
        adminNotes: z.string().nullable().optional(),
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

  uploadImage: publicProcedure
    .input(
      z.object({
        sessionId: z.number(),
        sender: z.enum(["admin", "client"]),
        base64Data: z.string(),
        mimeType: z.string().default("image/jpeg"),
        fileName: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const base64 = input.base64Data.replace(/^data:[^;]+;base64,/, "");
      const buffer = Buffer.from(base64, "base64");
      if (buffer.length > 5 * 1024 * 1024) {
        throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: "画像は5MB以下にしてください" });
      }
      const ext = input.mimeType.split("/")[1] || "jpg";
      const key = `session-images/${input.sessionId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { url } = await storagePut(key, buffer, input.mimeType);
      return { url, key };
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
  list: publicProcedure
    .input(z.object({ fortuneTellerId: z.number() }))
    .query(async ({ input }) => {
      return getAllSettingsForFortuneTeller(input.fortuneTellerId);
    }),

  get: publicProcedure
    .input(z.object({ fortuneTellerId: z.number(), key: z.string() }))
    .query(async ({ input }) => {
      const value = await getSettingForFortuneTeller(input.fortuneTellerId, input.key);
      return { key: input.key, value };
    }),

  setBulk: publicProcedure
    .input(
      z.object({
        fortuneTellerId: z.number(),
        items: z.array(
          z.object({ key: z.string(), value: z.string(), label: z.string().optional() })
        ),
      })
    )
    .mutation(async ({ input }) => {
      for (const item of input.items) {
        await setSettingForFortuneTeller(input.fortuneTellerId, item.key, item.value, item.label);
      }
      return { success: true };
    }),
});

// ── Agora RTC ─────────────────────────────────────────────────────────────

const AGORA_APP_ID = process.env.AGORA_APP_ID || "f5ca2b3f054945b5a9fffd388a26366a";
const AGORA_APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE || "266b1950da144fd0b6fca857ba02fefd";

const agoraRouter = router({
  getToken: publicProcedure
    .input(
      z.object({
        channelName: z.string(),
        uid: z.number().optional().default(0),
        role: z.enum(["publisher", "subscriber"]).default("publisher"),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const { createRequire } = await import("module");
        const require = createRequire(import.meta.url);
        const agoraToken = require("agora-access-token");
        const { RtcTokenBuilder, RtcRole } = agoraToken;
        const role = input.role === "publisher" ? RtcRole.PUBLISHER : RtcRole.SUBSCRIBER;
        const expireTime = 3600;
        const currentTime = Math.floor(Date.now() / 1000);
        const privilegeExpireTime = currentTime + expireTime;

        const token = RtcTokenBuilder.buildTokenWithUid(
          AGORA_APP_ID,
          AGORA_APP_CERTIFICATE,
          input.channelName,
          input.uid,
          role,
          privilegeExpireTime
        );

        console.log(`[Agora] Token generated for channel ${input.channelName}, uid ${input.uid}`);
        return {
          token,
          appId: AGORA_APP_ID,
          channelName: input.channelName,
          uid: input.uid,
        };
      } catch (error) {
        console.error("[Agora] Token generation failed:", error);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Agoraトークン生成に失敗しました: ${(error as Error).message}` });
      }
    }),
});

// ── Email resend ───────────────────────────────────────────────────────────

const emailRouter = router({
  resendInvite: publicProcedure
    .input(z.object({ sessionId: z.number(), origin: z.string().optional() }))
    .mutation(async ({ input }) => {
      const session = await getSessionById(input.sessionId);
      if (!session) throw new TRPCError({ code: "NOT_FOUND" });
      const [client, ft] = await Promise.all([
        getClientById(session.clientId),
        getFortuneTellerById(session.fortuneTellerId),
      ]);
      if (!client) throw new TRPCError({ code: "NOT_FOUND" });
      const origin = input.origin || "https://angeliqueapp-b6ezj6ne.manus.space";
      const sessionUrl = `${origin}/session/${session.clientToken}`;
      console.log(`[Mailer] Resending invite to ${client.email} (session ${input.sessionId})`);
      const result = await sendSessionInviteEmail({
        toEmail: client.email,
        toName: client.name,
        sessionUrl,
        scheduledAt: session.scheduledAt,
        durationMinutes: session.durationMinutes + session.carryoverMinutes,
        brandName: ft?.brandName ?? "angelique",
        mainColor: ft?.themeColor ?? "#f3e7e5",
        accentColor: ft?.accentColor ?? "#c9a8a3",
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
  superAdmin: superAdminRouter,
  fortuneTeller: fortuneTellerRouter,
  clients: clientsRouter,
  sessions: sessionsRouter,
  messages: messagesRouter,
  carryover: carryoverRouter,
  settings: settingsRouter,
  email: emailRouter,
  agora: agoraRouter,
});

export type AppRouter = typeof appRouter;
