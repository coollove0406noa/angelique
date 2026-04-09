import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import AngeliqueHeader from "@/components/AngeliqueHeader";
import VoiceCall from "@/components/VoiceCall";
import LinkifiedText from "@/components/LinkifiedText";
import AdminLogin from "./AdminLogin";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { io, Socket } from "socket.io-client";
import { format } from "date-fns";
import { ja } from "date-fns/locale";

// ── スタンプ定義 ──────────────────────────────────────────────────────────
const STAMPS = [
  { label: "少々お待ちください🙏", text: "少々お待ちください🙏" },
  { label: "承知しました✨", text: "承知しました✨" },
  { label: "ありがとうございました🌙", text: "ありがとうございました🌙" },
  { label: "確認中です⭐", text: "確認中です⭐" },
];

type Message = {
  id: number;
  sessionId: number;
  sender: "admin" | "client" | "system";
  content: string;
  imageUrl?: string | null;
  createdAt: Date;
};

type Session = {
  id: number;
  clientId: number;
  clientToken: string;
  scheduledAt: Date;
  durationMinutes: number;
  carryoverMinutes: number;
  sessionType: "chat" | "voice";
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
  // Use refs for alert flags to avoid stale closure in setInterval
  const alert5mFiredRef = useRef(false);
  const alert1mFiredRef = useRef(false);
  const [screenFlash, setScreenFlash] = useState(false);
  const [showCarryoverModal, setShowCarryoverModal] = useState(false);
  const [carryoverMinutes, setCarryoverMinutes] = useState("");
  const [showExtendModal, setShowExtendModal] = useState(false);
  const [extensionNotification, setExtensionNotification] = useState<{ minutes: number } | null>(null);
  // 画像アップロード
  const [uploadingImage, setUploadingImage] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  // クライアント待機通知
  const [clientWaiting, setClientWaiting] = useState(false);
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
  const uploadImageMutation = trpc.messages.uploadImage.useMutation();

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

    // クライアントがウェイティングルームに入ったことを通知
    socket.on("client_waiting", () => {
      setClientWaiting(true);
      toast.info("お客様がウェイティングルームで待機中です", { duration: 6000 });
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

        // 5-minute alert (once)
        if (current <= 5 * 60 && current > 5 * 60 - 2 && !alert5mFiredRef.current) {
          alert5mFiredRef.current = true;
          triggerChime("5min");
        }
        // 1-minute alert (once)
        if (current <= 60 && current > 58 && !alert1mFiredRef.current) {
          alert1mFiredRef.current = true;
          triggerChime("1min");
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

  function triggerChime(type: "5min" | "1min") {
    try {
      const ctx = new AudioContext();
      const gain = ctx.createGain();
      gain.connect(ctx.destination);

      if (type === "5min") {
        const notes = [523.25, 659.25];
        notes.forEach((freq, i) => {
          const osc = ctx.createOscillator();
          osc.connect(gain);
          osc.type = "sine";
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(0.25, ctx.currentTime + i * 0.3);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.3 + 0.6);
          osc.start(ctx.currentTime + i * 0.3);
          osc.stop(ctx.currentTime + i * 0.3 + 0.7);
        });
        setTimeout(() => ctx.close(), 1500);
        setScreenFlash(true);
        setTimeout(() => setScreenFlash(false), 2000);
        toast.warning("残り5分です！", { duration: 5000 });
      } else {
        const notes = [659.25, 783.99, 1046.5];
        notes.forEach((freq, i) => {
          const osc = ctx.createOscillator();
          osc.connect(gain);
          osc.type = "sine";
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(0.2, ctx.currentTime + i * 0.25);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.25 + 0.5);
          osc.start(ctx.currentTime + i * 0.25);
          osc.stop(ctx.currentTime + i * 0.25 + 0.6);
        });
        setTimeout(() => ctx.close(), 1200);
        setScreenFlash(true);
        setTimeout(() => setScreenFlash(false), 1500);
        toast.warning("残り1分です！", { duration: 5000 });
      }
    } catch {}
  }

  const handleStartTimer = useCallback(() => {
    if (!session) return;
    const totalSeconds = (session.durationMinutes + session.carryoverMinutes) * 60;
    const now = Date.now();
    setRemainingSeconds(totalSeconds);
    setTimerStartedAt(now);
    setTimerStatus("active");
    alert5mFiredRef.current = false;
    alert1mFiredRef.current = false;
    socketRef.current?.emit("timer_start", { sessionId, remainingSeconds: totalSeconds });
    updateSessionMutation.mutate({
      id: sessionId,
      status: "active",
      startedAt: new Date().toISOString(),
      remainingSeconds: totalSeconds,
      timerStartedAt: now,
    });
  }, [session, sessionId]);

  // セッション開始通知（ウェイティングルームのクライアントに通知）
  const handleStartSession = useCallback(() => {
    socketRef.current?.emit("session_start_notify", { sessionId });
    setClientWaiting(false);
    toast.success("お客様にセッション開始を通知しました");
    handleStartTimer();
  }, [sessionId, handleStartTimer]);

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

  // スタンプ送信
  const handleSendStamp = useCallback((text: string) => {
    socketRef.current?.emit("send_message", {
      sessionId,
      sender: "admin",
      content: text,
    });
    toast.success("送信しました");
  }, [sessionId]);

  // 画像送信
  const handleImageSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      toast.error("画像は5MB以下にしてください");
      return;
    }

    setUploadingImage(true);
    try {
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const base64Data = ev.target?.result as string;
        const result = await uploadImageMutation.mutateAsync({
          sessionId,
          sender: "admin",
          base64Data,
          mimeType: file.type,
          fileName: file.name,
        });
        socketRef.current?.emit("send_message", {
          sessionId,
          sender: "admin",
          content: "📷 画像を送信しました",
          imageUrl: result.url,
          imageKey: result.key,
        });
        setUploadingImage(false);
      };
      reader.readAsDataURL(file);
    } catch {
      toast.error("画像の送信に失敗しました");
      setUploadingImage(false);
    }
    if (imageInputRef.current) imageInputRef.current.value = "";
  }, [sessionId, uploadImageMutation]);

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
          <div className="flex items-center gap-3">
            {/* クライアント待機通知バッジ */}
            {clientWaiting && timerStatus === "idle" && (
              <div
                style={{
                  background: "#fff3e0",
                  border: "1px solid #f57c00",
                  borderRadius: "8px",
                  padding: "4px 10px",
                  fontSize: "12px",
                  color: "#e65100",
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                🔔 お客様が待機中
              </div>
            )}
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
                    <div className="chat-bubble-system">
                      <LinkifiedText text={msg.content} />
                    </div>
                  ) : (
                    <div>
                      {msg.sender === "client" && (
                        <div style={{ fontSize: "11px", color: "#9e8480", marginBottom: "3px", marginLeft: "4px" }}>
                          {session?.clientName}
                        </div>
                      )}
                      {/* 画像メッセージ */}
                      {(msg as any).imageUrl ? (
                        <div>
                          <img
                            src={(msg as any).imageUrl}
                            alt="送信画像"
                            style={{
                              maxWidth: "200px",
                              borderRadius: "12px",
                              cursor: "pointer",
                              border: "1px solid #d4bfbb",
                            }}
                            onClick={() => window.open((msg as any).imageUrl, "_blank")}
                          />
                        </div>
                      ) : (
                        <div
                          className={
                            msg.sender === "admin" ? "chat-bubble-admin" : "chat-bubble-client"
                          }
                        >
                          {msg.content}
                        </div>
                      )}
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

            {/* スタンプパネル */}
            <div
              style={{
                borderTop: "1px solid #f3e7e5",
                padding: "8px 12px",
                display: "flex",
                gap: "6px",
                flexWrap: "wrap",
                background: "#fdfaf9",
              }}
            >
              {STAMPS.map((stamp) => (
                <button
                  key={stamp.text}
                  onClick={() => handleSendStamp(stamp.text)}
                  style={{
                    background: "#f3e7e5",
                    border: "1px solid #d4bfbb",
                    borderRadius: "20px",
                    padding: "4px 12px",
                    fontSize: "12px",
                    color: "#6b5b58",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    transition: "all 0.15s",
                    fontFamily: "'Noto Sans JP', sans-serif",
                  }}
                  onMouseOver={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background = "#e8d5d0";
                  }}
                  onMouseOut={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background = "#f3e7e5";
                  }}
                  title={`ワンタップ送信: ${stamp.text}`}
                >
                  {stamp.label}
                </button>
              ))}
            </div>

            {/* Input */}
            <div
              className="p-3 flex gap-2"
              style={{ borderTop: "1px solid #f3e7e5" }}
            >
              {/* 画像添付ボタン */}
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={handleImageSelect}
              />
              <button
                onClick={() => imageInputRef.current?.click()}
                disabled={uploadingImage}
                style={{
                  background: "transparent",
                  border: "1px solid #d4bfbb",
                  borderRadius: "8px",
                  padding: "8px 10px",
                  fontSize: "18px",
                  cursor: "pointer",
                  color: "#c9a8a3",
                  alignSelf: "flex-end",
                  opacity: uploadingImage ? 0.5 : 1,
                }}
                title="画像を送信"
                aria-label="画像を送信"
              >
                {uploadingImage ? "⏳" : "📷"}
              </button>
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
            {/* Voice Call Panel (voice sessions only) */}
            {session?.sessionType === "voice" && (
              <VoiceCall
                sessionId={sessionId}
                role="admin"
                isSessionActive={timerStatus === "active" || timerStatus === "paused"}
              />
            )}
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
                  <>
                    {/* セッション開始（ウェイティングルームのクライアントに通知） */}
                    <button
                      className="angelique-btn justify-center"
                      onClick={handleStartSession}
                      style={{
                        justifyContent: "center",
                        background: clientWaiting ? "#c9a8a3" : undefined,
                        position: "relative",
                      }}
                    >
                      {clientWaiting && (
                        <span
                          style={{
                            position: "absolute",
                            top: "-4px",
                            right: "-4px",
                            width: "10px",
                            height: "10px",
                            background: "#f57c00",
                            borderRadius: "50%",
                          }}
                        />
                      )}
                      ▶ セッション開始
                    </button>
                    <p style={{ fontSize: "10px", color: "#9e8480", marginTop: "2px" }}>
                      ※ お客様の待機画面が自動でチャット画面に切り替わります
                    </p>
                  </>
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
                  お客様が延長を申請しました
                </p>
                <button
                  className="angelique-btn justify-center"
                  onClick={() => handleExtensionResume(10)}
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
