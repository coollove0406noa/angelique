import {
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
 * Admin password table - stores hashed admin password
 */
export const adminAuth = mysqlTable("admin_auth", {
  id: int("id").autoincrement().primaryKey(),
  passwordHash: varchar("passwordHash", { length: 255 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/**
 * Clients (customers) table
 */
export const clients = mysqlTable("clients", {
  id: int("id").autoincrement().primaryKey(),
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
  clientId: int("clientId").notNull(),
  clientToken: varchar("clientToken", { length: 128 }).notNull().unique(),
  scheduledAt: timestamp("scheduledAt").notNull(),
  durationMinutes: int("durationMinutes").notNull(),
  carryoverMinutes: int("carryoverMinutes").notNull().default(0),
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
