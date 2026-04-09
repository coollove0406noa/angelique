import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Mock DB helpers ────────────────────────────────────────────────────────
vi.mock("./db", () => ({
  getAdminPasswordHash: vi.fn(),
  setAdminPasswordHash: vi.fn(),
  getSetting: vi.fn(),
  setSetting: vi.fn(),
  getAllSettings: vi.fn(),
  getAllClients: vi.fn(),
  getClientById: vi.fn(),
  createClient: vi.fn(),
  updateClient: vi.fn(),
  deleteClient: vi.fn(),
  getAllSessions: vi.fn(),
  getSessionById: vi.fn(),
  getSessionByToken: vi.fn(),
  createSession: vi.fn(),
  updateSession: vi.fn(),
  deleteSession: vi.fn(),
  getMessagesBySession: vi.fn(),
  createMessage: vi.fn(),
  getCarryoverByClient: vi.fn(),
  getPendingCarryover: vi.fn(),
  createCarryover: vi.fn(),
  markCarryoverApplied: vi.fn(),
}));

// ── Mock mailer ────────────────────────────────────────────────────────────
vi.mock("./mailer", () => ({
  sendSessionInviteEmail: vi.fn().mockResolvedValue({ success: true }),
}));

import * as db from "./db";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ── Helper: create a mock context ─────────────────────────────────────────
function createCtx(cookieToken?: string): TrpcContext {
  const cookies: Record<string, string> = {};
  return {
    user: null,
    req: {
      protocol: "https",
      headers: {
        cookie: cookieToken ? `admin_token=${cookieToken}` : "",
      },
    } as unknown as TrpcContext["req"],
    res: {
      cookie: (_name: string, _value: string) => {},
      clearCookie: (_name: string) => {},
    } as unknown as TrpcContext["res"],
  };
}

// ── admin.check ────────────────────────────────────────────────────────────
describe("admin.check", () => {
  it("returns authenticated=false when no cookie", async () => {
    const caller = appRouter.createCaller(createCtx());
    const result = await caller.admin.check();
    expect(result.authenticated).toBe(false);
  });

  it("returns authenticated=true when token matches stored value", async () => {
    vi.mocked(db.getSetting).mockResolvedValue("valid-token-abc");
    const caller = appRouter.createCaller(createCtx("valid-token-abc"));
    const result = await caller.admin.check();
    expect(result.authenticated).toBe(true);
  });

  it("returns authenticated=false when token does not match", async () => {
    vi.mocked(db.getSetting).mockResolvedValue("stored-token-xyz");
    const caller = appRouter.createCaller(createCtx("wrong-token"));
    const result = await caller.admin.check();
    expect(result.authenticated).toBe(false);
  });
});

// ── admin.login (first setup) ──────────────────────────────────────────────
describe("admin.login", () => {
  beforeEach(() => {
    vi.mocked(db.getAdminPasswordHash).mockReset();
    vi.mocked(db.setAdminPasswordHash).mockReset();
    vi.mocked(db.setSetting).mockReset();
  });

  it("creates password on first login (no hash stored)", async () => {
    vi.mocked(db.getAdminPasswordHash).mockResolvedValue(null);
    vi.mocked(db.setAdminPasswordHash).mockResolvedValue(undefined);
    vi.mocked(db.setSetting).mockResolvedValue(undefined);

    const caller = appRouter.createCaller(createCtx());
    const result = await caller.admin.login({ password: "mypassword123" });
    expect(result.success).toBe(true);
    expect(result.firstSetup).toBe(true);
    expect(db.setAdminPasswordHash).toHaveBeenCalledOnce();
  });

  it("rejects wrong password", async () => {
    // Store a real bcrypt hash of "correctpass"
    const bcrypt = await import("bcryptjs");
    const hash = await bcrypt.hash("correctpass", 10);
    vi.mocked(db.getAdminPasswordHash).mockResolvedValue(hash);

    const caller = appRouter.createCaller(createCtx());
    await expect(
      caller.admin.login({ password: "wrongpass" })
    ).rejects.toThrow("パスワードが違います");
  });

  it("accepts correct password", async () => {
    const bcrypt = await import("bcryptjs");
    const hash = await bcrypt.hash("correctpass", 10);
    vi.mocked(db.getAdminPasswordHash).mockResolvedValue(hash);
    vi.mocked(db.setSetting).mockResolvedValue(undefined);

    const caller = appRouter.createCaller(createCtx());
    const result = await caller.admin.login({ password: "correctpass" });
    expect(result.success).toBe(true);
    expect(result.firstSetup).toBe(false);
  });
});

// ── clients.create & list ──────────────────────────────────────────────────
describe("clients", () => {
  it("creates a client and returns id", async () => {
    vi.mocked(db.createClient).mockResolvedValue(42);
    const caller = appRouter.createCaller(createCtx());
    const result = await caller.clients.create({
      name: "テスト太郎",
      email: "test@example.com",
      sessionMinutes: 60,
      carryoverMinutes: 0,
    });
    expect(result.id).toBe(42);
    expect(db.createClient).toHaveBeenCalledWith(
      expect.objectContaining({ name: "テスト太郎", email: "test@example.com" })
    );
  });

  it("lists all clients", async () => {
    const mockClients = [
      { id: 1, name: "田中花子", email: "hanako@example.com", sessionMinutes: 60, carryoverMinutes: 0, notes: null, createdAt: new Date(), updatedAt: new Date() },
    ];
    vi.mocked(db.getAllClients).mockResolvedValue(mockClients);
    const caller = appRouter.createCaller(createCtx());
    const result = await caller.clients.list();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("田中花子");
  });
});

