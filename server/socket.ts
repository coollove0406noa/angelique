import type { Server as HttpServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import { createMessage, getSessionByToken, getSessionById, updateSession } from "./db";

let io: SocketIOServer | null = null;

// サーバー側でセッションのタイマー状態を管理
// key: sessionId, value: タイマー情報
interface TimerState {
  status: "idle" | "active" | "paused" | "ended";
  remainingSeconds: number;
  timerStartedAt: number | null; // タイマー開始時刻（ms）
  interval: ReturnType<typeof setInterval> | null;
}

const timerStates = new Map<number, TimerState>();

// お客様の接続状態を管理
// key: sessionId, value: お客様のsocket.id（接続中のみ）
const clientPresence = new Map<number, string>();

function getOrCreateTimerState(sessionId: number): TimerState {
  if (!timerStates.has(sessionId)) {
    timerStates.set(sessionId, {
      status: "idle",
      remainingSeconds: 0,
      timerStartedAt: null,
      interval: null,
    });
  }
  return timerStates.get(sessionId)!;
}

function startServerTimer(sessionId: number) {
  const state = getOrCreateTimerState(sessionId);
  if (state.interval) {
    clearInterval(state.interval);
    state.interval = null;
  }

  const room = `session_${sessionId}`;
  state.interval = setInterval(() => {
    const s = timerStates.get(sessionId);
    if (!s || s.status !== "active" || s.timerStartedAt === null) return;

    const elapsed = Math.floor((Date.now() - s.timerStartedAt) / 1000);
    const current = Math.max(0, s.remainingSeconds - elapsed);

    // 毎秒クライアントに送信
    io?.to(room).emit("timer_tick", { remainingSeconds: current });

    if (current <= 0) {
      // タイマー終了 → timer_endedのみ送信。session_endedはお客様の選択後に送る
      clearInterval(s.interval!);
      s.interval = null;
      s.status = "ended";
      s.remainingSeconds = 0;
      s.timerStartedAt = null;
      io?.to(room).emit("timer_ended", { sessionId });
      // DBを更新
      updateSession(sessionId, {
        status: "paused",
        timerStartedAt: null,
        remainingSeconds: 0,
        endedAt: new Date(),
      }).catch(console.error);
    }
  }, 1000);
}

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

      // お客様が接続したことを記録し、管理者に通知
      if (role === "client") {
        clientPresence.set(sessionId, socket.id);
        socket.to(room).emit("client_presence", { online: true });
        console.log(`[Socket.io] Client presence: online for session ${sessionId}`);
      }

      // 接続時に現在のタイマー状態を送信（再接続・遅延接続に対応）
      // メモリ上の状態がない場合（サーバー再起動後など）はDBから復元
      let state = timerStates.get(sessionId);
      if (!state || state.status === "idle") {
        try {
          const dbSession = await getSessionById(sessionId);
          if (dbSession && dbSession.status === "active" && dbSession.timerStartedAt) {
            // DBに active な状態があればメモリに復元してタイマーを再開
            const elapsed = Math.floor((Date.now() - dbSession.timerStartedAt) / 1000);
            const remaining = Math.max(0, (dbSession.remainingSeconds ?? 0) - elapsed);
            const restored = getOrCreateTimerState(sessionId);
            restored.status = "active";
            restored.remainingSeconds = dbSession.remainingSeconds ?? 0;
            restored.timerStartedAt = dbSession.timerStartedAt;
            state = restored;
            // タイマーが動いていなければ再開
            if (!restored.interval && remaining > 0) {
              startServerTimer(sessionId);
            }
          } else if (dbSession && dbSession.status === "paused") {
            const restored = getOrCreateTimerState(sessionId);
            restored.status = "paused";
            restored.remainingSeconds = dbSession.remainingSeconds ?? 0;
            restored.timerStartedAt = null;
            state = restored;
          }
        } catch (e) {
          console.error("[Socket.io] Failed to restore timer state from DB:", e);
        }
      }
      if (state && state.status !== "idle") {
        const elapsed = state.timerStartedAt
          ? Math.floor((Date.now() - state.timerStartedAt) / 1000)
          : 0;
        const currentRemaining = Math.max(0, state.remainingSeconds - elapsed);
        socket.emit("timer_update", {
          status: state.status,
          remainingSeconds: currentRemaining,
          timerStartedAt: state.timerStartedAt,
        });
      }

      // 管理者が接続したとき、お客様の接続状態を送信
      if (role === "admin") {
        const clientSocketId = clientPresence.get(sessionId);
        if (clientSocketId) {
          // お客様が既に接続しているか確認
          const clientSocket = io?.sockets.sockets.get(clientSocketId);
          if (clientSocket && clientSocket.connected) {
            socket.emit("client_presence", { online: true });
          } else {
            clientPresence.delete(sessionId);
          }
        }
      }

      // Notify others in room
      socket.to(room).emit("user_joined", { role });
    });

    // Waiting room: client joined waiting room (for admin to know)
    socket.on("waiting_room_join", ({ sessionId }) => {
      const room = `session_${sessionId}`;
      // ウェイティングルームに入ったお客様のソケットを登録（接続状態をonlineに）
      clientPresence.set(sessionId, socket.id);
      socket.data.sessionId = sessionId;
      socket.data.role = "client";
      socket.to(room).emit("client_waiting", { sessionId });
      // 管理者に接続状態も通知
      socket.to(room).emit("client_presence", { online: true });
      console.log(`[Socket.io] Client waiting in room ${room}`);
    });

    // Admin starts session from waiting room -> notify client to transition
    socket.on("session_start_notify", ({ sessionId }) => {
      const room = `session_${sessionId}`;
      io?.to(room).emit("session_started", { sessionId });
      console.log(`[Socket.io] session_start_notify emitted for room ${room}`);
    });

    // Chat message (supports optional image)
    socket.on("send_message", async ({ sessionId, sender, content, imageUrl, imageKey }) => {
      try {
        // base64 画像のサイズ制限（500KB）
        if (imageUrl && imageUrl.startsWith("data:")) {
          const byteSize = Math.floor(imageUrl.length * 0.75);
          if (byteSize > 500 * 1024) {
            console.warn("[Socket.io] imageUrl too large, rejected:", byteSize, "bytes");
            return;
          }
        }
        const msg = await createMessage({ sessionId, sender, content, imageUrl, imageKey });
        const room = `session_${sessionId}`;
        io?.to(room).emit("new_message", msg);
      } catch (err) {
        console.error("[Socket.io] send_message error:", err);
      }
    });

    // Timer control (admin only)
    // timer_start: 管理者が開始ボタンを押したとき
    socket.on("timer_start", async ({ sessionId, remainingSeconds }) => {
      const now = Date.now();
      const state = getOrCreateTimerState(sessionId);

      // 既存のインターバルをクリア
      if (state.interval) {
        clearInterval(state.interval);
        state.interval = null;
      }

      state.status = "active";
      state.remainingSeconds = remainingSeconds;
      state.timerStartedAt = now;

      // DBを更新
      await updateSession(sessionId, {
        status: "active",
        timerStartedAt: now,
        remainingSeconds,
      });

      const room = `session_${sessionId}`;
      // 全クライアントにタイマー開始を通知（ウェイティングルーム→チャット画面への切り替えトリガー）
      // session_startedを先に送信（ウェイティングルームの即座切り替え）
      io?.to(room).emit("session_started", { sessionId });
      // timer_updateも送信（タイマー状態の同期）
      io?.to(room).emit("timer_update", {
        status: "active",
        remainingSeconds,
        timerStartedAt: now,
      });
      // サーバー側でタイマーを開始（毎秒ブロードキャスト）
      startServerTimer(sessionId);
    });

    socket.on("timer_pause", async ({ sessionId, remainingSeconds }) => {
      const state = getOrCreateTimerState(sessionId);
      if (state.interval) {
        clearInterval(state.interval);
        state.interval = null;
      }
      state.status = "paused";
      state.remainingSeconds = remainingSeconds;
      state.timerStartedAt = null;

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
      const state = getOrCreateTimerState(sessionId);
      if (state.interval) {
        clearInterval(state.interval);
        state.interval = null;
      }
      state.status = "active";
      state.remainingSeconds = remainingSeconds;
      state.timerStartedAt = now;

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
      startServerTimer(sessionId);
    });

    socket.on("timer_end", async ({ sessionId }) => {
      const state = getOrCreateTimerState(sessionId);
      if (state.interval) {
        clearInterval(state.interval);
        state.interval = null;
      }
      state.status = "ended";
      state.remainingSeconds = 0;
      state.timerStartedAt = null;

      await updateSession(sessionId, {
        status: "paused",
        timerStartedAt: null,
        remainingSeconds: 0,
        endedAt: new Date(),
      });
      const room = `session_${sessionId}`;
      io?.to(room).emit("timer_ended", { sessionId });
      // 音声セッション終了時もお客様画面に通知（session_endedも送信）
      io?.to(room).emit("session_ended", { sessionId, carryoverMinutes: 0 });
    });

    // Extension request (client -> admin)
    socket.on("extension_requested", ({ sessionId, minutes }) => {
      const room = `session_${sessionId}`;
      socket.to(room).emit("extension_notification", { sessionId, minutes });
    });

    // Extension URL notify (admin -> client): チャットに送らず専用バーにURLを表示
    socket.on("extension_url_notify", ({ sessionId, minutes, url }) => {
      const room = `session_${sessionId}`;
      socket.to(room).emit("extension_url_received", { sessionId, minutes, url });
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
    socket.on("extension_resume", async ({ sessionId, remainingSeconds, timerStartedAt }) => {
      const startedAt = timerStartedAt ?? Date.now();
      const state = getOrCreateTimerState(sessionId);
      if (state.interval) {
        clearInterval(state.interval);
        state.interval = null;
      }
      state.status = "active";
      state.remainingSeconds = remainingSeconds;
      state.timerStartedAt = startedAt;

      await updateSession(sessionId, {
        status: "active",
        timerStartedAt: startedAt,
        remainingSeconds,
      });
      const room = `session_${sessionId}`;
      io?.to(room).emit("timer_update", {
        status: "active",
        remainingSeconds,
        timerStartedAt: startedAt,
      });
      startServerTimer(sessionId);
    });

    // Carryover saved (admin)
    socket.on("carryover_saved", ({ sessionId, minutes }) => {
      const room = `session_${sessionId}`;
      // タイマーを停止
      const state = timerStates.get(sessionId);
      if (state?.interval) {
        clearInterval(state.interval);
        state.interval = null;
      }
      io?.to(room).emit("session_ended", { sessionId, carryoverMinutes: minutes });
    });

    // Session ended by admin (direct completion without carryover)
    socket.on("session_ended", ({ sessionId }) => {
      const room = `session_${sessionId}`;
      // タイマーを停止
      const state = timerStates.get(sessionId);
      if (state?.interval) {
        clearInterval(state.interval);
        state.interval = null;
      }
      io?.to(room).emit("session_ended", { sessionId, carryoverMinutes: 0 });
    });

    // 延長確認ダイアログでのお客様の選択を管理者に中継
    socket.on("client_extension_choice", ({ sessionId, choice }: { sessionId: number; choice: "extend" | "end" }) => {
      const room = `session_${sessionId}`;
      socket.to(room).emit("client_extension_choice", { sessionId, choice });
      console.log(`[Socket.io] client_extension_choice: ${choice} for session ${sessionId}`);
    });

    // Session ended by client (customer-initiated)
    socket.on("client_end_session", ({ sessionId }) => {
      const room = `session_${sessionId}`;
      io?.to(room).emit("client_ended_session", { sessionId });
      console.log(`[Socket.io] client_end_session for room ${room}`);
    });

    socket.on("screen_share_start", ({ sessionId }) => {
      const room = `session_${sessionId}`;
      socket.to(room).emit("remote_screen_share_start", { sessionId });
    });

    socket.on("screen_share_stop", ({ sessionId }) => {
      const room = `session_${sessionId}`;
      socket.to(room).emit("remote_screen_share_stop", { sessionId });
    });

    socket.on("disconnect", () => {
      console.log("[Socket.io] Client disconnected:", socket.id);
      // お客様が切断したとき、管理者に通知
      const sessionId = socket.data.sessionId;
      const role = socket.data.role;
      if (sessionId && role === "client") {
        const storedSocketId = clientPresence.get(sessionId);
        if (storedSocketId === socket.id) {
          clientPresence.delete(sessionId);
          const room = `session_${sessionId}`;
          io?.to(room).emit("client_presence", { online: false });
          console.log(`[Socket.io] Client presence: offline for session ${sessionId}`);
        }
      }
    });
  });

  return io;
}

export function getIO() {
  return io;
}
