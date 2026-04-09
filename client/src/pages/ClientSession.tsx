import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { io, Socket } from "socket.io-client";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { toast } from "sonner";
import LinkifiedText from "@/components/LinkifiedText";

type Message = {
  id: number;
  sessionId: number;
  sender: "admin" | "client" | "system";
  content: string;
  createdAt: Date;
};

type SessionInfo = {
  id: number;
  clientId: number;
  clientToken: string;
  scheduledAt: Date;
  durationMinutes: number;
  carryoverMinutes: number;
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
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [timerStartedAt, setTimerStartedAt] = useState<number | null>(null);
  const [timerStatus, setTimerStatus] = useState<"idle" | "active" | "paused" | "ended">("idle");
  const [showExtensionUI, setShowExtensionUI] = useState(false);
  const [extensionWaiting, setExtensionWaiting] = useState(false);
  const [alertFired, setAlertFired] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
      if (sessionData.status === "active") setTimerStatus("active");
      else if (sessionData.status === "paused") setTimerStatus("paused");
      else if (sessionData.status === "completed") setTimerStatus("ended");
      else if (sessionData.status === "cancelled") setTimerStatus("ended"); // キャンセル済みは終了として表示
    }
  }, [sessionData]);

  useEffect(() => {
    if (initialMessages) setMessages(initialMessages as Message[]);
  }, [initialMessages]);

  // Socket.io
  useEffect(() => {
    if (!session?.id) return;

    const socket = io(window.location.origin, {
      path: "/api/socket.io",
      transports: ["websocket", "polling"],
    });

    socket.on("connect", () => {
      setConnected(true);
      socket.emit("join_session", { sessionId: session.id, role: "client", token });
    });
    socket.on("disconnect", () => setConnected(false));

    socket.on("new_message", (msg: Message) => {
      setMessages((prev) => [...prev, msg]);
    });

    socket.on("timer_update", ({ status, remainingSeconds: rs, timerStartedAt: tsa }) => {
      setRemainingSeconds(rs);
      setTimerStartedAt(tsa);
      if (status === "active") {
        setTimerStatus("active");
        setShowExtensionUI(false);
        setExtensionWaiting(false);
      } else if (status === "paused") {
        setTimerStatus("paused");
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
    });

    socketRef.current = socket;
    return () => { socket.disconnect(); };
  }, [session?.id, token]);

  // Timer countdown
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);

    if (timerStatus === "active" && timerStartedAt !== null) {
      timerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - timerStartedAt) / 1000);
        const current = Math.max(0, remainingSeconds - elapsed);
        setRemainingSeconds(current);

        if (current <= ALERT_THRESHOLD && current > 0 && !alertFired) {
          setAlertFired(true);
        }

        if (current <= 0) {
          clearInterval(timerRef.current!);
          setTimerStatus("ended");
          setShowExtensionUI(true);
        }
      }, 1000);
    }

    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [timerStatus, timerStartedAt]);

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

  const handleExtensionRequest = useCallback((minutes: number) => {
    if (!session) return;
    const settings = storeSettings ?? [];
    const urlMap: Record<number, string> = {
      10: settings.find((s) => s.key === "stores_url_10min")?.value ?? "",
      20: settings.find((s) => s.key === "stores_url_20min")?.value ?? "",
      30: settings.find((s) => s.key === "stores_url_30min")?.value ?? "",
    };
    const url = urlMap[minutes];
    if (url) {
      window.open(url, "_blank");
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
            boxShadow: "0 4px 24px rgba(107,91,88,0.08)",
            padding: "40px 32px",
            maxWidth: "400px",
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
              onClick={() => {
                // react-queryのrefetchでセッションデータを再取得する
                refetchSession();
              }}
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

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: "#f9f5f4" }}
    >
      {/* Header */}
      <header
        style={{
          background: "#ffffff",
          borderBottom: "1px solid #d4bfbb",
          boxShadow: "0 2px 12px rgba(107,91,88,0.06)",
          padding: "12px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
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
        <div className="flex items-center gap-2">
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
      </header>

      {/* Timer Bar */}
      <div
        style={{
          background: isWarning ? "#fff3e0" : "#f3e7e5",
          borderBottom: "1px solid #d4bfbb",
          padding: "12px 16px",
          textAlign: "center",
          transition: "background 0.5s",
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
        {timerStatus === "ended" && !showExtensionUI && (
          <p style={{ fontSize: "13px", color: "#c62828" }}>
            セッション時間が終了しました
          </p>
        )}
      </div>

      {/* Extension UI */}
      {showExtensionUI && (
        <div
          style={{
            background: "#fff",
            borderBottom: "1px solid #d4bfbb",
            padding: "16px",
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
                {[10, 20, 30].map((mins) => (
                  <button
                    key={mins}
                    className="angelique-btn"
                    onClick={() => handleExtensionRequest(mins)}
                    style={{ padding: "8px 16px", fontSize: "13px" }}
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

      {/* Chat Area */}
      <div
        className="flex-1 flex flex-col"
        style={{ maxWidth: "600px", width: "100%", margin: "0 auto", padding: "0" }}
      >
        {/* Messages */}
        <div
          className="flex-1 overflow-y-auto p-4 flex flex-col gap-3"
          style={{ minHeight: 0, height: "calc(100vh - 280px)" }}
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
                <div>
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
                  <div
                    className={
                      msg.sender === "client" ? "chat-bubble-admin" : "chat-bubble-client"
                    }
                  >
                    {msg.content}
                  </div>
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
          }}
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
            disabled={timerStatus === "ended" && !extensionWaiting}
          />
          <button
            className="angelique-btn"
            onClick={handleSendMessage}
            disabled={!inputText.trim() || (timerStatus === "ended" && !extensionWaiting)}
            style={{ alignSelf: "flex-end", padding: "10px 16px" }}
          >
            送信
          </button>
        </div>
      </div>
    </div>
  );
}