// ── sessions.getByToken ────────────────────────────────────────────────────
describe("sessions.getByToken", () => {
  it("returns session for valid token", async () => {
    const mockSession = {
      id: 1,
      clientId: 1,
      clientToken: "abc123",
      scheduledAt: new Date(),
      durationMinutes: 60,
      carryoverMinutes: 0,
      status: "scheduled",
      startedAt: null,
      endedAt: null,
      remainingSeconds: null,
      timerStartedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      clientName: "田中花子",
      clientEmail: "hanako@example.com",
    };
    vi.mocked(db.getSessionByToken).mockResolvedValue(mockSession as never);
    const caller = appRouter.createCaller(createCtx());
    const result = await caller.sessions.getByToken({ token: "abc123" });
    expect(result.id).toBe(1);
    expect(result.clientName).toBe("田中花子");
  });

  it("throws NOT_FOUND for invalid token", async () => {
    vi.mocked(db.getSessionByToken).mockResolvedValue(undefined);
    const caller = appRouter.createCaller(createCtx());
    await expect(
      caller.sessions.getByToken({ token: "invalid-token" })
    ).rejects.toThrow("セッションが見つかりません");
  });

  it("削除以外の全ステータス（scheduled/active/paused/completed/cancelled）は有効なトークンとして返却する", async () => {
    const statuses = ["scheduled", "active", "paused", "completed", "cancelled"] as const;
    for (const status of statuses) {
      vi.mocked(db.getSessionByToken).mockResolvedValueOnce({
        id: 99,
        clientId: 1,
        clientToken: "test-token",
        scheduledAt: new Date(),
        durationMinutes: 30,
        carryoverMinutes: 0,
        status,
        startedAt: null,
        endedAt: null,
        remainingSeconds: 1800,
        timerStartedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        clientName: "Test Client",
        clientEmail: "test@example.com",
      } as never);
      const caller = appRouter.createCaller(createCtx());
      const result = await caller.sessions.getByToken({ token: "test-token" });
      expect(result.status).toBe(status);
    }
  });
});

// ── sessions.start ─────────────────────────────────────────────────────────
describe("sessions.start", () => {
  it("starts session and returns remaining seconds", async () => {
    const mockSession = {
      id: 5,
      clientId: 1,
      clientToken: "tok",
      scheduledAt: new Date(),
      durationMinutes: 30,
      carryoverMinutes: 10,
      status: "scheduled",
      startedAt: null,
      endedAt: null,
      remainingSeconds: null,
      timerStartedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(db.getSessionById).mockResolvedValue(mockSession as never);
    vi.mocked(db.updateSession).mockResolvedValue(undefined);

    const caller = appRouter.createCaller(createCtx());
    const result = await caller.sessions.start({ id: 5 });
    expect(result.success).toBe(true);
    // 30 + 10 = 40 minutes = 2400 seconds
    expect(result.remainingSeconds).toBe(2400);
  });
});

// ── settings.setBulk ──────────────────────────────────────────────────────
describe("settings.setBulk", () => {
  it("saves multiple settings at once", async () => {
    vi.mocked(db.setSetting).mockClear();
    vi.mocked(db.setSetting).mockResolvedValue(undefined);
    const caller = appRouter.createCaller(createCtx());
    const result = await caller.settings.setBulk([
      { key: "stores_url_10min", value: "https://stores.jp/10min", label: "10分延長URL" },
      { key: "stores_url_20min", value: "https://stores.jp/20min", label: "20分延長URL" },
      { key: "stores_url_30min", value: "https://stores.jp/30min", label: "30分延長URL" },
    ]);
    expect(result.success).toBe(true);
    expect(db.setSetting).toHaveBeenCalledTimes(3);
    expect(db.setSetting).toHaveBeenCalledWith("stores_url_10min", "https://stores.jp/10min", "10分延長URL");
  });
});

// ── carryover.save ─────────────────────────────────────────────────────────
describe("carryover.save", () => {
  it("saves carryover and updates client balance", async () => {
    const mockClient = {
      id: 1, name: "テスト", email: "t@t.com", sessionMinutes: 60,
      carryoverMinutes: 5, notes: null, createdAt: new Date(), updatedAt: new Date(),
    };
    vi.mocked(db.createCarryover).mockResolvedValue(undefined);
    vi.mocked(db.getClientById).mockResolvedValue(mockClient as never);
    vi.mocked(db.updateClient).mockResolvedValue(undefined);

    const caller = appRouter.createCaller(createCtx());
    const result = await caller.carryover.save({
      clientId: 1,
      sessionId: 10,
      minutes: 15,
      note: "残り時間繰越",
    });
    expect(result.success).toBe(true);
    expect(db.updateClient).toHaveBeenCalledWith(1, { carryoverMinutes: 20 }); // 5 + 15
  });
});

// ── Agora token generation ─────────────────────────────────────────────────
describe("agora.getToken", () => {
  it("returns a token for a valid sessionId", async () => {
    const caller = appRouter.createCaller(createCtx());
    // AGORA_APP_ID is set; token generation should succeed
    const result = await caller.agora.getToken({ channelName: "session-1", uid: 42 });
    expect(result).toHaveProperty("token");
    expect(typeof result.token).toBe("string");
    expect(result.token.length).toBeGreaterThan(0);
    expect(result).toHaveProperty("appId");
    expect(result.appId).toBe(process.env.AGORA_APP_ID ?? "");
  });
});
