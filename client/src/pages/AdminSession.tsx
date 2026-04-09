import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import AngeliqueHeader from "@/components/AngeliqueHeader";
import AdminLogin from "./AdminLogin";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { io, Socket } from "socket.io-client";
import { format } from "date-fns";
import { ja } from "date-fns/locale";

type Message = {
  id: number;
  sessionId: number;
  sender: "admin" | "client" | "system";
  content: string;
  createdAt: Date;
};

type Session = {
  id: number;
  clientId: number;
  clientToken: string;
  scheduledAt: Date;
  durationMinutes: number;
  carryoverMinutes: number;
  status: string;
  startedAt: Date | null;
  endedAt: Date | null;
  remainingSeconds: number | null;
  timerStartedAt: number | null;
  clientName: string | null;
  clientEmail: string | null;
};

const ALERT_THRESHOLD = 5 * 60; // 5 minutes in seconds

export default function AdminSession() {
  const { id } = useParams<{ id: string }>();
  const sessionId = Number(id);
  const [, navigate] = useLocation();
  const { isAuthenticated, isLoading, refetch: refetchAuth } = useAdminAuth();

  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [timerStartedAt, setTimerStartedAt] = useState<number | null>(null);
  const [timerStatus, setTimerStatus] = useState<"idle" | "active" | "paused" | "ended">("idle");
  const [alertFired, setAlertFired] = useState(false);
  const [screenFlash, setScreenFlash] = useState(false);
  const [showCarryoverModal, setShowCarryoverModal] = useState(false);
  const [carryoverMinutes, setCarryoverMinutes] = useState("");
  const [showExtendModal, setShowExtendModal] = useState(false);
  const [extensionNotification, setExtensionNotification] = useState<{ minutes: number } | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // tRPC
  const { data: sessionData, refetch: refetchSession } = trpc.sessions.get.useQuery(
    { id: sessionId },
    { enabled: !!sessionId && isAuthenticated }
  );
  const { data: initialMessages } = trpc.messages.list.useQuery(
    { sessionId },
    { enabled: !!sessionId && isAuthenticated }
  );
  const { data: storeSettings } = trpc.settings.list.useQuery(undefined, { enabled: isAuthenticated });

  const updateSessionMutation = trpc.sessions.update.useMutation();
  const carryoverMutation = trpc.carryover.save.useMutation({
    onSuccess: () => {
      toast.success("繰越を保存しました");
      setShowCarryoverModal(false);
    },
    onError: (e) => toast.error(e.message),
  });
  const addExtensionMutation = trpc.sessions.addExtensionTime.useMutation({
    onSuccess: (data) => {
      setRemainingSeconds(data.remainingSeconds);
      setTimerStartedAt(data.timerStartedAt);
      setTimerStatus("active");
      toast.success("延長しました");
    },
    onError: (e) => toast.error(e.message),
  });
  const logoutMutation = trpc.admin.logout.useMutation({ onSuccess: () => refetchAuth() });

  // Initialize session state
  useEffect(() => {
    if (sessionData) {
      setSession(sessionData as unknown as Session);
      const secs = sessionData.remainingSeconds ?? 0;
      setRemainingSeconds(secs);
      setTimerStartedAt(sessionData.timerStartedAt ?? null);
      if (sessionData.status === "active") setTimerStatus("active");
      else if (sessionData.status === "paused") setTimerStatus("paused");
      else if (sessionData.status === "completed") setTimerStatus("ended");
    }
  }, [sessionData]);

  // Initialize messages
  useEffect(() => {
    if (initialMessages) {
      setMessages(initialMessages as Message[]);
    }
  }, [initialMessages]);

  // Socket.io
  useEffect(() => {
    if (!sessionId || !isAuthenticated) return;

    const socket = io(window.location.origin, {
      path: "/api/socket.io",
      transports: ["websocket", "polling"],
    });

    socket.on("connect", () => {
      setConnected(true);
      socket.emit("join_session", { sessionId, role: "admin" });
    });
    socket.on("disconnect", () => setConnected(false));

    socket.on("new_message", (msg: Message) => {
      setMessages((prev) => [...prev, msg]);
    });

    socket.on("timer_update", ({ status, remainingSeconds: rs, timerStartedAt: tsa }) => {
      setRemainingSeconds(rs);
      setTimerStartedAt(tsa);
      if (status === "active") setTimerStatus("active");
      else if (status === "paused") setTimerStatus("paused");
    });

    socket.on("timer_ended", () => {
      setTimerStatus("ended");
      setRemainingSeconds(0);
    });

    socket.on("extension_notification", ({ minutes }: { minutes: number }) => {
      setExtensionNotification({ minutes });
      toast.info(`お客様が${minutes}分の延長を申請しました`);
    });

    socketRef.current = socket;
    return () => { socket.disconnect(); };
  }, [sessionId, isAuthenticated]);

  // Timer countdown
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);

    if (timerStatus === "active" && timerStartedAt !== null) {
      timerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - timerStartedAt) / 1000);
        const current = Math.max(0, remainingSeconds - elapsed);
        setRemainingSeconds(current);

        // 5-minute alert
        if (current <= ALERT_THRESHOLD && current > 0 && !alertFired) {
          setAlertFired(true);
          triggerAlert();
        }

        // Timer ended
        if (current <= 0) {
          clearInterval(timerRef.current!);
          setTimerStatus("ended");
          socketRef.current?.emit("timer_end", { sessionId });
          updateSessionMutation.mutate({
            id: sessionId,
            status: "paused",
            remainingSeconds: 0,
            timerStartedAt: null,
          });
        }
      }, 1000);
    }

    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [timerStatus, timerStartedAt]);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function triggerAlert() {
    // Play beep
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      gain.gain.value = 0.3;
      osc.start();
      setTimeout(() => { osc.stop(); ctx.close(); }, 800);
    } catch {}

    // Screen flash
    setScreenFlash(true);
    setTimeout(() => setScreenFlash(false), 3000);
    toast.warning("残り5分です！", { duration: 5000 });
  }

  const handleStartTimer = useCallback(() => {
    if (!session) return;
    const totalSeconds = (session.durationMinutes + session.carryoverMinutes) * 60;
    const now = Date.now();
    setRemainingSeconds(totalSeconds);
    setTimerStartedAt(now);
    setTimerStatus("active");
    setAlertFired(false);
    socketRef.current?.emit("timer_start", { sessionId, remainingSeconds: totalSeconds });
    updateSessionMutation.mutate({
      id: sessionId,
      status: "active",
      startedAt: new Date().toISOString(),
      remainingSeconds: totalSeconds,
      timerStartedAt: now,
    });
  }, [session, sessionId]);

  const handlePauseTimer = useCallback(() => {
    const elapsed = timerStartedAt ? Math.floor((Date.now() - timerStartedAt) / 1000) : 0;
    const current = Math.max(0, remainingSeconds - elapsed);
    setRemainingSeconds(current);
    setTimerStartedAt(null);
    setTimerStatus("paused");
    socketRef.current?.emit("timer_pause", { sessionId, remainingSeconds: current });
    updateSessionMutation.mutate({
      id: sessionId,
      status: "paused",
      remainingSeconds: current,
      timerStartedAt: null,
    });
  }, [timerStartedAt, remainingSeconds, sessionId]);

  const handleResumeTimer = useCallback(() => {
    const now = Date.now();
    setTimerStartedAt(now);
    setTimerStatus("active");
    socketRef.current?.emit("timer_resume", { sessionId, remainingSeconds });
    updateSessionMutation.mutate({
      id: sessionId,
      status: "active",
      remainingSeconds,
      timerStartedAt: now,
    });
  }, [remainingSeconds, sessionId]);

  const handleSendMessage = useCallback(() => {
    if (!inputText.trim()) return;
    socketRef.current?.emit("send_message", {
      sessionId,
      sender: "admin",
      content: inputText.trim(),
    });
    setInputText("");
  }, [inputText, sessionId]);

  const handleSendExtensionLink = useCallback((minutes: number) => {
    const settings = storeSettings ?? [];
    const urlMap: Record<number, string> = {
      10: settings.find((s) => s.key === "stores_url_10min")?.value ?? "",
      20: settings.find((s) => s.key === "stores_url_20min")?.value ?? "",
      30: settings.find((s) => s.key === "stores_url_30min")?.value ?? "",
    };
    const url = urlMap[minutes];
    if (!url) {
      toast.error("延長URLが設定されていません。設定画面でURLを登録してください。");
      return;
    }
    const message = `【延長のご案内】\n${minutes}分延長をご希望の場合は、下記URLよりお手続きください。\n${url}`;
    socketRef.current?.emit("send_message", {
      sessionId,
      sender: "system",
      content: message,
    });
    setShowExtendModal(false);
    toast.success(`${minutes}分延長URLを送信しました`);
  }, [storeSettings, sessionId]);

  const handleExtensionResume = useCallback((minutes: number) => {
    setExtensionNotification(null);
    addExtensionMutation.mutate({ id: sessionId, addMinutes: minutes });
    socketRef.current?.emit("extension_resume", {
      sessionId,
      remainingSeconds: remainingSeconds + minutes * 60,
    });
  }, [sessionId, remainingSeconds]);

  const handleCarryoverSave = useCallback(() => {
    const mins = Number(carryoverMinutes);
    if (!mins || mins <= 0) { toast.error("分数を入力してください"); return; }
    if (!session) return;
    carryoverMutation.mutate({
      clientId: session.clientId,
      sessionId,
      minutes: mins,
      note: `セッション終了時の繰越`,
    });
    socketRef.current?.emit("carryover_saved", { sessionId, minutes: mins });
    updateSessionMutation.mutate({ id: sessionId, status: "completed", endedAt: new Date().toISOString() });
  }, [carryoverMinutes, session, sessionId]);

  const handleCompleteSession = useCallback(() => {
    if (confirm("セッションを完了しますか？")) {
      updateSessionMutation.mutate({ id: sessionId, status: "completed", endedAt: new Date().toISOString() });
      socketRef.current?.emit("session_ended", { sessionId, carryoverMinutes: 0 });
      toast.success("セッションを完了しました");
      navigate("/admin");
    }
  }, [sessionId, navigate]);

  // Display timer
  const displaySeconds = (() => {
    if (timerStatus === "active" && timerStartedAt) {
      const elapsed = Math.floor((Date.now() - timerStartedAt) / 1000);
      return Math.max(0, remainingSeconds - elapsed);
    }
    return remainingSeconds;
  })();

  const timerMins = Math.floor(displaySeconds / 60);
  const timerSecs = displaySeconds % 60;
  const timerStr = `${String(timerMins).padStart(2, "0")}:${String(timerSecs).padStart(2, "0")}`;
  const isWarning = displaySeconds <= ALERT_THRESHOLD && displaySeconds > 0;
  const isEnded = timerStatus === "ended" || displaySeconds === 0;

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#f9f5f4" }}>
        <div style={{ color: "#9e8480" }}>読み込み中...</div>
      </div>
    );
  }

  if (!isAuthenticated) return <AdminLogin onSuccess={refetchAuth} />;

  return (
    <div
      className={`min-h-screen flex flex-col ${screenFlash ? "screen-flash-anim" : ""}`}
      style={{ background: "#f9f5f4" }}
    >
      <AngeliqueHeader isAdmin onLogout={() => logoutMutation.mutate()} />

      <div className="flex-1 flex flex-col max-w-6xl mx-auto w-full px-4 py-6 gap-4">
        {/* Session Info Bar */}
        <div className="angelique-card p-4 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div style={{ fontSize: "18px", fontWeight: 500, color: "#6b5b58" }}>
              {session?.clientName ?? "読み込み中..."}
            </div>
            <div style={{ fontSize: "12px", color: "#9e8480" }}>
              {session && format(new Date(session.scheduledAt), "M/d (E) HH:mm", { locale: ja })} ·{" "}
              {session?.durationMinutes}分
              {(session?.carryoverMinutes ?? 0) > 0 && ` (+${session?.carryoverMinutes}分繰越)`}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                background: connected ? "#4caf50" : "#ccc",
              }}
            />
            <span style={{ fontSize: "12px", color: "#9e8480" }}>
              {connected ? "接続中" : "切断"}
            </span>
          </div>
        </div>

        <div className="flex gap-4 flex-1" style={{ minHeight: 0 }}>
          {/* Chat Area */}
          <div
            className="angelique-card flex flex-col flex-1"
            style={{ minHeight: 0, height: "calc(100vh - 280px)" }}
          >
            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
              {messages.length === 0 && (
                <div className="flex-1 flex items-center justify-center">
                  <p style={{ color: "#d4bfbb", fontSize: "14px" }}>
                    チャットを開始してください
                  </p>
                </div>
              )}
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${
                    msg.sender === "admin"
                      ? "justify-end"
                      : msg.sender === "system"
                      ? "justify-center"
                      : "justify-start"
                  }`}
                >
                  {msg.sender === "system" ? (
                    <div className="chat-bubble-system">{msg.content}</div>
                  ) : (
                    <div>
                      {msg.sender === "client" && (
                        <div style={{ fontSize: "11px", color: "#9e8480", marginBottom: "3px", marginLeft: "4px" }}>
                          {session?.clientName}
                        </div>
                      )}
                      <div
                        className={
                          msg.sender === "admin" ? "chat-bubble-admin" : "chat-bubble-client"
                        }
                      >
                        {msg.content}
                      </div>
                      <div
                        style={{
                          fontSize: "10px",
                          color: "#d4bfbb",
                          marginTop: "3px",
                          textAlign: msg.sender === "admin" ? "right" : "left",
                        }}
                      >
                        {format(new Date(msg.createdAt), "HH:mm")}
                      </div>
                    </div>
                  )}
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>

            {/* Input */}
            <div
              className="p-3 flex gap-2"
              style={{ borderTop: "1px solid #f3e7e5" }}
            >
              <textarea
                className="angelique-input flex-1"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                placeholder="メッセージを入力（Enterで送信）"
                rows={2}
                style={{ resize: "none" }}
              />
              <button
                className="angelique-btn"
                onClick={handleSendMessage}
                disabled={!inputText.trim()}
                style={{ alignSelf: "flex-end", padding: "10px 20px" }}
              >
                送信
              </button>
            </div>
          </div>

          {/* Right Panel: Timer + Controls */}
          <div className="flex flex-col gap-4" style={{ width: "280px", minWidth: "280px" }}>
            {/* Timer */}
            <div className="angelique-card p-6 text-center">
              <div style={{ fontSize: "12px", color: "#9e8480", marginBottom: "8px" }}>残り時間</div>
              <div
                className={`timer-display ${isWarning && timerStatus === "active" ? "timer-flash warning" : ""} ${isEnded ? "ended" : ""}`}
              >
                {timerStr}
              </div>
              <div style={{ fontSize: "11px", color: "#d4bfbb", marginTop: "8px" }}>
                {timerStatus === "active" && "進行中"}
                {timerStatus === "paused" && "一時停止"}
                {timerStatus === "ended" && "時間終了"}
                {timerStatus === "idle" && "未開始"}
              </div>

              {/* Timer Controls */}
              <div className="flex flex-col gap-2 mt-4">
                {timerStatus === "idle" && (
                  <button className="angelique-btn justify-center" onClick={handleStartTimer}>
                    ▶ タイマー開始
                  </button>
                )}
                {timerStatus === "active" && (
                  <button className="angelique-btn-outline justify-center" onClick={handlePauseTimer}>
                    ⏸ 一時停止
                  </button>
                )}
                {timerStatus === "paused" && (
                  <button className="angelique-btn justify-center" onClick={handleResumeTimer}>
                    ▶ 再開
                  </button>
                )}
              </div>
            </div>

            {/* Extension Notification */}
            {extensionNotification && (
              <div
                className="angelique-card p-4"
                style={{ borderLeft: "3px solid #c9a8a3" }}
              >
                <div style={{ fontSize: "13px", color: "#6b5b58", fontWeight: 500, marginBottom: "8px" }}>
                  🔔 延長申請
                </div>
                <p style={{ fontSize: "12px", color: "#9e8480", marginBottom: "12px" }}>
                  お客様が{extensionNotification.minutes}分の延長を申請しました
                </p>
                <button
                  className="angelique-btn justify-center w-full"
                  onClick={() => handleExtensionResume(extensionNotification.minutes)}
                  style={{ width: "100%", justifyContent: "center" }}
                >
                  ▶ 延長して再開
                </button>
              </div>
            )}

            {/* Action Buttons */}
            <div className="angelique-card p-4 flex flex-col gap-2">
              <div style={{ fontSize: "12px", color: "#9e8480", marginBottom: "4px", fontWeight: 500 }}>
                セッション操作
              </div>
              <button
                className="angelique-btn-outline justify-center"
                onClick={() => setShowExtendModal(true)}
                style={{ justifyContent: "center" }}
              >
                ⏱ 時間を延長する
              </button>
              <button
                className="angelique-btn-outline justify-center"
                onClick={() => setShowCarryoverModal(true)}
                style={{ justifyContent: "center" }}
              >
                📋 次回に繰り越す
              </button>
              <button
                className="angelique-btn-danger justify-center"
                onClick={handleCompleteSession}
                style={{ justifyContent: "center" }}
              >
                ✓ セッション完了
              </button>
            </div>

            {/* Client URL */}
            {session && (
              <div className="angelique-card p-4">
                <div style={{ fontSize: "12px", color: "#9e8480", marginBottom: "8px" }}>お客様URL</div>
                <div
                  style={{
                    fontSize: "11px",
                    color: "#6b5b58",
                    wordBreak: "break-all",
                    background: "#f9f5f4",
                    padding: "8px",
                    borderRadius: "8px",
                    marginBottom: "8px",
                  }}
                >
                  {window.location.origin}/session/{session.clientToken}
                </div>
                <button
                  className="angelique-btn-outline"
                  style={{ padding: "5px 12px", fontSize: "12px", width: "100%", justifyContent: "center" }}
                  onClick={() => {
                    navigator.clipboard.writeText(`${window.location.origin}/session/${session.clientToken}`);
                    toast.success("URLをコピーしました");
                  }}
                >
                  URLをコピー
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Extend Modal */}
      {showExtendModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(107,91,88,0.2)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowExtendModal(false); }}
        >
          <div className="angelique-card p-8 w-full max-w-sm mx-4">
            <h3
              style={{
                fontFamily: "'Cormorant Garamond', serif",
                fontSize: "22px",
                color: "#6b5b58",
                marginBottom: "20px",
              }}
            >
              時間を延長する
            </h3>
            <p style={{ fontSize: "13px", color: "#9e8480", marginBottom: "20px" }}>
              延長URLをお客様のチャットに送信します
            </p>
            <div className="flex flex-col gap-3">
              {[10, 20, 30].map((mins) => (
                <button
                  key={mins}
                  className="angelique-btn justify-center"
                  onClick={() => handleSendExtensionLink(mins)}
                  style={{ justifyContent: "center" }}
                >
                  {mins}分延長URLを送信
                </button>
              ))}
            </div>
            <button
              className="angelique-btn-outline mt-4 justify-center"
              onClick={() => setShowExtendModal(false)}
              style={{ width: "100%", justifyContent: "center" }}
            >
              キャンセル
            </button>
          </div>
        </div>
      )}

      {/* Carryover Modal */}
      {showCarryoverModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(107,91,88,0.2)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowCarryoverModal(false); }}
        >
          <div className="angelique-card p-8 w-full max-w-sm mx-4">
            <h3
              style={{
                fontFamily: "'Cormorant Garamond', serif",
                fontSize: "22px",
                color: "#6b5b58",
                marginBottom: "8px",
              }}
            >
              次回に繰り越す
            </h3>
            <p style={{ fontSize: "13px", color: "#9e8480", marginBottom: "20px" }}>
              現在の残り時間: {timerMins}分{timerSecs}秒
            </p>
            <div className="mb-6">
              <label className="angelique-label">繰り越す分数</label>
              <input
                type="number"
                className="angelique-input"
                value={carryoverMinutes}
                onChange={(e) => setCarryoverMinutes(e.target.value)}
                placeholder={String(timerMins)}
                min={1}
                autoFocus
              />
              <p style={{ fontSize: "11px", color: "#9e8480", marginTop: "6px" }}>
                ※ 次回セッション作成時に自動加算されます
              </p>
            </div>
            <div className="flex gap-3">
              <button
                className="angelique-btn"
                onClick={handleCarryoverSave}
                disabled={carryoverMutation.isPending}
              >
                {carryoverMutation.isPending ? "保存中..." : "保存して完了"}
              </button>
              <button
                className="angelique-btn-outline"
                onClick={() => setShowCarryoverModal(false)}
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
