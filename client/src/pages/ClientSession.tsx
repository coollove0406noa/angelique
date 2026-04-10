import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { io, Socket } from "socket.io-client";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { toast } from "sonner";
import LinkifiedText from "@/components/LinkifiedText";
import VoiceCall from "@/components/VoiceCall";
import { WaitingRoom } from "@/components/WaitingRoom";

type Message = {
  id: number;
  sessionId: number;
  sender: "admin" | "client" | "system";
  content: string;
  imageUrl?: string | null;
  createdAt: Date;
};

type SessionInfo = {
  id: number;
  clientId: number;
  clientToken: string;
  scheduledAt: Date;
  durationMinutes: number;
  carryoverMinutes: number;
  sessionType: "chat" | "voice";
  status: string;
  startedAt: Date | null;
  remainingSeconds: number | null;
  timerStartedAt: number | null;
  clientName: string | null;
};

const ALERT_THRESHOLD = 5 * 60;

export default function ClientSession() {
  const { token } = useParams<{ token: string }>();

  const socketRef = useRef<Socket | null>(null);
  const socketInitializedRef = useRef(false); // 重複接続防止フラグ
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [session, setSession] = useState<SessionInfo | null>(null);
  // タイマーはサーバーから受け取った基準時刻と残り秒数で計算
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [timerStartedAt, setTimerStartedAt] = useState<number | null>(null);
  const [timerStatus, setTimerStatus] = useState<"idle" | "active" | "paused" | "ended">("idle");
  const [showExtensionUI, setShowExtensionUI] = useState(false);
  const [extensionWaiting, setExtensionWaiting] = useState(false);
  // アラームフラグはuseRefで管理してstale closureを防ぐ
  const alert5mFiredRef = useRef(false);
  const alert1mFiredRef = useRef(false);
  // ウェイティングルーム状態
  const [showWaitingRoom, setShowWaitingRoom] = useState(true);
  // セッション終了メッセージ
  const [sessionEndedMessage, setSessionEndedMessage] = useState(false);
  // お客様側終了確認ダイアログ
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [clientEnded, setClientEnded] = useState(false);
  // 管理者から送られた延長URL（チャットではなく専用バーに表示）
  const [extensionUrlReceived, setExtensionUrlReceived] = useState<{ minutes: number; url: string } | null>(null);
  // 画像アップロード
  const [uploadingImage, setUploadingImage] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const uploadImageMutation = trpc.messages.uploadImage.useMutation();

  const { data: sessionData, isLoading, isError, refetch: refetchSession } = trpc.sessions.getByToken.useQuery(
    { token: token ?? "" },
    { enabled: !!token, retry: false }
  );
  const { data: initialMessages } = trpc.messages.list.useQuery(
    { sessionId: session?.id ?? 0 },
    { enabled: !!session?.id }
  );
  const { data: storeSettings } = trpc.settings.list.useQuery();

  // Initialize session
  useEffect(() => {
    if (sessionData) {
      setSession(sessionData as unknown as SessionInfo);
      const secs = sessionData.remainingSeconds ?? 0;
      setRemainingSeconds(secs);
      setTimerStartedAt(sessionData.timerStartedAt ?? null);
      if (sessionData.status === "active") {
        setTimerStatus("active");
        setShowWaitingRoom(false);
      } else if (sessionData.status === "paused") {
        setTimerStatus("paused");
        setShowWaitingRoom(false);
      } else if (sessionData.status === "completed") {
        setTimerStatus("ended");
        setShowWaitingRoom(false);
        setSessionEndedMessage(true);
      } else if (sessionData.status === "cancelled") {
        setTimerStatus("ended");
        setShowWaitingRoom(false);
        setSessionEndedMessage(true);
      } else {
        // scheduled: ウェイティングルームを表示
        setShowWaitingRoom(true);
      }
    }
  }, [sessionData]);

  useEffect(() => {
    if (initialMessages) setMessages(initialMessages as Message[]);
  }, [initialMessages]);

  // Socket.io（重複接続防止: session.idが確定したら1回だけ接続）
  useEffect(() => {
    if (!session?.id) return;
    // 既に接続済みの場合はスキップ（重複接続によるtimer_tick多重登録を防ぐ）
    if (socketInitializedRef.current && socketRef.current?.connected) return;

    // 既存ソケットがあれば切断してから再接続
    if (socketRef.current) {
      socketRef.current.removeAllListeners();
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    socketInitializedRef.current = true;

    const sessionId = session.id;
    const socket = io(window.location.origin, {
      path: "/api/socket.io",
      transports: ["websocket", "polling"],
    });

    socket.on("connect", () => {
      setConnected(true);
      socket.emit("join_session", { sessionId, role: "client", token });
      // ウェイティングルーム中なら管理者に通知
      socket.emit("waiting_room_join", { sessionId });
    });
    socket.on("disconnect", () => setConnected(false));

    socket.on("new_message", (msg: Message) => {
      setMessages((prev) => [...prev, msg]);
    });

    socket.on("timer_update", ({ status, remainingSeconds: rs, timerStartedAt: tsa }: { status: string; remainingSeconds: number; timerStartedAt: number | null }) => {
      setRemainingSeconds(rs);
      setTimerStartedAt(tsa);
      if (status === "active") {
        setTimerStatus("active");
        // タイマー開始 = ウェイティングルームを終了（最重要）
        setShowWaitingRoom(false);
        setShowExtensionUI(false);
        setExtensionWaiting(false);
        // アラームフラグをリセット（延長後の再開に対応）
        alert5mFiredRef.current = false;
        alert1mFiredRef.current = false;
      } else if (status === "paused") {
        setTimerStatus("paused");
        setShowWaitingRoom(false);
      } else if (status === "ended") {
        setTimerStatus("ended");
        setShowWaitingRoom(false);
      }
    });

    socket.on("timer_ended", () => {
      setTimerStatus("ended");
      setRemainingSeconds(0);
      setShowExtensionUI(true);
    });

    socket.on("extension_applied", ({ addMinutes }: { addMinutes: number }) => {
      setExtensionWaiting(false);
      setShowExtensionUI(false);
      toast.success(`${addMinutes}分延長されました`);
    });

    socket.on("session_ended", () => {
      setTimerStatus("ended");
      setShowExtensionUI(false);
      setSessionEndedMessage(true);
    });

    // 管理者から延長URLを受信（チャットではなく専用バーに表示）
    socket.on("extension_url_received", ({ minutes, url }: { minutes: number; url: string }) => {
      setExtensionUrlReceived({ minutes, url });
    });

    // 管理者がセッション開始 → ウェイティングルームを終了（timer_updateの補完）
    socket.on("session_started", () => {
      setShowWaitingRoom(false);
    });

    // サーバーからの毎秒タイマーティックを受信（クライアント側setInterval不要）
    // ※このリスナーは1つのソケットに1つだけ登録される（重複防止済み）
    socket.on("timer_tick", ({ remainingSeconds: rs }: { remainingSeconds: number }) => {
      setRemainingSeconds(rs);
      // サーバーからの残り秒数を基準点として更新（elapsed二重計算を防ぐ）
      setTimerStartedAt(Date.now());
      // 5分アラーム
      if (rs <= ALERT_THRESHOLD && rs > ALERT_THRESHOLD - 2 && !alert5mFiredRef.current) {
        alert5mFiredRef.current = true;
        toast.warning("⚠ 残り5分です");
      }
      // 1分アラーム
      if (rs <= 60 && rs > 58 && !alert1mFiredRef.current) {
        alert1mFiredRef.current = true;
        toast.warning("⚠ 残り1分です！");
      }
    });

    socketRef.current = socket;
    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
      socketInitializedRef.current = false;
    };
  }, [session?.id, token]);

  // タイマーはサーバー側のセットインターバルからtimer_tickで受信するため、クライアント側setIntervalは不要

  // Auto-scroll
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSendMessage = useCallback(() => {
    if (!inputText.trim() || !session) return;
    socketRef.current?.emit("send_message", {
      sessionId: session.id,
      sender: "client",
      content: inputText.trim(),
    });
    setInputText("");
  }, [inputText, session]);

  // 画像送信
  const handleImageSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !session) return;

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
          sessionId: session.id,
          sender: "client",
          base64Data,
          mimeType: file.type,
          fileName: file.name,
        });
        socketRef.current?.emit("send_message", {
          sessionId: session.id,
          sender: "client",
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
  }, [session, uploadImageMutation]);

  // 延長ボタン → 別タブで決済URLを開く
  const handleExtensionRequest = useCallback((minutes: number) => {
    if (!session) return;
    const settings = storeSettings ?? [];
    const urlMap: Record<number, string> = {
      10: settings.find((s) => s.key === "stores_url_10min")?.value ?? "",
      30: settings.find((s) => s.key === "stores_url_30min")?.value ?? "",
    };
    const url = urlMap[minutes];
    if (url) {
      window.open(url, "_blank", "noopener,noreferrer");
    } else {
      toast.info("延長URLが設定されていません。占い師にご連絡ください。");
    }
  }, [storeSettings, session]);

  const handleExtensionDone = useCallback(() => {
    if (!session) return;
    setExtensionWaiting(true);
    socketRef.current?.emit("extension_requested", { sessionId: session.id, minutes: 0 });
    toast.success("占い師に通知しました。しばらくお待ちください。");
  }, [session]);
  // お客様側からセッションを終了する
  const handleClientEndSession = useCallback(() => {
    if (!session) return;
    socketRef.current?.emit("client_end_session", { sessionId: session.id });
    setClientEnded(true);
    setShowEndConfirm(false);
  }, [session]);

  // Display timer - サーバー基準時刻から計算
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

  // Loading / Error states
  if (isLoading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: "#f9f5f4" }}
      >
        <div style={{ textAlign: "center", color: "#9e8480" }}>
          <div
            style={{
              fontFamily: "'Cormorant Garamond', serif",
              fontSize: "28px",
              color: "#c9a8a3",
              marginBottom: "16px",
            }}
          >
            ✦ angelique
          </div>
          <p>セッションを読み込み中...</p>
        </div>
      </div>
    );
  }

  if (isError || !session) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: "#f9f5f4", padding: "24px" }}
      >
        <div
          style={{
            background: "#ffffff",
            borderRadius: "16px",
            border: "1px solid #d4bfbb",
            padding: "40px 32px",
            maxWidth: "360px",
            width: "100%",
            textAlign: "center",
          }}
        >
          <div
            style={{
              fontFamily: "'Cormorant Garamond', serif",
              fontSize: "26px",
              color: "#c9a8a3",
              letterSpacing: "2px",
              marginBottom: "24px",
            }}
          >
            ✦ angelique
          </div>
          <div style={{ fontSize: "36px", marginBottom: "16px" }}>⚠️</div>
          <p style={{ color: "#6b5b58", fontSize: "16px", fontWeight: 600, marginBottom: "12px" }}>
            申し訳ありません
          </p>
          <p style={{ color: "#9e8480", fontSize: "13px", lineHeight: 1.8, marginBottom: "28px" }}>
            セッション情報を読み込めませんでした。
            <br />
            URLをご確認いただくか、占い師にご連絡ください。
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px", alignItems: "center" }}>
            <button
              onClick={() => window.location.reload()}
              style={{
                background: "#c9a8a3",
                color: "#ffffff",
                border: "none",
                borderRadius: "24px",
                padding: "12px 32px",
                fontSize: "14px",
                fontFamily: "'Noto Sans JP', sans-serif",
                cursor: "pointer",
                width: "100%",
                maxWidth: "280px",
                fontWeight: 500,
              }}
            >
              ページを再読み込み
            </button>
            <button
              onClick={() => { refetchSession(); }}
              style={{
                background: "#f3e7e5",
                color: "#6b5b58",
                border: "1px solid #d4bfbb",
                borderRadius: "24px",
                padding: "12px 32px",
                fontSize: "14px",
                fontFamily: "'Noto Sans JP', sans-serif",
                cursor: "pointer",
                width: "100%",
                maxWidth: "280px",
                fontWeight: 500,
              }}
            >
              セッションに戻る
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── ウェイティングルーム表示 ──────────────────────────────────────────
  if (showWaitingRoom) {
    return (
      <WaitingRoom
        sessionType={session.sessionType}
        onSessionStarted={() => setShowWaitingRoom(false)}
      />
    );
  }

  // ── お客様自身が終了した画面 ─────────────────────────────────────────
  if (clientEnded) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: "#f9f5f4", padding: "24px" }}
      >
        <div
          style={{
            background: "#ffffff",
            borderRadius: "16px",
            border: "1px solid #d4bfbb",
            padding: "48px 32px",
            maxWidth: "360px",
            width: "100%",
            textAlign: "center",
          }}
        >
          <div
            style={{
              fontFamily: "'Cormorant Garamond', serif",
              fontSize: "26px",
              color: "#c9a8a3",
              letterSpacing: "2px",
              marginBottom: "24px",
            }}
          >
            ✶ angelique
          </div>
          <div style={{ fontSize: "40px", marginBottom: "16px" }}>🌙</div>
          <p style={{ color: "#6b5b58", fontSize: "18px", fontWeight: 600, marginBottom: "12px", fontFamily: "'Cormorant Garamond', serif" }}>
            ありがとうございました
          </p>
          <p style={{ color: "#9e8480", fontSize: "14px", lineHeight: 1.8 }}>
            またのご利用をお待ちしております。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: "#f9f5f4", overflowX: "hidden", maxWidth: "100vw" }}
    >
      {/* Header - 固定 */}
      <header
        style={{
          background: "#ffffff",
          borderBottom: "1px solid #d4bfbb",
          boxShadow: "0 2px 12px rgba(107,91,88,0.06)",
          padding: "12px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 50,
        }}
      >
        <div
          style={{
            fontFamily: "'Cormorant Garamond', serif",
            fontSize: "22px",
            color: "#c9a8a3",
            letterSpacing: "2px",
          }}
        >
          ✦ angelique
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <div
              style={{
                width: "7px",
                height: "7px",
                borderRadius: "50%",
                background: connected ? "#4caf50" : "#ccc",
              }}
            />
            <span style={{ fontSize: "11px", color: "#9e8480" }}>
              {connected ? "接続中" : "接続待ち"}
            </span>
          </div>
          <button
            onClick={() => setShowEndConfirm(true)}
            style={{
              background: "transparent",
              border: "1px solid #d4bfbb",
              borderRadius: "8px",
              padding: "5px 12px",
              fontSize: "12px",
              color: "#9e8480",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            セッションを終了する
          </button>
        </div>
      </header>
      {/* 終了確認ダイアログ */}
      {showEndConfirm && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            zIndex: 100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
          }}
        >
          <div
            style={{
              background: "#ffffff",
              borderRadius: "16px",
              border: "1px solid #d4bfbb",
              padding: "32px 24px",
              maxWidth: "320px",
              width: "100%",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: "32px", marginBottom: "12px" }}>🌙</div>
            <p style={{ color: "#6b5b58", fontSize: "16px", fontWeight: 600, marginBottom: "8px" }}>
              本当に終了しますか？
            </p>
            <p style={{ color: "#9e8480", fontSize: "13px", marginBottom: "24px", lineHeight: 1.7 }}>
              終了すると元の画面に戻れなくなります。
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => setShowEndConfirm(false)}
                style={{
                  background: "transparent",
                  border: "1px solid #d4bfbb",
                  borderRadius: "8px",
                  padding: "10px 20px",
                  fontSize: "14px",
                  color: "#9e8480",
                  cursor: "pointer",
                  flex: 1,
                }}
              >
                キャンセル
              </button>
              <button
                onClick={handleClientEndSession}
                style={{
                  background: "#c9a8a3",
                  border: "none",
                  borderRadius: "8px",
                  padding: "10px 20px",
                  fontSize: "14px",
                  color: "#ffffff",
                  cursor: "pointer",
                  flex: 1,
                }}
              >
                終了する
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Timer Bar - fixed固定（スクロールしても常に表示） */}
      <div
        style={{
          background: isWarning ? "#fff3e0" : "#f3e7e5",
          borderBottom: "1px solid #d4bfbb",
          padding: "12px 16px",
          textAlign: "center",
          transition: "background 0.5s",
          position: "fixed",
          top: "53px",
          left: 0,
          right: 0,
          zIndex: 40,
        }}
      >
        {timerStatus === "idle" && (
          <p style={{ fontSize: "13px", color: "#9e8480" }}>
            占い師がセッションを開始するまでお待ちください ✦
          </p>
        )}
        {(timerStatus === "active" || timerStatus === "paused") && (
          <div>
            <span style={{ fontSize: "11px", color: "#9e8480", marginRight: "8px" }}>残り時間</span>
            <span
              className={`timer-display ${isWarning && timerStatus === "active" ? "timer-flash warning" : ""}`}
              style={{ fontSize: "32px" }}
            >
              {timerStr}
            </span>
            {timerStatus === "paused" && (
              <span style={{ fontSize: "11px", color: "#f57c00", marginLeft: "8px" }}>（一時停止中）</span>
            )}
            {isWarning && (
              <p style={{ fontSize: "12px", color: "#f57c00", marginTop: "4px" }}>
                ⚠ 残り5分を切りました
              </p>
            )}
          </div>
        )}
        {timerStatus === "ended" && !showExtensionUI && !sessionEndedMessage && (
          <p style={{ fontSize: "13px", color: "#c62828" }}>
            セッション時間が終了しました
          </p>
        )}
      </div>

      {/* Voice Call Panel (voice sessions only) - fixed固定 */}
      {session?.sessionType === "voice" && (
        <div
          style={{
            padding: "12px 16px",
            background: "#f9f5f4",
            borderBottom: "1px solid #d4bfbb",
            position: "fixed",
            top: "101px",
            left: 0,
            right: 0,
            zIndex: 35,
          }}
        >
          <VoiceCall
            sessionId={session.id}
            role="client"
            isSessionActive={timerStatus === "active" || timerStatus === "paused"}
          />
        </div>
      )}

      {/* Extension UI - fixed固定（タイマーの下に固定表示） */}
      {showExtensionUI && (
        <div
          style={{
            background: "#fff",
            borderBottom: "1px solid #d4bfbb",
            padding: "16px",
            position: "fixed",
            top: session?.sessionType === "voice" ? "149px" : "101px",
            left: 0,
            right: 0,
            zIndex: 38,
            boxShadow: "0 2px 8px rgba(107,91,88,0.08)",
          }}
        >
          {extensionWaiting ? (
            <div className="text-center" style={{ padding: "8px 0" }}>
              <div
                style={{
                  fontSize: "14px",
                  color: "#6b5b58",
                  fontWeight: 500,
                  marginBottom: "4px",
                }}
              >
                ✦ 占い師の確認をお待ちください
              </div>
              <p style={{ fontSize: "12px", color: "#9e8480" }}>
                延長の確認が取れ次第、セッションを再開します
              </p>
            </div>
          ) : (
            <div>
              <div
                style={{
                  fontFamily: "'Cormorant Garamond', serif",
                  fontSize: "18px",
                  color: "#6b5b58",
                  marginBottom: "8px",
                  textAlign: "center",
                }}
              >
                お時間になりました
              </div>
              <p
                style={{
                  fontSize: "13px",
                  color: "#9e8480",
                  textAlign: "center",
                  marginBottom: "16px",
                }}
              >
                延長をご希望の場合は、下記よりお手続きください
              </p>
              <div className="flex gap-2 justify-center flex-wrap">
                {[10, 30].map((mins) => (
                  <button
                    key={mins}
                    className="angelique-btn"
                    onClick={() => handleExtensionRequest(mins)}
                    style={{ padding: "12px 20px", fontSize: "14px", minWidth: "80px" }}
                  >
                    {mins}分延長
                  </button>
                ))}
              </div>
              <div className="flex justify-center mt-3">
                <button
                  className="angelique-btn-outline"
                  onClick={handleExtensionDone}
                  style={{ padding: "8px 20px", fontSize: "13px" }}
                >
                  ✓ 延長しました、お待ちください
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 管理者から延長URLを受信した場合の専用バー */}
      {extensionUrlReceived && !showExtensionUI && (
        <div
          style={{
            background: "#fdf5f3",
            borderBottom: "1px solid #d4bfbb",
            padding: "14px 16px",
            position: "fixed",
            top: session?.sessionType === "voice" ? "149px" : "101px",
            left: 0,
            right: 0,
            zIndex: 37,
            boxShadow: "0 2px 8px rgba(107,91,88,0.08)",
            textAlign: "center",
          }}
        >
          <p style={{ fontSize: "13px", color: "#6b5b58", marginBottom: "10px", fontWeight: 500 }}>
            ✨ {extensionUrlReceived.minutes}分延長のご案内が届いています
          </p>
          <a
            href={extensionUrlReceived.url}
            target="_blank"
            rel="noopener noreferrer"
            className="angelique-btn"
            style={{ padding: "10px 24px", fontSize: "14px", display: "inline-block" }}
          >
            {extensionUrlReceived.minutes}分延長のお手続きはこちら
          </a>
          <button
            onClick={() => setExtensionUrlReceived(null)}
            style={{ display: "block", margin: "8px auto 0", fontSize: "12px", color: "#9e8480", background: "none", border: "none", cursor: "pointer" }}
          >
            × 閉じる
          </button>
        </div>
      )}
      {/* セッション終了ポップアップ（画面中央に大きく表示） */}
      {sessionEndedMessage && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 200,
            background: "rgba(107,91,88,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
          }}
        >
          <div
            style={{
              background: "#fdfaf9",
              borderRadius: "20px",
              padding: "48px 40px",
              textAlign: "center",
              maxWidth: "400px",
              width: "100%",
              boxShadow: "0 8px 40px rgba(107,91,88,0.25)",
              border: "1px solid #d4bfbb",
            }}
          >
            <div style={{ fontSize: "48px", marginBottom: "16px" }}>🌙</div>
            <p
              style={{
                fontFamily: "'Cormorant Garamond', serif",
                fontSize: "26px",
                color: "#6b5b58",
                fontWeight: 600,
                marginBottom: "12px",
                lineHeight: 1.4,
              }}
            >
              鑑定が終了しました
            </p>
            <p style={{ color: "#9e8480", fontSize: "15px", lineHeight: 1.7 }}>
              ありがとうございました。<br />
              またのご利用をお待ちしております。
            </p>
          </div>
        </div>
      )}

      {/* fixedバー（ヘッダー53px + タイマーバー約48px）の分だけ上部にスペースを確保 */}
      <div style={{ height: session?.sessionType === "voice" ? "149px" : "101px" }} />

      {/* Chat Area */}
      <div
        className="flex-1 flex flex-col"
        style={{ maxWidth: "600px", width: "100%", margin: "0 auto", padding: "0" }}
      >
        {/* Messages */}
        <div
          className="flex-1 overflow-y-auto p-4 flex flex-col gap-3"
          style={{ minHeight: 0 }}
        >
          {/* Welcome message */}
          {messages.length === 0 && timerStatus === "idle" && (
            <div className="flex-1 flex flex-col items-center justify-center gap-4">
              <div
                style={{
                  fontFamily: "'Cormorant Garamond', serif",
                  fontSize: "24px",
                  color: "#c9a8a3",
                  textAlign: "center",
                }}
              >
                ✦ ようこそ
              </div>
              <p style={{ color: "#9e8480", fontSize: "14px", textAlign: "center" }}>
                {session.clientName} 様
              </p>
              <p style={{ color: "#d4bfbb", fontSize: "13px", textAlign: "center" }}>
                占い師がセッションを開始するまでお待ちください
              </p>
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${
                msg.sender === "client"
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
                <div style={{ maxWidth: "100%", width: "100%" }}>
                  {msg.sender === "admin" && (
                    <div
                      style={{
                        fontSize: "11px",
                        color: "#9e8480",
                        marginBottom: "3px",
                        marginLeft: "4px",
                      }}
                    >
                      angelique
                    </div>
                  )}
                  {/* 画像メッセージ */}
                  {msg.imageUrl ? (
                    <div>
                      <img
                        src={msg.imageUrl}
                        alt="送信画像"
                        style={{
                          maxWidth: "240px",
                          borderRadius: "12px",
                          cursor: "pointer",
                          border: "1px solid #d4bfbb",
                        }}
                        onClick={() => window.open(msg.imageUrl!, "_blank")}
                      />
                      {/* お客様は画像を保存できる */}
                      <div style={{ marginTop: "4px" }}>
                        <a
                          href={msg.imageUrl}
                          download
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            fontSize: "11px",
                            color: "#c9a8a3",
                            textDecoration: "underline",
                          }}
                        >
                          ↓ 画像を保存
                        </a>
                      </div>
                    </div>
                  ) : (
                    <div
                      className={
                        msg.sender === "client" ? "chat-bubble-client-self" : "chat-bubble-client"
                      }
                    >
                      <LinkifiedText text={msg.content} />
                    </div>
                  )}
                  <div
                    style={{
                      fontSize: "10px",
                      color: "#d4bfbb",
                      marginTop: "3px",
                      textAlign: msg.sender === "client" ? "right" : "left",
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
          style={{
            borderTop: "1px solid #f3e7e5",
            background: "#fff",
            position: "sticky",
            bottom: 0,
            zIndex: 30,
            paddingBottom: "max(12px, env(safe-area-inset-bottom))",
          }}
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
            disabled={uploadingImage || (timerStatus === "ended" && !extensionWaiting)}
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
            placeholder="メッセージを入力"
            rows={2}
            style={{ resize: "none", fontSize: "16px" }}
            disabled={timerStatus === "ended" && !extensionWaiting}
          />
          <button
            className="angelique-btn"
            onClick={handleSendMessage}
            disabled={!inputText.trim() || (timerStatus === "ended" && !extensionWaiting)}
            style={{ alignSelf: "flex-end", padding: "12px 20px", minWidth: "56px", fontSize: "15px" }}
          >
            送信
          </button>
        </div>
      </div>
    </div>
  );
}
