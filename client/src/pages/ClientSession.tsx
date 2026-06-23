import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { io, Socket } from "socket.io-client";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { toast } from "sonner";
import LinkifiedText from "@/components/LinkifiedText";
import VoiceCall from "@/components/VoiceCall";
import VideoCall from "@/components/VideoCall";
import { WaitingRoom } from "@/components/WaitingRoom";
import { BrandProvider } from "@/contexts/BrandContext";

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
  sessionType: "chat" | "voice" | "video";
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
  // 時間切れ後の延長確認ダイアログ
  const [showExtensionConfirm, setShowExtensionConfirm] = useState(false);
  // 延長申請で選択した分数（"延長しました"ボタンで送信する）
  const [pendingExtensionMinutes, setPendingExtensionMinutes] = useState<number | null>(null);
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
  // window.close()失敗時のフォールバックメッセージ
  const [showCloseMessage, setShowCloseMessage] = useState(false);
  // 画像アップロード
  const [uploadingImage, setUploadingImage] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 音声通話パネルの高さを動的計測（fixedバー分のスペース計算に使用）
  const [voicePanelHeight, setVoicePanelHeight] = useState(0);
  const voicePanelObserverRef = useRef<ResizeObserver | null>(null);
  const voicePanelCallbackRef = useCallback((el: HTMLDivElement | null) => {
    if (voicePanelObserverRef.current) {
      voicePanelObserverRef.current.disconnect();
      voicePanelObserverRef.current = null;
    }
    if (!el) return;
    const obs = new ResizeObserver(() => {
      setVoicePanelHeight(el.offsetHeight);
    });
    obs.observe(el);
    setVoicePanelHeight(el.offsetHeight);
    voicePanelObserverRef.current = obs;
  }, []);


  const { data: sessionData, isLoading, isError, refetch: refetchSession } = trpc.sessions.getByToken.useQuery(
    { token: token ?? "" },
    { enabled: !!token, retry: false }
  );
  const { data: initialMessages } = trpc.messages.list.useQuery(
    { sessionId: session?.id ?? 0 },
    { enabled: !!session?.id }
  );
  const { data: storeSettings } = trpc.settings.list.useQuery(
    { fortuneTellerId: sessionData?.fortuneTellerId ?? 0 },
    { enabled: !!sessionData?.fortuneTellerId }
  );
  const { data: fortuneTellerInfo } = trpc.fortuneTeller.getPublicInfo.useQuery(
    { id: sessionData?.fortuneTellerId ?? 0 },
    { enabled: !!sessionData?.fortuneTellerId }
  );

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
      // 延長確認ダイアログを表示（session_endedはお客様の選択後）
      setShowExtensionConfirm(true);
    });

    socket.on("extension_applied", ({ addMinutes }: { addMinutes: number }) => {
      setExtensionWaiting(false);
      setShowExtensionUI(false);
      setShowExtensionConfirm(false);
      toast.success(`${addMinutes}分延長されました`);
    });

    socket.on("session_ended", () => {
      setTimerStatus("ended");
      setShowWaitingRoom(false);
      setShowExtensionUI(false);
      setShowExtensionConfirm(false);
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

  // 画面を閉じる（スマホ/アプリブラウザでwindow.close()が効かない場合はメッセージ表示）
  const handleClose = useCallback(() => {
    try {
      window.close();
    } catch (_) {
      // ignore
    }
    setTimeout(() => {
      if (!window.closed) {
        setShowCloseMessage(true);
      }
    }, 300);
  }, []);

  const handleSendMessage = useCallback(() => {
    if (!inputText.trim() || !session) return;
    socketRef.current?.emit("send_message", {
      sessionId: session.id,
      sender: "client",
      content: inputText.trim(),
    });
    setInputText("");
  }, [inputText, session]);

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
    if (!file || !session) return;
    if (imageInputRef.current) imageInputRef.current.value = "";

    setUploadingImage(true);
    try {
      const imageUrl = await resizeImage(file);
      socketRef.current?.emit("send_message", {
        sessionId: session.id,
        sender: "client",
        content: "📷 画像を送信しました",
        imageUrl,
      });
    } catch (err) {
      console.error("[ClientSession] 画像送信エラー:", err);
      toast.error("画像の送信に失敗しました");
    } finally {
      setUploadingImage(false);
    }
  }, [session]);

  // 延長ボタン → 別タブで決済URLを開く＆申請分数を記憶
  const handleExtensionRequest = useCallback((minutes: number) => {
    if (!session) return;
    const settings = storeSettings ?? [];
    const sType = session.sessionType ?? "chat";
    const keyMap: Record<number, string> = {
      10: sType === "voice" || sType === "video" ? "stores_url_voice_10min" : "stores_url_chat_10min",
      30: sType === "voice" || sType === "video" ? "stores_url_voice_30min" : "stores_url_chat_30min",
    };
    // Fallback to old key format for backward compat
    const fallbackMap: Record<number, string> = { 10: "stores_url_10min", 30: "stores_url_30min" };
    const url = settings.find((s) => s.key === keyMap[minutes])?.value ||
      settings.find((s) => s.key === fallbackMap[minutes])?.value || "";
    if (url) {
      window.open(url, "_blank", "noopener,noreferrer");
    } else {
      toast.info("延長URLが設定されていません。占い師にご連絡ください。");
    }
    setPendingExtensionMinutes(minutes);
  }, [storeSettings, session]);

  const handleExtensionDone = useCallback(() => {
    if (!session) return;
    setExtensionWaiting(true);
    // ダイアログは閉じずに waiting 表示に切り替え
    socketRef.current?.emit("extension_requested", { sessionId: session.id, minutes: pendingExtensionMinutes ?? 0 });
  }, [session, pendingExtensionMinutes]);

  // 管理者送信URLバナーの「延長しました」
  const handleExtensionUrlDone = useCallback(() => {
    if (!session || !extensionUrlReceived) return;
    setExtensionWaiting(true);
    socketRef.current?.emit("extension_requested", { sessionId: session.id, minutes: extensionUrlReceived.minutes });
  }, [session, extensionUrlReceived]);

  // 時間切れ後の延長確認：お客様の選択を管理者に通知
  const handleExtensionChoice = useCallback((choice: "extend" | "end") => {
    if (!session) return;
    setShowExtensionConfirm(false);
    socketRef.current?.emit("client_extension_choice", { sessionId: session.id, choice });
    if (choice === "extend") {
      setShowExtensionUI(true);
    } else {
      setClientEnded(true);
    }
  }, [session]);

  // お客様側からセッションを終了する
  const handleClientEndSession = useCallback(() => {
    if (!session) return;
    socketRef.current?.emit("client_end_session", { sessionId: session.id });
    setClientEnded(true);
    setShowEndConfirm(false);
  }, [session]);

  // fixedバー合計高（ヘッダー53px + タイマー48px + 音声パネル）
  const HEADER_TIMER_HEIGHT = 101; // header(53) + timer(48)
  const totalFixedHeight = HEADER_TIMER_HEIGHT + (session?.sessionType === "voice" || session?.sessionType === "video" ? voicePanelHeight : 0);

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
            ご利用ありがとうございました。<br />
            このページを閉じてください。
          </p>
        </div>
      </div>
    );
  }

  return (
    <BrandProvider
      brandName={fortuneTellerInfo?.brandName ?? "angelique"}
      themeColor={fortuneTellerInfo?.themeColor ?? "#f3e7e5"}
      accentColor={fortuneTellerInfo?.accentColor ?? "#c9a8a3"}
    >
    <div
      className="min-h-screen flex flex-col"
      style={{ background: "var(--brand-main)", overflowX: "hidden", maxWidth: "100vw" }}
    >
      {/* Header - 固定 */}
      <header
        style={{
          background: "#ffffff",
          borderBottom: "1px solid var(--brand-border)",
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
            color: "var(--brand-accent)",
            letterSpacing: "2px",
          }}
        >
          ✦ {fortuneTellerInfo?.brandName ?? "angelique"}
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
          ref={voicePanelCallbackRef}
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

      {/* Video Call Panel (video sessions only) - fixed固定 */}
      {session?.sessionType === "video" && (
        <div
          ref={voicePanelCallbackRef}
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
          <VideoCall
            sessionId={session.id}
            role="client"
            isSessionActive={timerStatus === "active" || timerStatus === "paused"}
          />
        </div>
      )}

      {/* 延長確認ダイアログ（時間切れ直後に表示） */}
      {showExtensionConfirm && (
        <div
          style={{
            background: "#fff",
            borderBottom: "1px solid #d4bfbb",
            padding: "20px 16px",
            position: "fixed",
            top: `${totalFixedHeight}px`,
            left: 0,
            right: 0,
            zIndex: 39,
            boxShadow: "0 4px 16px rgba(107,91,88,0.12)",
            textAlign: "center",
          }}
        >
          {extensionWaiting ? (
            /* 待機中表示 */
            <div style={{ padding: "8px 0" }}>
              <div style={{ fontSize: "22px", marginBottom: "8px" }}>🙏</div>
              <div style={{ fontSize: "15px", color: "#6b5b58", fontWeight: 600, marginBottom: "6px" }}>
                占い師の確認をお待ちください
              </div>
              <p style={{ fontSize: "13px", color: "#9e8480" }}>
                確認が取れ次第、セッションを再開します
              </p>
            </div>
          ) : (
            /* 延長選択UI */
            <>
              <div
                style={{
                  fontFamily: "'Cormorant Garamond', serif",
                  fontSize: "20px",
                  color: "#6b5b58",
                  marginBottom: "6px",
                }}
              >
                お時間になりました
              </div>
              <p style={{ fontSize: "13px", color: "#9e8480", marginBottom: "16px" }}>
                延長をご希望の場合は、下記よりお手続きください
              </p>
              <div className="flex gap-2 justify-center flex-wrap" style={{ marginBottom: "14px" }}>
                {[10, 30].map((mins) => (
                  <button
                    key={mins}
                    className="angelique-btn"
                    onClick={() => handleExtensionRequest(mins)}
                    style={{ padding: "12px 20px", fontSize: "14px" }}
                  >
                    {mins}分延長
                  </button>
                ))}
              </div>
              {pendingExtensionMinutes !== null && (
                <div style={{ marginBottom: "10px" }}>
                  <p style={{ fontSize: "12px", color: "#9e8480", marginBottom: "8px" }}>
                    決済が完了したらこちらを押してください
                  </p>
                  <button
                    className="angelique-btn"
                    onClick={handleExtensionDone}
                    style={{ padding: "12px 28px", fontSize: "14px" }}
                  >
                    延長しました ✓
                  </button>
                </div>
              )}
              <button
                onClick={() => {
                  setShowExtensionConfirm(false);
                  setPendingExtensionMinutes(null);
                  setClientEnded(true);
                }}
                style={{
                  background: "none",
                  border: "none",
                  fontSize: "13px",
                  color: "#9e8480",
                  cursor: "pointer",
                  textDecoration: "underline",
                  padding: "4px 8px",
                }}
              >
                終了する
              </button>
            </>
          )}
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
            top: `${totalFixedHeight}px`,
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

      {/* 管理者から延長URLを受信した場合の専用バー（残り5分フロー） */}
      {extensionUrlReceived && (
        <div
          style={{
            background: "#fdf5f3",
            borderBottom: "1px solid #d4bfbb",
            padding: "16px",
            position: "fixed",
            top: `${totalFixedHeight}px`,
            left: 0,
            right: 0,
            zIndex: 37,
            boxShadow: "0 2px 8px rgba(107,91,88,0.08)",
            textAlign: "center",
          }}
        >
          {extensionWaiting ? (
            /* 待機中表示 */
            <div style={{ padding: "4px 0" }}>
              <div style={{ fontSize: "20px", marginBottom: "6px" }}>🙏</div>
              <div style={{ fontSize: "15px", color: "#6b5b58", fontWeight: 600, marginBottom: "4px" }}>
                占い師の確認をお待ちください
              </div>
              <p style={{ fontSize: "13px", color: "#9e8480" }}>
                確認が取れ次第、セッションを再開します
              </p>
            </div>
          ) : (
            <>
              <p style={{ fontSize: "13px", color: "#6b5b58", marginBottom: "10px", fontWeight: 500 }}>
                ✨ {extensionUrlReceived.minutes}分延長のご案内が届いています
              </p>
              <a
                href={extensionUrlReceived.url}
                target="_blank"
                rel="noopener noreferrer"
                className="angelique-btn"
                style={{ padding: "10px 24px", fontSize: "14px", display: "inline-block", marginBottom: "12px" }}
              >
                {extensionUrlReceived.minutes}分延長のお手続きはこちら
              </a>
              <div>
                <p style={{ fontSize: "12px", color: "#9e8480", marginBottom: "8px" }}>
                  決済が完了したらこちらを押してください
                </p>
                <button
                  className="angelique-btn"
                  onClick={handleExtensionUrlDone}
                  style={{ padding: "12px 28px", fontSize: "14px" }}
                >
                  延長しました ✓
                </button>
              </div>
              <button
                onClick={() => setExtensionUrlReceived(null)}
                style={{ display: "block", margin: "10px auto 0", fontSize: "12px", color: "#9e8480", background: "none", border: "none", cursor: "pointer" }}
              >
                × 閉じる
              </button>
            </>
          )}
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
            <p style={{ color: "#9e8480", fontSize: "15px", lineHeight: 1.8 }}>
              ご利用ありがとうございました。<br />
              このページを閉じてください。
            </p>
          </div>
        </div>
      )}

      {/* fixedバー合計高さ分のスペースを確保（音声パネルは動的計測） */}
      <div style={{ height: `${totalFixedHeight}px` }} />

      {/* Chat Area */}
      <div
        className="flex-1 flex flex-col"
        style={{ maxWidth: "600px", width: "100%", margin: "0 auto", padding: "0" }}
      >
        {/* Messages */}
        <div
          className="flex-1 overflow-y-auto p-4 flex flex-col gap-3"
          style={{ minHeight: 0, paddingTop: "80px" }}
        >
          {/* 繰越分の通知（繰越がある場合のみ表示） */}
          {(session.carryoverMinutes ?? 0) > 0 && (
            <div
              style={{
                background: "#fdf8f0",
                border: "1px dashed #f0c070",
                borderRadius: "12px",
                padding: "10px 16px",
                fontSize: "13px",
                color: "#7a5c00",
                textAlign: "center",
                lineHeight: 1.7,
              }}
            >
              ✨ 前回の繰越分 <strong>{session.carryoverMinutes}分</strong> が含まれています
              <br />
              <span style={{ fontSize: "12px", color: "#9e8480" }}>
                本日のセッション時間：{session.durationMinutes + session.carryoverMinutes}分
                （{session.durationMinutes}分 + 繰越{session.carryoverMinutes}分）
              </span>
            </div>
          )}
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
            <div key={msg.id}>
              {msg.sender === "system" ? (
                /* システムメッセージ（中央） */
                <div className="flex justify-center">
                  <div className="chat-bubble-system">
                    <LinkifiedText text={msg.content} />
                  </div>
                </div>
              ) : msg.sender === "client" ? (
                /* 自分のメッセージ（右寄せ） */
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                    {msg.imageUrl ? (
                      <div>
                        <img
                          src={msg.imageUrl}
                          alt="送信画像"
                          style={{ maxWidth: "240px", borderRadius: "12px", cursor: "pointer", border: "1px solid #d4bfbb" }}
                          onClick={() => window.open(msg.imageUrl!, "_blank")}
                        />
                        <div style={{ marginTop: "4px" }}>
                          <a
                            href={msg.imageUrl}
                            download
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ fontSize: "11px", color: "#c9a8a3", textDecoration: "underline" }}
                          >
                            ↓ 画像を保存
                          </a>
                        </div>
                      </div>
                    ) : (
                      <div
                        className="chat-bubble-client-self"
                        style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", overflowWrap: "break-word" }}
                      >
                        <LinkifiedText text={msg.content} />
                      </div>
                    )}
                    <div style={{ fontSize: "10px", color: "#d4bfbb", marginTop: "3px", textAlign: "right" }}>
                      {format(new Date(msg.createdAt), "HH:mm")}
                    </div>
                  </div>
                </div>
              ) : (
                /* 相手のメッセージ（左寄せ） */
                <div style={{ display: "flex", justifyContent: "flex-start", flexDirection: "column", alignItems: "flex-start" }}>
                  <div style={{ fontSize: "11px", color: "#9e8480", marginBottom: "3px", marginLeft: "4px" }}>
                    angelique
                  </div>
                  {msg.imageUrl ? (
                    <div>
                      <img
                        src={msg.imageUrl}
                        alt="送信画像"
                        style={{ maxWidth: "240px", borderRadius: "12px", cursor: "pointer", border: "1px solid #d4bfbb" }}
                        onClick={() => window.open(msg.imageUrl!, "_blank")}
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
                  <div style={{ fontSize: "10px", color: "#d4bfbb", marginTop: "3px", textAlign: "left" }}>
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
    </BrandProvider>
  );
}
