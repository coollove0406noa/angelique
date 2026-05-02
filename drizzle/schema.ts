import {
  boolean,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  bigint,
} from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Admin password table - stores hashed admin password (legacy, kept for reference)
 */
export const adminAuth = mysqlTable("admin_auth", {
  id: int("id").autoincrement().primaryKey(),
  passwordHash: varchar("passwordHash", { length: 255 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/**
 * Fortune tellers (占い師) accounts table
 */
export const fortuneTellers = mysqlTable("fortune_tellers", {
  id: int("id").autoincrement().primaryKey(),
  slug: varchar("slug", { length: 50 }).notNull().unique(),
  brandName: varchar("brandName", { length: 100 }).notNull(),
  passwordHash: varchar("passwordHash", { length: 255 }).notNull(),
  sessionToken: varchar("sessionToken", { length: 64 }),
  themeColor: varchar("themeColor", { length: 20 }).notNull().default("#f3e7e5"),
  accentColor: varchar("accentColor", { length: 20 }).notNull().default("#c9a8a3"),
  isActive: boolean("isActive").notNull().default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type FortuneTeller = typeof fortuneTellers.$inferSelect;
export type InsertFortuneTeller = typeof fortuneTellers.$inferInsert;

/**
 * Super admin auth table
 */
export const superAdminAuth = mysqlTable("super_admin_auth", {
  id: int("id").autoincrement().primaryKey(),
  passwordHash: varchar("passwordHash", { length: 255 }).notNull(),
  sessionToken: varchar("sessionToken", { length: 64 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type SuperAdminAuth = typeof superAdminAuth.$inferSelect;

/**
 * Clients (customers) table
 */
export const clients = mysqlTable("clients", {
  id: int("id").autoincrement().primaryKey(),
  fortuneTellerId: int("fortuneTellerId").notNull().default(1),
  name: varchar("name", { length: 100 }).notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  sessionMinutes: int("sessionMinutes").notNull().default(60),
  carryoverMinutes: int("carryoverMinutes").notNull().default(0),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Client = typeof clients.$inferSelect;
export type InsertClient = typeof clients.$inferInsert;

/**
 * Sessions table
 */
export const sessions = mysqlTable("sessions", {
  id: int("id").autoincrement().primaryKey(),
  fortuneTellerId: int("fortuneTellerId").notNull().default(1),
  clientId: int("clientId").notNull(),
  clientToken: varchar("clientToken", { length: 128 }).notNull().unique(),
  scheduledAt: timestamp("scheduledAt").notNull(),
  durationMinutes: int("durationMinutes").notNull(),
  carryoverMinutes: int("carryoverMinutes").notNull().default(0),
  sessionType: mysqlEnum("sessionType", ["chat", "voice"])
    .default("chat")
    .notNull(),
  status: mysqlEnum("status", [
    "scheduled",
    "active",
    "paused",
    "completed",
    "cancelled",
  ])
    .default("scheduled")
    .notNull(),
  startedAt: timestamp("startedAt"),
  endedAt: timestamp("endedAt"),
  remainingSeconds: int("remainingSeconds").default(0),
  timerStartedAt: bigint("timerStartedAt", { mode: "number" }),
  adminNotes: text("adminNotes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Session = typeof sessions.$inferSelect;
export type InsertSession = typeof sessions.$inferInsert;

/**
 * Chat messages table
 */
export const messages = mysqlTable("messages", {
  id: int("id").autoincrement().primaryKey(),
  sessionId: int("sessionId").notNull(),
  sender: mysqlEnum("sender", ["admin", "client", "system"]).notNull(),
  content: text("content").notNull(),
  imageUrl: text("imageUrl"),
  imageKey: varchar("imageKey", { length: 512 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Message = typeof messages.$inferSelect;
export type InsertMessage = typeof messages.$inferInsert;

/**
 * Carryover records table
 */
export const carryoverRecords = mysqlTable("carryover_records", {
  id: int("id").autoincrement().primaryKey(),
  clientId: int("clientId").notNull(),
  sessionId: int("sessionId").notNull(),
  minutes: int("minutes").notNull(),
  note: text("note"),
  appliedToSessionId: int("appliedToSessionId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type CarryoverRecord = typeof carryoverRecords.$inferSelect;
export type InsertCarryoverRecord = typeof carryoverRecords.$inferInsert;

/**
 * App settings table (STORES URLs, etc.)
 * Keys are prefixed by fortune teller ID: "ft_{id}_{key}"
 * Global settings (super admin) use no prefix.
 */
export const appSettings = mysqlTable("app_settings", {
  id: int("id").autoincrement().primaryKey(),
  key: varchar("key", { length: 100 }).notNull().unique(),
  value: text("value").notNull(),
  label: varchar("label", { length: 200 }),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AppSetting = typeof appSettings.$inferSelect;
export type InsertAppSetting = typeof appSettings.$inferInsert;
