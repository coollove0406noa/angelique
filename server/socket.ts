import type { Server as HttpServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import { createMessage, getSessionByToken, updateSession } from "./db";

let io: SocketIOServer | null = null;

export function initSocketIO(httpServer: HttpServer) {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
    path: "/api/socket.io",
  });

  io.on("connection", (socket) => {
    console.log("[Socket.io] Client connected:", socket.id);

    // Join a session room
    socket.on("join_session", async ({ sessionId, role, token }) => {
      const room = `session_${sessionId}`;
      socket.join(room);
      socket.data.sessionId = sessionId;
      socket.data.role = role;
      socket.data.token = token;
      console.log(`[Socket.io] ${role} joined room ${room}`);

      // Notify others in room
      socket.to(room).emit("user_joined", { role });
    });

    // Chat message
    socket.on("send_message", async ({ sessionId, sender, content }) => {
      try {
        const msg = await createMessage({ sessionId, sender, content });
        const room = `session_${sessionId}`;
        io?.to(room).emit("new_message", msg);
      } catch (err) {
        console.error("[Socket.io] send_message error:", err);
      }
    });

    // Timer control (admin only)
    socket.on("timer_start", async ({ sessionId, remainingSeconds }) => {
      const now = Date.now();
      await updateSession(sessionId, {
        status: "active",
        timerStartedAt: now,
        remainingSeconds,
      });
      const room = `session_${sessionId}`;
      io?.to(room).emit("timer_update", {
        status: "active",
        remainingSeconds,
        timerStartedAt: now,
      });
    });

    socket.on("timer_pause", async ({ sessionId, remainingSeconds }) => {
      await updateSession(sessionId, {
        status: "paused",
        timerStartedAt: null,
        remainingSeconds,
      });
      const room = `session_${sessionId}`;
      io?.to(room).emit("timer_update", {
        status: "paused",
        remainingSeconds,
        timerStartedAt: null,
      });
    });

    socket.on("timer_resume", async ({ sessionId, remainingSeconds }) => {
      const now = Date.now();
      await updateSession(sessionId, {
        status: "active",
        timerStartedAt: now,
        remainingSeconds,
      });
      const room = `session_${sessionId}`;
      io?.to(room).emit("timer_update", {
        status: "active",
        remainingSeconds,
        timerStartedAt: now,
      });
    });

    socket.on("timer_end", async ({ sessionId }) => {
      await updateSession(sessionId, {
        status: "paused",
        timerStartedAt: null,
        remainingSeconds: 0,
        endedAt: new Date(),
      });
      const room = `session_${sessionId}`;
      io?.to(room).emit("timer_ended", { sessionId });
    });

    // Extension request (client -> admin)
    socket.on("extension_requested", ({ sessionId, minutes }) => {
      const room = `session_${sessionId}`;
      socket.to(room).emit("extension_notification", { sessionId, minutes });
    });

    // Extension confirmed (admin -> client)
    socket.on("extension_confirmed", async ({ sessionId, addMinutes }) => {
      try {
        const room = `session_${sessionId}`;
        io?.to(room).emit("extension_applied", { sessionId, addMinutes });
      } catch (err) {
        console.error("[Socket.io] extension_confirmed error:", err);
      }
    });

    // Extension resume (admin resumes timer after extension)
    socket.on("extension_resume", async ({ sessionId, remainingSeconds }) => {
      const now = Date.now();
      await updateSession(sessionId, {
        status: "active",
        timerStartedAt: now,
        remainingSeconds,
      });
      const room = `session_${sessionId}`;
      io?.to(room).emit("timer_update", {
        status: "active",
        remainingSeconds,
        timerStartedAt: now,
      });
    });

    // Carryover saved (admin)
    socket.on("carryover_saved", ({ sessionId, minutes }) => {
      const room = `session_${sessionId}`;
      io?.to(room).emit("session_ended", { sessionId, carryoverMinutes: minutes });
    });

    socket.on("disconnect", () => {
      console.log("[Socket.io] Client disconnected:", socket.id);
    });
  });

  return io;
}

export function getIO() {
  return io;
}
