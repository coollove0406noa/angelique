import { and, desc, eq, isNull, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser,
  adminAuth,
  appSettings,
  carryoverRecords,
  clients,
  fortuneTellers,
  InsertFortuneTeller,
  messages,
  sessions,
  superAdminAuth,
  users,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ── Users ──────────────────────────────────────────────────────────────────

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;

  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};

  const textFields = ["name", "email", "loginMethod"] as const;
  type TextField = (typeof textFields)[number];
  const assignNullable = (field: TextField) => {
    const value = user[field];
    if (value === undefined) return;
    const normalized = value ?? null;
    values[field] = normalized;
    updateSet[field] = normalized;
  };
  textFields.forEach(assignNullable);

  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }
  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();

  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ── Admin Auth (legacy) ────────────────────────────────────────────────────

export async function getAdminPasswordHash(): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(adminAuth).limit(1);
  return result.length > 0 ? result[0].passwordHash : null;
}

export async function setAdminPasswordHash(hash: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const existing = await db.select().from(adminAuth).limit(1);
  if (existing.length > 0) {
    await db.update(adminAuth).set({ passwordHash: hash });
  } else {
    await db.insert(adminAuth).values({ passwordHash: hash });
  }
}

// ── Fortune Tellers ────────────────────────────────────────────────────────

export async function getAllFortuneTellers() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(fortuneTellers).orderBy(fortuneTellers.createdAt);
}

