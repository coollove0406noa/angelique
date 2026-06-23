import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import AngeliqueHeader from "@/components/AngeliqueHeader";
import VoiceCall from "@/components/VoiceCall";
import VideoCall from "@/components/VideoCall";
import { MicTest } from "@/components/MicTest";
import LinkifiedText from "@/components/LinkifiedText";
import AdminLogin from "./AdminLogin";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { useBrand } from "@/contexts/BrandContext";
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
  sessionType: "chat" | "voice" | "video";
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
  const { slug, id } = useParams<{ slug: string; id: string }>();
  const sessionId = Number(id);
  const [, navigate] = useLocation();
  const { isAuthenticated, isLoading, fortuneTeller, refetch: refetchAuth } = useAdminAuth();
  const { colors } = useBrand();

  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [timerStartedAt, setTimerStartedAt] = useState<number | null>(null);
  const [timerStatus, setTimerStatus] = useState<"idle" | "active" | "paused" | "ended">("idle");
  // Use refs for alert flags AND timer state to avoid stale closure in setInterval
  const alert5mFiredRef = useRef(false);
  const alert1mFiredRef = useRef(false);
  const remainingSecondsRef = useRef(0);
  const timerStartedAtRef = useRef<number | null>(null);
  const [screenFlash, setScreenFlash] = useState(false);
  const [showCarryoverModal, setShowCarryoverModal] = useState(false);
  const [carryoverMinutes, setCarryoverMinutes] = useState("");
  const [showExtendModal, setShowExtendModal] = useState(false);
  const [extensionNotification, setExtensionNotification] = useState<{ minutes: number } | null>(null);
  // 画像アップロード
  const [uploadingImage, setUploadingImage] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  // スタンプタブ
  const [stampTab, setStampTab] = useState<"text" | "custom">("text");
  // クライアント待機通知
  const [clientWaiting, setClientWaiting] = useState(false);
  const [clientEndedByClient, setClientEndedByClient] = useState(false);
  // お客様の延長/終了選択通知
  const [clientExtensionChoice, setClientExtensionChoice] = useState<"extend" | "end" | null>(null);
  // お客様の接続状態（Socket.ioでリアルタイム検知）
  const [clientOnline, setClientOnline] = useState(false);
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
  const { data: storeSettings } = trpc.settings.list.useQuery(
    { fortuneTellerId: fortuneTeller?.fortuneTellerId ?? 0 },
    { enabled: isAuthenticated && !!fortuneTeller }
  );

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
      const newRemaining = data.remainingSeconds;
      const newTimerStartedAt = data.timerStartedAt;
      setRemainingSeconds(newRemaining);
      remainingSecondsRef.current = newRemaining;
      setTimerStartedAt(newTimerStartedAt);
      timerStartedAtRef.current = newTimerStartedAt;
      setTimerStatus("active");
      alert5mFiredRef.current = false;
      alert1mFiredRef.current = false;
      // DBに保存された正確な値でSocket.ioに通知（二重加算を防ぐ）
      socketRef.current?.emit("extension_resume", {
        sessionId,
        remainingSeconds: newRemaining,
        timerStartedAt: newTimerStartedAt,
      });
      toast.success("延長しました");
    },
    onError: (e) => toast.error(e.message),
  });
  const logoutMutation = trpc.admin.logout.useMutation({ onSuccess: () => refetchAuth() });
  const { data: customStamps } = trpc.stamps.list.useQuery(
    { fortuneTellerId: fortuneTeller?.fortuneTellerId ?? 0 },
    { enabled: isAuthenticated && !!fortuneTeller }
  );

  // Initialize session state
  useEffect(() => {
    if (sessionData) {
      setSession(sessionData as unknown as Session);
      const secs = sessionData.remainingSeconds ?? 0;
      setRemainingSeconds(secs);
      remainingSecondsRef.current = secs;
      const tsa = sessionData.timerStartedAt ?? null;
      setTimerStartedAt(tsa);
      timerStartedAtRef.current = tsa;
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
      remainingSecondsRef.current = rs;
      setTimerStartedAt(tsa);
      timerStartedAtRef.current = tsa;
      if (status === "active") setTimerStatus("active");
      else if (status === "paused") setTimerStatus("paused");
    });

    socket.on("timer_ended", () => {
      setTimerStatus("ended");
      setRemainingSeconds(0);
      remainingSecondsRef.current = 0;
    });

    socket.on("extension_notification", ({ minutes }: { minutes: number }) => {
      setExtensionNotification({ minutes });
      toast.info(`お客様が${minutes}分の延長を申請しました`);
    });

    // クライアントがウェイティングルームに入ったことを通知
    socket.on("client_waiting", () => {
      setClientWaiting(true);
      setClientOnline(true); // ウェイティングルームに入った場合も接続中とみなす
      toast.info("🟢 お客様が接続し、ウェイティングルームで待機中です", { duration: 6000 });
    });
    // お客様がセッションを終了した通知
    socket.on("client_ended_session", () => {
      setClientEndedByClient(true);
      toast.warning("お客様がセッションを終了しました", { duration: 10000 });
    });
    // お客様の延長/終了確認ダイアログの選択結果を受信
    socket.on("client_extension_choice", ({ choice }: { choice: "extend" | "end" }) => {
      setClientExtensionChoice(choice);
      if (choice === "extend") {
        toast.info("✨ お客様が延長を希望しています", { duration: 20000 });
      } else {
        toast.warning("🌙 お客様が終了を希望しています", { duration: 20000 });
      }
    });
    // お客様の接続状態をリアルタイムで受信
    socket.on("client_presence", ({ online }: { online: boolean }) => {
      setClientOnline(online);
      if (online) {
        setClientWaiting(true);
        toast.info("🟢 お客様が接続しました", { duration: 5000 });
      } else {
        toast.info("⚪ お客様が離線しました", { duration: 4000 });
      }
    });
    // サーバーからの毎秒タイマーティックを受信（クライアント側setInterval不要）
    // timer_tickは必ずoffしてから再登録（重複防止）
    socket.off("timer_tick");
    socket.on("timer_tick", ({ remainingSeconds: rs }: { remainingSeconds: number }) => {
      setRemainingSeconds(rs);
      remainingSecondsRef.current = rs;
      // 5分アラーム
      if (rs <= 5 * 60 && rs > 5 * 60 - 2 && !alert5mFiredRef.current) {
        alert5mFiredRef.current = true;
        triggerChime("5min");
      }
      // 1分アラーム
      if (rs <= 60 && rs > 58 && !alert1mFiredRef.current) {
        alert1mFiredRef.current = true;
        triggerChime("1min");
      }
    });
    socketRef.current = socket;
    return () => {
      socket.off("timer_tick");
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [sessionId, isAuthenticated]);

  // タイマーはサーバー側のセットインターバルからtimer_tickで受信するため、クライアント側setIntervalは不要

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
    remainingSecondsRef.current = totalSeconds;
    setTimerStartedAt(now);
    timerStartedAtRef.current = now;
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

  // セッション開始：「セッション開始」ボタンを押した瞬間を起点にタイマースタート
  // timer_start → サーバーが timer_update + session_started をルーム全体にブロードキャスト
  // お客様画面は timer_update を受信した瞬間にウェイティングルームから切り替わる
  const handleStartSession = useCallback(() => {
    if (!session) return;
    const totalSeconds = (session.durationMinutes + session.carryoverMinutes) * 60;
    const now = Date.now();
    setRemainingSeconds(totalSeconds);
    remainingSecondsRef.current = totalSeconds;
    setTimerStartedAt(now);
    timerStartedAtRef.current = now;
    setTimerStatus("active");
    alert5mFiredRef.current = false;
    alert1mFiredRef.current = false;
    setClientWaiting(false);
    // timer_startをサーバーに送信（サーバーがタイマーを開始し、timer_update + session_startedを全クライアントに配信）
    socketRef.current?.emit("timer_start", { sessionId, remainingSeconds: totalSeconds });
    // DBを更新（ステータスをactiveにし、開始時刻を記録）
    updateSessionMutation.mutate({
      id: sessionId,
      status: "active",
      startedAt: new Date().toISOString(),
      remainingSeconds: totalSeconds,
      timerStartedAt: now,
    });
    toast.success("セッションを開始しました。タイマーがスタートしました。");
  }, [session, sessionId]);

  const handlePauseTimer = useCallback(() => {
    const tsa = timerStartedAtRef.current;
    const base = remainingSecondsRef.current;
    const elapsed = tsa ? Math.floor((Date.now() - tsa) / 1000) : 0;
    const current = Math.max(0, base - elapsed);
    setRemainingSeconds(current);
    remainingSecondsRef.current = current;
    setTimerStartedAt(null);
    timerStartedAtRef.current = null;
    setTimerStatus("paused");
    socketRef.current?.emit("timer_pause", { sessionId, remainingSeconds: current });
    updateSessionMutation.mutate({
      id: sessionId,
      status: "paused",
      remainingSeconds: current,
      timerStartedAt: null,
    });
  }, [sessionId]);

  const handleResumeTimer = useCallback(() => {
    const now = Date.now();
    const current = remainingSecondsRef.current;
    setTimerStartedAt(now);
    timerStartedAtRef.current = now;
    setTimerStatus("active");
    socketRef.current?.emit("timer_resume", { sessionId, remainingSeconds: current });
    updateSessionMutation.mutate({
      id: sessionId,
      status: "active",
      remainingSeconds: current,
      timerStartedAt: now,
    });
  }, [sessionId]);

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

  // カスタムスタンプ送信
  const handleSendCustomStamp = useCallback((imageUrl: string) => {
    socketRef.current?.emit("send_message", {
      sessionId,
      sender: "admin",
      content: "",
      imageUrl,
    });
    toast.success("送信しました");
  }, [sessionId]);

  // 画像リサイズ（長辺800px・JPEG 0.7）
  const resizeImage = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);

      img.onload = () => {
        URL.revokeObjectURL(url);
        const maxSize = 800;
        let { width, height } = img;

        if (width > maxSize || height > maxSize) {
          if (width > height) {
            height = Math.round(height * maxSize / width);
            width = maxSize;
          } else {
            width = Math.round(width * maxSize / height);
            height = maxSize;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) { reject(new Error("canvas error")); return; }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.7));
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("image load error"));
      };

      img.src = url;
    });
  };

  // 画像送信（S3不使用・base64をソケット経由でDBへ直接保存）
  const handleImageSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (imageInputRef.current) imageInputRef.current.value = "";

    setUploadingImage(true);
    try {
      const imageUrl = await resizeImage(file);
      socketRef.current?.emit("send_message", {
        sessionId,
        sender: "admin",
        content: "📷 画像を送信しました",
        imageUrl,
      });
    } catch (err) {
      console.error("[AdminSession] 画像送信エラー:", err);
      toast.error("画像の送信に失敗しました");
    } finally {
      setUploadingImage(false);
    }
  }, [sessionId]);

  const handleSendExtensionLink = useCallback((minutes: number) => {
    const settings = storeSettings ?? [];
    const sType = session?.sessionType ?? "chat";
    const keyMap: Record<number, string> = {
      10: sType === "voice" || sType === "video" ? "stores_url_voice_10min" : "stores_url_chat_10min",
      30: sType === "voice" || sType === "video" ? "stores_url_voice_30min" : "stores_url_chat_30min",
    };
    const fallbackKey: Record<number, string> = { 10: "stores_url_10min", 30: "stores_url_30min" };
    const url =
      settings.find((s) => s.key === keyMap[minutes])?.value ||
      settings.find((s) => s.key === fallbackKey[minutes])?.value ||
      "";
    if (!url) {
      toast.error("延長URLが設定されていません。設定画面でURLを登録してください。");
      return;
    }
    socketRef.current?.emit("extension_url_notify", {
      sessionId,
      minutes,
      url,
    });
    setShowExtendModal(false);
    toast.success(`${minutes}分延長URLをお客様に送信しました`);
  }, [storeSettings, sessionId, session]);

  const handleExtensionResume = useCallback((minutes: number) => {
    setExtensionNotification(null);
    addExtensionMutation.mutate({ id: sessionId, addMinutes: minutes });
  }, [sessionId]);

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
      // お客様画面に終了を通知
      socketRef.current?.emit("carryover_saved", { sessionId, minutes: 0 });
      toast.success("セッションを完了しました");
      navigate(`/admin/${slug}`);
    }
  }, [sessionId, navigate]);

  // Display timer - サーバーからtimer_tickで受信した値をそのまま使用
  const displaySeconds = remainingSeconds;

  const timerMins = Math.floor(displaySeconds / 60);
  const timerSecs = displaySeconds % 60;
  const timerStr = `${String(timerMins).padStart(2, "0")}:${String(timerSecs).padStart(2, "0")}`;
  const isWarning = displaySeconds <= ALERT_THRESHOLD && displaySeconds > 0;
  const isEnded = timerStatus === "ended" || displaySeconds === 0;

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: colors.main }}>
        <div style={{ color: colors.subText }}>読み込み中...</div>
      </div>
    );
  }

  if (!isAuthenticated) return <AdminLogin slug={slug} onSuccess={refetchAuth} />;

  return (
    <div
      className={`min-h-screen flex flex-col ${screenFlash ? "screen-flash-anim" : ""}`}
      style={{ background: colors.main }}
    >
      <AngeliqueHeader isAdmin slug={slug} onLogout={() => logoutMutation.mutate()} />

      {/* ── 上部固定バー：タイマー + 終了ボタン ─────────────────────────────────── */}
      <div
        style={{
          position: "fixed",
          top: "53px",
          left: 0,
          right: 0,
          zIndex: 45,
          background: isWarning ? "#fff3e0" : colors.main,
          borderBottom: `1px solid ${colors.border}`,
          padding: "10px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
          transition: "background 0.5s",
          boxShadow: "0 2px 8px rgba(107,91,88,0.06)",
        }}
      >
        {/* タイマー表示 */}
        <div className="flex items-center gap-3">
          <span style={{ fontSize: "12px", color: colors.subText }}>残り時間</span>
          <span
            className={`timer-display ${isWarning && timerStatus === "active" ? "timer-flash warning" : ""} ${isEnded ? "ended" : ""}`}
            style={{ fontSize: "28px" }}
          >
            {timerStr}
          </span>
          <span style={{ fontSize: "11px", color: colors.subText }}>
            {timerStatus === "active" && "進行中"}
            {timerStatus === "paused" && "⏸ 一時停止"}
            {timerStatus === "ended" && "時間終了"}
            {timerStatus === "idle" && "未開始"}
          </span>
          {isWarning && timerStatus === "active" && (
            <span style={{ fontSize: "12px", color: "#f57c00", fontWeight: 600 }}>⚠ 残り5分</span>
          )}
          {(session?.carryoverMinutes ?? 0) > 0 && (
            <span
              style={{
                fontSize: "11px",
                color: "#7a5c00",
                background: "#fdf8f0",
                border: "1px solid #f0c070",
                borderRadius: "10px",
                padding: "2px 8px",
              }}
            >
              繰越{session!.carryoverMinutes}分含む
            </span>
          )}
          {/* お客様の接続状態バッジ */}
          <div
            style={{
              marginLeft: "12px",
              display: "flex",
              alignItems: "center",
              gap: "5px",
              background: clientOnline ? "#e8f5e9" : "#f5f5f5",
              border: `1px solid ${clientOnline ? "#81c784" : "#e0e0e0"}`,
              borderRadius: "12px",
              padding: "3px 10px",
              fontSize: "12px",
              color: clientOnline ? "#2e7d32" : "#9e9e9e",
              transition: "all 0.3s",
            }}
          >
            <span style={{ fontSize: "9px" }}>{clientOnline ? "🟢" : "⚪"}</span>
            {clientOnline ? "お客様接続中" : "未接続"}
          </div>
        </div>

        {/* タイマーコントロール + 終了ボタン */}
        <div className="flex items-center gap-2">
          {timerStatus === "idle" && (
            <button
              className="angelique-btn"
              onClick={handleStartSession}
              disabled={!clientOnline}
              title={!clientOnline ? "お客様の接続を待ってください" : "セッションを開始する"}
              style={{
                padding: "8px 16px",
                fontSize: "13px",
                position: "relative",
                background: clientOnline ? colors.accent : undefined,
                opacity: clientOnline ? 1 : 0.5,
              }}
            >
              {clientOnline && (
                <span
                  style={{
                    position: "absolute",
                    top: "-4px",
                    right: "-4px",
                    width: "10px",
                    height: "10px",
                    background: "#4caf50",
                    borderRadius: "50%",
                  }}
                />
              )}
              ▶ セッション開始
            </button>
          )}
          {timerStatus === "active" && (
            <button
              className="angelique-btn-outline"
              onClick={handlePauseTimer}
              style={{ padding: "8px 14px", fontSize: "13px" }}
            >
              ⏸ 一時停止
            </button>
          )}
          {timerStatus === "paused" && (
            <button
              className="angelique-btn"
              onClick={handleResumeTimer}
              style={{ padding: "8px 14px", fontSize: "13px" }}
            >
              ▶ 再開
            </button>
          )}
          <button
            className="angelique-btn-danger"
            onClick={handleCompleteSession}
            style={{ padding: "8px 14px", fontSize: "13px" }}
          >
            ✓ 完了
          </button>
        </div>
      </div>

      {/* fixedバー（ヘッダー53px + タイマーバー約60px）の分だけ上部にスペースを確保 */}
      <div style={{ height: "113px" }} />

      <div className="flex-1 flex flex-col max-w-6xl mx-auto w-full px-4 py-4 gap-4">
        {/* Session Info Bar */}
        <div className="angelique-card p-3 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div style={{ fontSize: "16px", fontWeight: 500, color: colors.text }}>
              {session?.clientName ?? "読み込み中..."}
            </div>
            <div style={{ fontSize: "12px", color: colors.subText }}>
              {session && format(new Date(session.scheduledAt), "M/d (E) HH:mm", { locale: ja })} ·{" "}
              {session?.durationMinutes}分
              {(session?.carryoverMinutes ?? 0) > 0 && ` (+${session?.carryoverMinutes}分繰越)`}
              {" · "}
              {session?.sessionType === "voice" ? "🎙 音声" : session?.sessionType === "video" ? "📹 ビデオ" : "💬 チャット"}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* お客様の延長/終了選択通知バッジ */}
            {clientExtensionChoice && (
              <div
                style={{
                  background: clientExtensionChoice === "extend" ? "#e8f5e9" : "#fce4ec",
                  border: `1px solid ${clientExtensionChoice === "extend" ? "#4caf50" : "#e91e63"}`,
                  borderRadius: "8px",
                  padding: "4px 10px",
                  fontSize: "12px",
                  color: clientExtensionChoice === "extend" ? "#1b5e20" : "#880e4f",
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                {clientExtensionChoice === "extend"
                  ? "✨ お客様が延長を希望"
                  : "🌙 お客様が終了を希望"}
              </div>
            )}
            {/* お客様がセッションを終了した通知 */}
            {clientEndedByClient && (
              <div
                style={{
                  background: "#fce4ec",
                  border: "1px solid #e91e63",
                  borderRadius: "8px",
                  padding: "4px 10px",
                  fontSize: "12px",
                  color: "#880e4f",
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                🔔 お客様がセッションを終了しました
              </div>
            )}
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
            <span style={{ fontSize: "12px", color: colors.subText }}>
              {connected ? "接続中" : "切断"}
            </span>
          </div>
        </div>

        <div className="flex gap-4 flex-1" style={{ minHeight: 0 }}>
          {/* Left Main Area: ビデオ通話（上部）+ チャット（下部または全体） */}
          <div className="flex-1 flex flex-col gap-3" style={{ minHeight: 0, height: "calc(100vh - 320px)" }}>
            {session?.sessionType === "video" && (
              <div className="angelique-card p-3" style={{ flexShrink: 0 }}>
                <VideoCall
                  sessionId={sessionId}
                  role="admin"
                  isSessionActive={timerStatus === "active" || timerStatus === "paused"}
                />
              </div>
            )}
            <div className="angelique-card flex flex-col" style={{ flex: 1, minHeight: session?.sessionType === "video" ? "400px" : 0, overflow: "hidden" }}>
            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3" style={{ paddingTop: "80px" }}>
              {messages.length === 0 && (
                <div className="flex-1 flex items-center justify-center">
                  <p style={{ color: colors.border, fontSize: "14px" }}>
                    チャットを開始してください
                  </p>
                </div>
              )}
              {messages.map((msg) => (
                <div key={msg.id}>
                  {msg.sender === "system" ? (
                    /* システムメッセージ（中央） */
                    <div className="flex justify-center">
                      <div className="chat-bubble-system">
                        <LinkifiedText text={msg.content} />
                      </div>
                    </div>
                  ) : msg.sender === "admin" ? (
                    /* 管理者自身のメッセージ（右寄せ） */
                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                        {(msg as any).imageUrl ? (
                          <div>
                            <img
                              src={(msg as any).imageUrl}
                              alt="送信画像"
                              style={{ maxWidth: "200px", borderRadius: "12px", cursor: "pointer", border: `1px solid ${colors.border}` }}
                              onClick={() => window.open((msg as any).imageUrl, "_blank")}
                            />
                          </div>
                        ) : (
                          <div
                            className="chat-bubble-admin"
                            style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", overflowWrap: "break-word" }}
                          >
                            <LinkifiedText text={msg.content} />
                          </div>
                        )}
                        <div style={{ fontSize: "10px", color: colors.border, marginTop: "3px", textAlign: "right" }}>
                          {format(new Date(msg.createdAt), "HH:mm")}
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* お客様のメッセージ（左寄せ） */
                    <div style={{ display: "flex", justifyContent: "flex-start", flexDirection: "column", alignItems: "flex-start" }}>
                      <div style={{ fontSize: "11px", color: colors.subText, marginBottom: "3px", marginLeft: "4px" }}>
                        {session?.clientName}
                      </div>
                      {(msg as any).imageUrl ? (
                        <div>
                          <img
                            src={(msg as any).imageUrl}
                            alt="送信画像"
                            style={{ maxWidth: "200px", borderRadius: "12px", cursor: "pointer", border: `1px solid ${colors.border}` }}
                            onClick={() => window.open((msg as any).imageUrl, "_blank")}
                          />
                        </div>
                      ) : (
                        <div
                          className="chat-bubble-client"
                          style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", overflowWrap: "break-word" }}
                        >
                          <LinkifiedText text={msg.content} />
                        </div>
                      )}
                      <div style={{ fontSize: "10px", color: colors.border, marginTop: "3px", textAlign: "left" }}>
                        {format(new Date(msg.createdAt), "HH:mm")}
                      </div>
                    </div>
                  )}
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>

            {/* スタンプパネル */}
            <div style={{ borderTop: `1px solid ${colors.border}`, background: colors.main }}>
              {/* タブ */}
              <div style={{ display: "flex", borderBottom: `1px solid ${colors.border}` }}>
                {(["text", "custom"] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setStampTab(tab)}
                    style={{
                      padding: "5px 14px",
                      fontSize: "11px",
                      background: "transparent",
                      border: "none",
                      borderBottom: stampTab === tab ? `2px solid ${colors.accent}` : "2px solid transparent",
                      color: stampTab === tab ? colors.text : colors.subText,
                      cursor: "pointer",
                      fontWeight: stampTab === tab ? 600 : 400,
                    }}
                  >
                    {tab === "text" ? "テキスト" : "カスタム"}
                  </button>
                ))}
              </div>

              {/* テキストスタンプ */}
              {stampTab === "text" && (
                <div style={{ padding: "8px 12px", display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  {STAMPS.map((stamp) => (
                    <button
                      key={stamp.text}
                      onClick={() => handleSendStamp(stamp.text)}
                      style={{
                        background: colors.main,
                        border: `1px solid ${colors.border}`,
                        borderRadius: "20px",
                        padding: "4px 12px",
                        fontSize: "12px",
                        color: colors.text,
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                        transition: "all 0.15s",
                        fontFamily: "'Noto Sans JP', sans-serif",
                      }}
                      onMouseOver={(e) => { (e.currentTarget as HTMLButtonElement).style.background = colors.border; }}
                      onMouseOut={(e) => { (e.currentTarget as HTMLButtonElement).style.background = colors.main; }}
                      title={`ワンタップ送信: ${stamp.text}`}
                    >
                      {stamp.label}
                    </button>
                  ))}
                </div>
              )}

              {/* カスタムスタンプ */}
              {stampTab === "custom" && (
                <div style={{ padding: "8px 12px" }}>
                  {!customStamps || customStamps.length === 0 ? (
                    <p style={{ fontSize: "12px", color: colors.subText }}>
                      カスタムスタンプがありません。設定 › スタンプ管理から追加してください。
                    </p>
                  ) : (
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                      {customStamps.map((stamp) => (
                        <button
                          key={stamp.id}
                          onClick={() => handleSendCustomStamp(stamp.imageUrl)}
                          title={stamp.name}
                          style={{
                            background: "none",
                            border: `1px solid ${colors.border}`,
                            borderRadius: "8px",
                            padding: "4px",
                            cursor: "pointer",
                            width: "88px",
                            height: "88px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            overflow: "hidden",
                          }}
                        >
                          <img
                            src={stamp.imageUrl}
                            alt={stamp.name}
                            style={{ maxWidth: "80px", maxHeight: "80px", objectFit: "contain" }}
                          />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Input */}
            <div
              className="p-3 flex gap-2"
              style={{ borderTop: `1px solid ${colors.border}` }}
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
                  border: `1px solid ${colors.border}`,
                  borderRadius: "8px",
                  padding: "8px 10px",
                  fontSize: "18px",
                  cursor: "pointer",
                  color: colors.accent,
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
          </div>

          {/* Right Panel: Controls */}
          <div className="flex flex-col gap-4" style={{ width: "260px", minWidth: "260px" }}>
            {/* Voice Call Panel (voice sessions only) */}
            {session?.sessionType === "voice" && (
              <>
                {timerStatus === "idle" && <MicTest />}
                <VoiceCall
                  sessionId={sessionId}
                  role="admin"
                  isSessionActive={timerStatus === "active" || timerStatus === "paused"}
                  preConnect={true}
                />
              </>
            )}

            {/* Extension Notification */}
            {/* 延長申請は全画面ポップアップで表示（下部に移動） */}

            {/* Action Buttons */}
            <div className="angelique-card p-4 flex flex-col gap-2">
              <div style={{ fontSize: "12px", color: colors.subText, marginBottom: "4px", fontWeight: 500 }}>
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
            </div>

            {/* Client URL */}
            {session && (
              <div className="angelique-card p-4">
                <div style={{ fontSize: "12px", color: colors.subText, marginBottom: "4px" }}>お客様URL</div>
                <div
                  style={{
                    fontSize: "11px",
                    color: colors.text,
                    wordBreak: "break-all",
                    background: colors.main,
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

            {/* カルテパネル */}
            {session && <KartePanel clientId={session.clientId} colors={colors} />}
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
                color: colors.text,
                marginBottom: "20px",
              }}
            >
              時間を延長する
            </h3>
            <p style={{ fontSize: "13px", color: colors.subText, marginBottom: "20px" }}>
              延長URLをお客様のチャットに送信します
            </p>
            <div className="flex flex-col gap-3">
              {[10, 30].map((mins) => (
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

      {/* Extension Notification Banner - 延長申請通知バナー */}
      {extensionNotification && (
        <div
          style={{
            position: "fixed",
            top: "113px",
            left: 0,
            right: 0,
            zIndex: 60,
            background: "#fff8e1",
            borderBottom: "2px solid #f57c00",
            borderTop: "2px solid #f57c00",
            padding: "14px 20px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
            flexWrap: "wrap",
            boxShadow: "0 4px 16px rgba(245,124,0,0.2)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "20px" }}>🔔</span>
            <span style={{ fontSize: "15px", color: "#e65100", fontWeight: 600 }}>
              お客様が{extensionNotification.minutes}分延長を申請しました
            </span>
          </div>
          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            <button
              onClick={() => handleExtensionResume(extensionNotification.minutes)}
              style={{
                background: colors.accent,
                color: "#fff",
                border: "none",
                borderRadius: "8px",
                padding: "10px 24px",
                fontSize: "15px",
                fontWeight: 600,
                cursor: "pointer",
                boxShadow: "0 2px 8px rgba(168,127,122,0.4)",
              }}
            >
              ▶ {extensionNotification.minutes}分で再開
            </button>
            <button
              onClick={() => setExtensionNotification(null)}
              style={{
                background: "transparent",
                color: colors.subText,
                border: `1px solid ${colors.border}`,
                borderRadius: "8px",
                padding: "10px 16px",
                fontSize: "14px",
                cursor: "pointer",
              }}
            >
              × 閉じる
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
                color: colors.text,
                marginBottom: "8px",
              }}
            >
              次回に繰り越す
            </h3>
            <p style={{ fontSize: "13px", color: colors.subText, marginBottom: "20px" }}>
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
              <p style={{ fontSize: "11px", color: colors.subText, marginTop: "6px" }}>
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

// ── セッション中カルテパネル ──────────────────────────────────────────────

type KarteColors = { text: string; subText: string; border: string; main: string; accent: string };

function KartePanel({ clientId, colors }: { clientId: number; colors: KarteColors }) {
  const [open, setOpen] = useState(false);
  const { data, refetch } = trpc.clientProfile.get.useQuery({ clientId }, { enabled: open });

  const [birthdate, setBirthdate] = useState("");
  const [birthtime, setBirthtime] = useState("");
  const [birthplace, setBirthplace] = useState("");
  const [bloodType, setBloodType] = useState("");
  const [memo, setMemo] = useState("");
  const [saving, setSaving] = useState(false);
  const [showRelationForm, setShowRelationForm] = useState(false);
  const [newRel, setNewRel] = useState({ relation: "", name: "", birthdate: "", memo: "" });
  const [addingRel, setAddingRel] = useState(false);

  const upsertMutation = trpc.clientProfile.upsert.useMutation();
  const addRelationMutation = trpc.clientProfile.addRelation.useMutation();
  const deleteRelationMutation = trpc.clientProfile.deleteRelation.useMutation();

  useEffect(() => {
    if (data?.profile) {
      setBirthdate(data.profile.birthdate ?? "");
      setBirthtime(data.profile.birthtime ?? "");
      setBirthplace(data.profile.birthplace ?? "");
      setBloodType(data.profile.bloodType ?? "");
      setMemo(data.profile.memo ?? "");
    }
  }, [data]);

  async function handleSave() {
    setSaving(true);
    try {
      await upsertMutation.mutateAsync({ clientId, birthdate: birthdate || null, birthtime: birthtime || null, birthplace: birthplace || null, bloodType: bloodType || null, memo: memo || null });
      toast.success("カルテを保存しました");
      refetch();
    } catch {
      toast.error("保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  async function handleAddRelation() {
    if (!newRel.name && !newRel.relation) { toast.error("続柄または名前を入力してください"); return; }
    setAddingRel(true);
    try {
      await addRelationMutation.mutateAsync({ clientId, ...newRel });
      setNewRel({ relation: "", name: "", birthdate: "", memo: "" });
      setShowRelationForm(false);
      refetch();
    } catch {
      toast.error("追加に失敗しました");
    } finally {
      setAddingRel(false);
    }
  }

  async function handleDeleteRelation(id: number) {
    try {
      await deleteRelationMutation.mutateAsync({ id });
      refetch();
    } catch {
      toast.error("削除に失敗しました");
    }
  }

  const relations = data?.relations ?? [];

  return (
    <div className="angelique-card" style={{ overflow: "hidden" }}>
      {/* アコーディオンヘッダー */}
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          background: "none",
          border: "none",
          cursor: "pointer",
          fontSize: "13px",
          fontWeight: 600,
          color: colors.text,
        }}
      >
        <span>📋 カルテ</span>
        <span style={{ fontSize: "16px", color: colors.subText }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div style={{ padding: "0 16px 16px" }}>
          {/* 生年月日・出生時刻 */}
          <div className="grid grid-cols-2 gap-2 mb-2">
            <div>
              <div style={{ fontSize: "10px", color: colors.subText, marginBottom: "3px" }}>生年月日</div>
              <input
                type="date"
                className="angelique-input"
                style={{ fontSize: "11px", padding: "5px 8px" }}
                value={birthdate}
                onChange={(e) => setBirthdate(e.target.value)}
              />
            </div>
            <div>
              <div style={{ fontSize: "10px", color: colors.subText, marginBottom: "3px" }}>出生時刻（任意）</div>
              <input
                type="time"
                className="angelique-input"
                style={{ fontSize: "11px", padding: "5px 8px" }}
                value={birthtime}
                onChange={(e) => setBirthtime(e.target.value)}
              />
            </div>
          </div>
          {/* 出生地・血液型 */}
          <div className="grid grid-cols-2 gap-2 mb-2">
            <div>
              <div style={{ fontSize: "10px", color: colors.subText, marginBottom: "3px" }}>出生地（任意）</div>
              <input
                type="text"
                className="angelique-input"
                style={{ fontSize: "11px", padding: "5px 8px" }}
                value={birthplace}
                onChange={(e) => setBirthplace(e.target.value)}
                placeholder="東京都など"
              />
            </div>
            <div>
              <div style={{ fontSize: "10px", color: colors.subText, marginBottom: "3px" }}>血液型</div>
              <select
                className="angelique-input"
                style={{ fontSize: "11px", padding: "5px 8px" }}
                value={bloodType}
                onChange={(e) => setBloodType(e.target.value)}
              >
                <option value="">-</option>
                <option value="A">A型</option>
                <option value="B">B型</option>
                <option value="O">O型</option>
                <option value="AB">AB型</option>
              </select>
            </div>
          </div>

          {/* メモ */}
          <div style={{ fontSize: "10px", color: colors.subText, marginBottom: "3px" }}>メモ</div>
          <textarea
            className="angelique-input"
            rows={3}
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="鑑定メモ..."
            style={{ fontSize: "12px", resize: "vertical", marginBottom: "8px" }}
          />

          <button
            className="angelique-btn"
            style={{ fontSize: "12px", padding: "6px 14px", width: "100%", justifyContent: "center", marginBottom: "12px" }}
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "保存中..." : "保存"}
          </button>

          {/* 区切り */}
          <div style={{ borderTop: `1px solid ${colors.border}`, marginBottom: "10px" }} />

          {/* 関係者 */}
          <div className="flex items-center justify-between mb-2">
            <div style={{ fontSize: "11px", fontWeight: 600, color: colors.text }}>関係者</div>
            <button
              className="angelique-btn-outline"
              style={{ fontSize: "10px", padding: "2px 8px" }}
              onClick={() => setShowRelationForm((v) => !v)}
            >
              {showRelationForm ? "✕" : "+ 追加"}
            </button>
          </div>

          {showRelationForm && (
            <div style={{ marginBottom: "8px", padding: "8px", background: colors.main, borderRadius: "8px", border: `1px solid ${colors.border}` }}>
              <div className="grid grid-cols-2 gap-1 mb-1">
                <input className="angelique-input" style={{ fontSize: "11px", padding: "4px 6px" }} placeholder="続柄" value={newRel.relation} onChange={(e) => setNewRel((r) => ({ ...r, relation: e.target.value }))} />
                <input className="angelique-input" style={{ fontSize: "11px", padding: "4px 6px" }} placeholder="名前" value={newRel.name} onChange={(e) => setNewRel((r) => ({ ...r, name: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-1 mb-2">
                <input type="date" className="angelique-input" style={{ fontSize: "11px", padding: "4px 6px" }} value={newRel.birthdate} onChange={(e) => setNewRel((r) => ({ ...r, birthdate: e.target.value }))} />
                <input className="angelique-input" style={{ fontSize: "11px", padding: "4px 6px" }} placeholder="メモ" value={newRel.memo} onChange={(e) => setNewRel((r) => ({ ...r, memo: e.target.value }))} />
              </div>
              <button className="angelique-btn" style={{ fontSize: "11px", padding: "4px 10px" }} onClick={handleAddRelation} disabled={addingRel}>
                {addingRel ? "追加中..." : "追加"}
              </button>
            </div>
          )}

          {relations.length === 0 ? (
            <p style={{ fontSize: "11px", color: colors.subText }}>関係者なし</p>
          ) : (
            <div className="flex flex-col gap-1">
              {relations.map((rel) => (
                <div
                  key={rel.id}
                  style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", padding: "6px 8px", background: colors.main, borderRadius: "6px", border: `1px solid ${colors.border}`, gap: "6px" }}
                >
                  <div style={{ fontSize: "11px", color: colors.text, flex: 1 }}>
                    {rel.relation && <span style={{ color: colors.accent, fontWeight: 600, marginRight: "4px" }}>{rel.relation}</span>}
                    {rel.name ?? "—"}
                    {rel.birthdate && <span style={{ color: colors.subText, marginLeft: "4px" }}>{rel.birthdate}</span>}
                    {rel.memo && <div style={{ color: colors.subText, fontSize: "10px" }}>{rel.memo}</div>}
                  </div>
                  <button
                    onClick={() => handleDeleteRelation(rel.id)}
                    style={{ fontSize: "10px", color: colors.subText, background: "none", border: "none", cursor: "pointer", flexShrink: 0, padding: "0 2px" }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