export async function getFortuneTellerById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(fortuneTellers).where(eq(fortuneTellers.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getFortuneTellerBySlug(slug: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(fortuneTellers).where(eq(fortuneTellers.slug, slug)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getFortuneTellerByToken(token: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(fortuneTellers)
    .where(eq(fortuneTellers.sessionToken, token))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function createFortuneTeller(data: {
  slug: string;
  brandName: string;
  passwordHash: string;
  themeColor?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const result = await db.insert(fortuneTellers).values({
    slug: data.slug,
    brandName: data.brandName,
    passwordHash: data.passwordHash,
    themeColor: data.themeColor ?? "dusty-pink",
    isActive: true,
  });
  return result[0].insertId as number;
}

export async function updateFortuneTeller(
  id: number,
  data: Partial<{
    slug: string;
    brandName: string;
    passwordHash: string;
    sessionToken: string | null;
    themeColor: string;
    isActive: boolean;
  }>
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(fortuneTellers).set(data).where(eq(fortuneTellers.id, id));
}

// ── Super Admin Auth ───────────────────────────────────────────────────────

export async function getSuperAdminPasswordHash(): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(superAdminAuth).limit(1);
  return result.length > 0 ? result[0].passwordHash : null;
}

export async function setSuperAdminPasswordHash(hash: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const existing = await db.select().from(superAdminAuth).limit(1);
  if (existing.length > 0) {
    await db.update(superAdminAuth).set({ passwordHash: hash });
  } else {
    await db.insert(superAdminAuth).values({ passwordHash: hash });
  }
}

export async function getSuperAdminSessionToken(): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(superAdminAuth).limit(1);
  return result.length > 0 ? result[0].sessionToken ?? null : null;
}

export async function setSuperAdminSessionToken(token: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const existing = await db.select().from(superAdminAuth).limit(1);
  if (existing.length > 0) {
    await db.update(superAdminAuth).set({ sessionToken: token });
  } else {
    // Should not happen (password must be set first), but handle gracefully
    throw new Error("Super admin auth not initialized");
  }
}

// ── Clients ────────────────────────────────────────────────────────────────

export async function getAllClients(fortuneTellerId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(clients)
    .where(eq(clients.fortuneTellerId, fortuneTellerId))
    .orderBy(desc(clients.createdAt));
}

export async function getClientById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(clients).where(eq(clients.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function createClient(data: {
  fortuneTellerId: number;
  name: string;
  email: string;
  sessionMinutes: number;
  carryoverMinutes?: number;
  notes?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const result = await db.insert(clients).values({
    fortuneTellerId: data.fortuneTellerId,
    name: data.name,
    email: data.email,
    sessionMinutes: data.sessionMinutes,
    carryoverMinutes: data.carryoverMinutes ?? 0,
    notes: data.notes ?? null,
  });
  return result[0].insertId as number;
}

export async function updateClient(
  id: number,
  data: Partial<{
    name: string;
    email: string;
    sessionMinutes: number;
    carryoverMinutes: number;
    notes: string;
  }>
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(clients).set(data).where(eq(clients.id, id));
}

export async function deleteClient(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(clients).where(eq(clients.id, id));
}

// ── Sessions ───────────────────────────────────────────────────────────────

export async function getAllSessions(fortuneTellerId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      id: sessions.id,
      fortuneTellerId: sessions.fortuneTellerId,
      clientId: sessions.clientId,
      clientToken: sessions.clientToken,
      scheduledAt: sessions.scheduledAt,
      durationMinutes: sessions.durationMinutes,
      carryoverMinutes: sessions.carryoverMinutes,
      sessionType: sessions.sessionType,
      status: sessions.status,
      startedAt: sessions.startedAt,
      endedAt: sessions.endedAt,
      remainingSeconds: sessions.remainingSeconds,
      timerStartedAt: sessions.timerStartedAt,
      adminNotes: sessions.adminNotes,
      createdAt: sessions.createdAt,
      updatedAt: sessions.updatedAt,
      clientName: clients.name,
      clientEmail: clients.email,
    })
    .from(sessions)
    .leftJoin(clients, eq(sessions.clientId, clients.id))
    .where(eq(sessions.fortuneTellerId, fortuneTellerId))
    .orderBy(desc(sessions.scheduledAt));
}

export async function getSessionsByClientId(clientId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      id: sessions.id,
      fortuneTellerId: sessions.fortuneTellerId,
      clientId: sessions.clientId,
      clientToken: sessions.clientToken,
      scheduledAt: sessions.scheduledAt,
      durationMinutes: sessions.durationMinutes,
      carryoverMinutes: sessions.carryoverMinutes,
      sessionType: sessions.sessionType,
      status: sessions.status,
      startedAt: sessions.startedAt,
      endedAt: sessions.endedAt,
      remainingSeconds: sessions.remainingSeconds,
      timerStartedAt: sessions.timerStartedAt,
      adminNotes: sessions.adminNotes,
      createdAt: sessions.createdAt,
      updatedAt: sessions.updatedAt,
      clientName: clients.name,
      clientEmail: clients.email,
    })
    .from(sessions)
    .leftJoin(clients, eq(sessions.clientId, clients.id))
    .where(eq(sessions.clientId, clientId))
    .orderBy(desc(sessions.scheduledAt));
}

export async function getSessionById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(sessions).where(eq(sessions.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getSessionByToken(token: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select({
      id: sessions.id,
      fortuneTellerId: sessions.fortuneTellerId,
      clientId: sessions.clientId,
      clientToken: sessions.clientToken,
      scheduledAt: sessions.scheduledAt,
      durationMinutes: sessions.durationMinutes,
      carryoverMinutes: sessions.carryoverMinutes,
      sessionType: sessions.sessionType,
      status: sessions.status,
      startedAt: sessions.startedAt,
      endedAt: sessions.endedAt,
      remainingSeconds: sessions.remainingSeconds,
      timerStartedAt: sessions.timerStartedAt,
      adminNotes: sessions.adminNotes,
      createdAt: sessions.createdAt,
      updatedAt: sessions.updatedAt,
      clientName: clients.name,
      clientEmail: clients.email,
    })
    .from(sessions)
    .leftJoin(clients, eq(sessions.clientId, clients.id))
    .where(eq(sessions.clientToken, token))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function createSession(data: {
  fortuneTellerId: number;
  clientId: number;
  clientToken: string;
  scheduledAt: Date;
  durationMinutes: number;
  carryoverMinutes?: number;
  sessionType?: "chat" | "voice";
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const result = await db.insert(sessions).values({
    fortuneTellerId: data.fortuneTellerId,
    clientId: data.clientId,
    clientToken: data.clientToken,
    scheduledAt: data.scheduledAt,
    durationMinutes: data.durationMinutes,
    carryoverMinutes: data.carryoverMinutes ?? 0,
    sessionType: data.sessionType ?? "chat",
    status: "scheduled",
  });
  return result[0].insertId as number;
}

export async function updateSession(
  id: number,
  data: Partial<{
    status: "scheduled" | "active" | "paused" | "completed" | "cancelled";
    startedAt: Date | null;
    endedAt: Date | null;
    remainingSeconds: number;
    timerStartedAt: number | null;
    carryoverMinutes: number;
    durationMinutes: number;
    adminNotes: string | null;
  }>
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(sessions).set(data).where(eq(sessions.id, id));
}

export async function deleteSession(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(sessions).where(eq(sessions.id, id));
}

// ── Messages ───────────────────────────────────────────────────────────────

export async function getMessagesBySession(sessionId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(messages.createdAt);
}

export async function createMessage(data: {
  sessionId: number;
  sender: "admin" | "client" | "system";
  content: string;
  imageUrl?: string | null;
  imageKey?: string | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const result = await db.insert(messages).values({
    sessionId: data.sessionId,
    sender: data.sender,
    content: data.content,
    imageUrl: data.imageUrl ?? null,
    imageKey: data.imageKey ?? null,
  });
  const id = result[0].insertId as number;
  const rows = await db.select().from(messages).where(eq(messages.id, id)).limit(1);
  return rows[0];
}

// ── Carryover ──────────────────────────────────────────────────────────────

export async function getCarryoverByClient(clientId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(carryoverRecords)
    .where(eq(carryoverRecords.clientId, clientId))
    .orderBy(desc(carryoverRecords.createdAt));
}

export async function getPendingCarryover(clientId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(carryoverRecords)
    .where(
      and(
        eq(carryoverRecords.clientId, clientId),
        isNull(carryoverRecords.appliedToSessionId)
      )
    );
}

export async function createCarryover(data: {
  clientId: number;
  sessionId: number;
  minutes: number;
  note?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.insert(carryoverRecords).values({
    clientId: data.clientId,
    sessionId: data.sessionId,
    minutes: data.minutes,
    note: data.note ?? null,
  });
}

export async function markCarryoverApplied(id: number, appliedToSessionId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db
    .update(carryoverRecords)
    .set({ appliedToSessionId })
    .where(eq(carryoverRecords.id, id));
}

// ── App Settings ───────────────────────────────────────────────────────────
// Keys are scoped per fortune teller: "ft_{id}_{key}"

export function makeFtKey(fortuneTellerId: number, key: string): string {
  return `ft_${fortuneTellerId}_${key}`;
}

export async function getAllSettingsForFortuneTeller(fortuneTellerId: number) {
  const db = await getDb();
  if (!db) return [];
  const prefix = `ft_${fortuneTellerId}_`;
  const all = await db.select().from(appSettings).where(like(appSettings.key, `${prefix}%`));
  // Strip the prefix from keys before returning
  return all.map((s) => ({ ...s, key: s.key.replace(prefix, "") }));
}

export async function getSetting(key: string): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const result = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, key))
    .limit(1);
  return result.length > 0 ? result[0].value : null;
}

export async function getSettingForFortuneTeller(
  fortuneTellerId: number,
  key: string
): Promise<string | null> {
  return getSetting(makeFtKey(fortuneTellerId, key));
}

export async function setSetting(key: string, value: string, label?: string) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db
    .insert(appSettings)
    .values({ key, value, label: label ?? null })
    .onDuplicateKeyUpdate({ set: { value, ...(label ? { label } : {}) } });
}

export async function setSettingForFortuneTeller(
  fortuneTellerId: number,
  key: string,
  value: string,
  label?: string
) {
  return setSetting(makeFtKey(fortuneTellerId, key), value, label);
}
