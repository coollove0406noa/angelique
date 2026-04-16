import { useState, useEffect, useRef, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { Mic, MicOff, Phone, PhoneOff, AlertCircle, CheckCircle, Loader2, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

// ─────────────────────────────────────────────────────────────────────────────
// 型定義
// ─────────────────────────────────────────────────────────────────────────────

interface VoiceCallProps {
  sessionId: number;
  role: "admin" | "client";
  isSessionActive: boolean;
  /** trueのとき：セッション開始前にチャンネルへミュートで事前接続する（管理者向け） */
  preConnect?: boolean;
}

type CallStatus =
  | "idle"
  | "mic_check"
  | "mic_ok"
  | "mic_denied"
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

type PreConnectStatus = "idle" | "connecting" | "ready" | "failed";

// Agora SDK はグローバルキャッシュ（動的インポート）
let AgoraRTC: typeof import("agora-rtc-sdk-ng").default | null = null;

// ─────────────────────────────────────────────────────────────────────────────
// コンポーネント
// ─────────────────────────────────────────────────────────────────────────────

export default function VoiceCall({
  sessionId,
  role,
  isSessionActive,
  preConnect = false,
}: VoiceCallProps) {
  const [callStatus, setCallStatus] = useState<CallStatus>("idle");
  const [preConnectStatus, setPreConnectStatus] = useState<PreConnectStatus>("idle");
  const [isMuted, setIsMuted] = useState(false);
  const [receiveOnly, setReceiveOnly] = useState(false); // マイクなし受信専用モード
  const [remoteUserCount, setRemoteUserCount] = useState(0);
  const [callDuration, setCallDuration] = useState(0);
  const [errorDetail, setErrorDetail] = useState("");
  const [showStartHint, setShowStartHint] = useState(true);
  /** マイク送信音量（0〜200 / デフォルト200） */
  const [micGain, setMicGainState] = useState(200);

  const clientRef = useRef<import("agora-rtc-sdk-ng").IAgoraRTCClient | null>(null);
  const localAudioTrackRef = useRef<import("agora-rtc-sdk-ng").IMicrophoneAudioTrack | null>(null);
  const callStartTimeRef = useRef<number | null>(null);
  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 事前接続でセッション開始待ち状態か
  const preConnectedWaitingRef = useRef(false);
  // isSessionActive の前回値（変化検知用）
  const prevIsSessionActiveRef = useRef(isSessionActive);

  const getTokenMutation = trpc.agora.getToken.useMutation();
  const channelName = `session-${sessionId}`;
  const uid = role === "admin" ? 1 : 2;

  // ── SDK ローダー ──────────────────────────────────────────────────────────
  const loadAgoraSDK = useCallback(async () => {
    if (!AgoraRTC) {
      const module = await import("agora-rtc-sdk-ng");
      AgoraRTC = module.default;
      AgoraRTC.setLogLevel(4);
    }
    return AgoraRTC;
  }, []);

  // ── タイマー ──────────────────────────────────────────────────────────────
  const startDurationTimer = useCallback(() => {
    callStartTimeRef.current = Date.now();
    durationTimerRef.current = setInterval(() => {
      if (callStartTimeRef.current) {
        setCallDuration(Math.floor((Date.now() - callStartTimeRef.current) / 1000));
      }
    }, 1000);
  }, []);

  const stopDurationTimer = useCallback(() => {
    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }
    callStartTimeRef.current = null;
    setCallDuration(0);
  }, []);

  const formatDuration = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

  // ── イベントリスナー登録（共通）────────────────────────────────────────────
  const setupClientEvents = useCallback(
    (rtcClient: import("agora-rtc-sdk-ng").IAgoraRTCClient) => {
      rtcClient.on("user-published", async (user, mediaType) => {
        await rtcClient.subscribe(user, mediaType);
        if (mediaType === "audio") {
          // 受信音量を最大200に設定してから再生
          user.audioTrack?.setVolume(200);
          user.audioTrack?.play();
          setRemoteUserCount((prev) => prev + 1);
          toast.success(role === "admin" ? "お客様が通話に参加しました" : "占い師が通話に参加しました");
        }
      });

      rtcClient.on("user-unpublished", (_user, mediaType) => {
        if (mediaType === "audio") {
          setRemoteUserCount((prev) => Math.max(0, prev - 1));
        }
      });

      rtcClient.on("user-left", () => {
        setRemoteUserCount((prev) => Math.max(0, prev - 1));
        toast.info(role === "admin" ? "お客様が通話を終了しました" : "占い師が通話を終了しました");
      });

      rtcClient.on("connection-state-change", (curState) => {
        if (curState === "DISCONNECTED") {
          setCallStatus("disconnected");
          stopDurationTimer();
          toast.warning("通話が切断されました。再接続ボタンを押してください。");
        }
      });
    },
    [role, stopDurationTimer]
  );

  // ── マイクゲイン変更（スライダー連動）──────────────────────────────────
  const changeMicGain = useCallback((value: number) => {
    setMicGainState(value);
    localAudioTrackRef.current?.setVolume(value);
  }, []);

  // ── 音声トラック作成（明示的エンコーダー設定 + 最大音量）──────────────
  const createAudioTrack = useCallback(
    async (sdk: typeof import("agora-rtc-sdk-ng").default) => {
      const track = await sdk.createMicrophoneAudioTrack({
        encoderConfig: {
          sampleRate: 48000, // CD品質サンプルレート
          stereo: false,     // モノラル（通話に最適）
          bitrate: 128,      // 128kbps（最大音質）
        },
        AEC: true,   // エコーキャンセル（必須）
        ANS: false,  // ノイズ抑制OFF: 自然な声質を維持
        AGC: false,  // 自動ゲインコントロールOFF: 原音量を忠実に送信
      });
      // 送信音量を最大200に設定（デフォルト100の2倍）
      track.setVolume(200);
      return track;
    },
    []
  );

  // ── STEP 1: マイク権限確認 ────────────────────────────────────────────────
  const checkMicPermission = useCallback(async () => {
    setCallStatus("mic_check");
    setErrorDetail("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      stream.getTracks().forEach((t) => t.stop());
      setCallStatus("mic_ok");
    } catch (err: unknown) {
      const error = err as Error;
      if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
        setCallStatus("mic_denied");
        setErrorDetail("マイクへのアクセスが拒否されました。");
      } else if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
        setCallStatus("error");
        setErrorDetail("マイクが見つかりません。マイクが接続されているか確認してください。");
      } else {
        setCallStatus("error");
        setErrorDetail(`マイクの確認中にエラーが発生しました: ${(err as Error).message}`);
      }
    }
  }, []);

  // ── STEP 2: 通話開始（問題5: マイク失敗でも受信のみで接続）─────────────
  const startCall = useCallback(async () => {
    if (
      callStatus !== "mic_ok" &&
      callStatus !== "disconnected" &&
      callStatus !== "error"
    )
      return;

    setCallStatus("connecting");
    setErrorDetail("");
    setReceiveOnly(false);

    try {
      const sdk = await loadAgoraSDK();

      const tokenData = await getTokenMutation.mutateAsync({
        channelName,
        uid,
        role: "publisher",
      });

      const rtcClient = sdk.createClient({ mode: "rtc", codec: "vp8" });
      clientRef.current = rtcClient;
      setupClientEvents(rtcClient);

      // チャンネルに参加（マイクなしでも必ず参加 → 受信可能になる）
      await rtcClient.join(tokenData.appId, channelName, tokenData.token ?? null, uid);

      // マイクトラック作成を試みる（失敗しても受信のみで継続）
      try {
        const localAudioTrack = await createAudioTrack(sdk);
        localAudioTrackRef.current = localAudioTrack;
        await rtcClient.publish([localAudioTrack]);
      } catch (micErr) {
        console.warn("[VoiceCall] Mic unavailable, switching to receive-only:", micErr);
        setReceiveOnly(true);
        toast.info("マイクが使えないため受信のみで接続しました。相手の声は聞こえます。");
      }

      setCallStatus("connected");
      startDurationTimer();
      if (!receiveOnly) toast.success("通話を開始しました");
    } catch (err: unknown) {
      const error = err as Error;
      console.error("[VoiceCall] Failed to start call:", error);
      setCallStatus("error");

      let detail = "通話の開始に失敗しました。";
      if (error.message?.includes("PERMISSION_DENIED") || error.message?.includes("NotAllowed")) {
        detail = "マイクの許可が必要です。ブラウザのアドレスバー左のアイコンからマイクを許可してください。";
      } else if (error.message?.includes("UID_CONFLICT")) {
        detail = "同じチャンネルに既に接続されています。ページを再読み込みしてください。";
      } else if (
        error.message?.includes("INVALID_VENDOR_KEY") ||
        error.message?.includes("INVALID_TOKEN")
      ) {
        detail = "Agoraのトークンが無効です。ページを再読み込みしてください。";
      } else if (error.message) {
        detail = `エラー: ${error.message}`;
      }
      setErrorDetail(detail);
      toast.error(detail);

      // クリーンアップ
      if (clientRef.current) {
        await clientRef.current.leave().catch(() => {});
        clientRef.current = null;
      }
      if (localAudioTrackRef.current) {
        localAudioTrackRef.current.close();
        localAudioTrackRef.current = null;
      }
    }
  }, [
    callStatus,
    channelName,
    createAudioTrack,
    getTokenMutation,
    loadAgoraSDK,
    receiveOnly,
    setupClientEvents,
    startDurationTimer,
    uid,
  ]);

  // ── 事前接続（問題3: セッション開始前にミュートでチャンネルに参加）──────
  const preConnectToChannel = useCallback(async () => {
    if (preConnectStatus !== "idle") return;
    setPreConnectStatus("connecting");

    try {
      const sdk = await loadAgoraSDK();

      const tokenData = await getTokenMutation.mutateAsync({
        channelName,
        uid,
        role: "publisher",
      });

      const rtcClient = sdk.createClient({ mode: "rtc", codec: "vp8" });
      clientRef.current = rtcClient;
      setupClientEvents(rtcClient);

      // チャンネル参加
      await rtcClient.join(tokenData.appId, channelName, tokenData.token ?? null, uid);

      // マイクトラック作成（ミュート状態で publish）
      const localAudioTrack = await createAudioTrack(sdk);
      localAudioTrackRef.current = localAudioTrack;
      await localAudioTrack.setMuted(true);
      await rtcClient.publish([localAudioTrack]);

      preConnectedWaitingRef.current = true;
      setPreConnectStatus("ready");
      setCallStatus("connected");
      setIsMuted(true); // 表示上もミュート中
    } catch (err) {
      console.warn("[VoiceCall] Pre-connect failed (will fall back to manual):", err);
      setPreConnectStatus("failed");
      // エラーUIは出さない（手動接続にフォールバック）
    }
  }, [
    preConnectStatus,
    channelName,
    createAudioTrack,
    getTokenMutation,
    loadAgoraSDK,
    setupClientEvents,
    uid,
  ]);

  // ── セッション開始検知 → 事前接続済みなら自動アンミュート ─────────────
  useEffect(() => {
    const wasActive = prevIsSessionActiveRef.current;
    prevIsSessionActiveRef.current = isSessionActive;

    if (!wasActive && isSessionActive && preConnectedWaitingRef.current) {
      preConnectedWaitingRef.current = false;
      if (localAudioTrackRef.current) {
        localAudioTrackRef.current.setMuted(false);
      }
      setIsMuted(false);
      startDurationTimer();
      toast.success("🎤 通話開始（事前接続済み・すぐ話せます）");
    }
  }, [isSessionActive, startDurationTimer]);

  // ── 事前接続の自動トリガー ────────────────────────────────────────────────
  useEffect(() => {
    if (preConnect && !isSessionActive && preConnectStatus === "idle") {
      // ページロード直後に即実行すると重いので少し遅延
      const t = setTimeout(preConnectToChannel, 1500);
      return () => clearTimeout(t);
    }
  }, [preConnect, isSessionActive, preConnectStatus, preConnectToChannel]);

  // ── 通話終了 ──────────────────────────────────────────────────────────────
  const endCall = useCallback(async () => {
    preConnectedWaitingRef.current = false;
    try {
      if (localAudioTrackRef.current) {
        localAudioTrackRef.current.stop();
        localAudioTrackRef.current.close();
        localAudioTrackRef.current = null;
      }
      if (clientRef.current) {
        await clientRef.current.leave();
        clientRef.current = null;
      }
    } catch (err) {
      console.error("[VoiceCall] endCall error:", err);
    }
    setCallStatus("idle");
    setPreConnectStatus("idle");
    setIsMuted(false);
    setReceiveOnly(false);
    setRemoteUserCount(0);
    setErrorDetail("");
    stopDurationTimer();
    toast.info("通話を終了しました");
  }, [stopDurationTimer]);

  // ── ミュート切り替え ──────────────────────────────────────────────────────
  const toggleMute = useCallback(async () => {
    if (!localAudioTrackRef.current) return;
    const newMuted = !isMuted;
    await localAudioTrackRef.current.setMuted(newMuted);
    setIsMuted(newMuted);
    toast.info(newMuted ? "マイクをミュートしました" : "マイクのミュートを解除しました");
  }, [isMuted]);

  // ── スタートヒント消去 ────────────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => setShowStartHint(false), 5000);
    return () => clearTimeout(t);
  }, []);

  // ── アンマウント時クリーンアップ ─────────────────────────────────────────
  useEffect(() => {
    return () => {
      stopDurationTimer();
      localAudioTrackRef.current?.stop();
      localAudioTrackRef.current?.close();
      clientRef.current?.leave().catch(() => {});
    };
  }, [stopDurationTimer]);

  // ── 派生状態 ─────────────────────────────────────────────────────────────
  const isConnected   = callStatus === "connected";
  const isConnecting  = callStatus === "connecting";
  const isMicCheck    = callStatus === "mic_check";
  const isMicOk       = callStatus === "mic_ok";
  const isMicDenied   = callStatus === "mic_denied";
  const isDisconnected= callStatus === "disconnected";
  const isError       = callStatus === "error";
  const isPreConnecting = preConnectStatus === "connecting";
  const isPreReady    = preConnectStatus === "ready";

  // 事前接続 + セッション未開始のときは "スタンバイ中" 表示
  const isStandby = isPreReady && !isSessionActive;

  // ─────────────────────────────────────────────────────────────────────────
  // レンダリング
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="voice-call-panel">
      {/* ── ステータスインジケーター ─────────────────────────────── */}
      <div className="flex items-center gap-2 mb-3">
        <div
          className={`w-2.5 h-2.5 rounded-full ${
            isStandby
              ? "bg-blue-400 animate-pulse"
              : isConnected && isSessionActive
              ? "bg-green-500 animate-pulse"
              : isConnecting || isMicCheck || isPreConnecting
              ? "bg-yellow-400 animate-pulse"
              : isError || isMicDenied
              ? "bg-red-500"
              : isMicOk
              ? "bg-blue-400"
              : "bg-gray-300"
          }`}
        />
        <span className="text-sm font-medium" style={{ color: "#6b5b58" }}>
          {isStandby
            ? "スタンバイ中（ミュート接続済み）"
            : isConnected && isSessionActive
            ? `通話中 ${formatDuration(callDuration)}`
            : isConnecting
            ? "接続中..."
            : isPreConnecting
            ? "事前接続中..."
            : isMicCheck
            ? "マイク確認中..."
            : isMicOk
            ? "マイク確認OK"
            : isMicDenied
            ? "マイク許可が必要"
            : isDisconnected
            ? "通話が切断されました"
            : isError
            ? "接続エラー"
            : "音声通話"}
        </span>

        {receiveOnly && isConnected && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">
            受信のみ
          </span>
        )}
        {isConnected && isSessionActive && remoteUserCount > 0 && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">
            相手接続済み
          </span>
        )}
        {isConnected && isSessionActive && remoteUserCount === 0 && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700">
            相手待ち
          </span>
        )}
      </div>

      {/* ── マイク拒否ガイド ─────────────────────────────────────── */}
      {isMicDenied && (
        <div
          style={{
            background: "#fff3f3",
            border: "1px solid #f5c6c6",
            borderRadius: "10px",
            padding: "12px 14px",
            marginBottom: "10px",
          }}
        >
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
            <div>
              <p style={{ fontSize: "13px", color: "#c0392b", fontWeight: 600, marginBottom: "6px" }}>
                マイクへのアクセスが拒否されました
              </p>
              <ol style={{ fontSize: "12px", color: "#9e8480", lineHeight: 1.7, paddingLeft: "16px", margin: 0 }}>
                <li>ブラウザのアドレスバー左端の 🔒 アイコンをクリック</li>
                <li>「マイク」を <strong>許可</strong> に変更</li>
                <li>ページを再読み込み（F5）してください</li>
              </ol>
            </div>
          </div>
        </div>
      )}

      {/* ── エラー詳細 ──────────────────────────────────────────── */}
      {(isError || isDisconnected) && errorDetail && (
        <div
          style={{
            background: "#fff8f0",
            border: "1px solid #f5d6b0",
            borderRadius: "10px",
            padding: "10px 12px",
            marginBottom: "10px",
          }}
        >
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-orange-500 mt-0.5 flex-shrink-0" />
            <p style={{ fontSize: "12px", color: "#9e8480", lineHeight: 1.5 }}>{errorDetail}</p>
          </div>
        </div>
      )}

      {/* ── マイクOK通知 ─────────────────────────────────────────── */}
      {isMicOk && (
        <div
          style={{
            background: "#f0fff4",
            border: "1px solid #b2dfdb",
            borderRadius: "10px",
            padding: "10px 12px",
            marginBottom: "10px",
          }}
        >
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
            <p style={{ fontSize: "12px", color: "#2e7d32" }}>
              マイクの確認が完了しました。「通話を開始する」を押してください。
            </p>
          </div>
        </div>
      )}

      {/* ── 受信のみモード通知 ───────────────────────────────────── */}
      {receiveOnly && isConnected && (
        <div
          style={{
            background: "#fff8e1",
            border: "1px solid #ffe082",
            borderRadius: "10px",
            padding: "10px 12px",
            marginBottom: "10px",
          }}
        >
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
            <p style={{ fontSize: "12px", color: "#795548", lineHeight: 1.5 }}>
              マイクが使えないため受信専用モードで接続中です。相手の声は聞こえます。
            </p>
          </div>
        </div>
      )}

      {/* ── 事前接続中インジケーター ─────────────────────────────── */}
      {isPreConnecting && (
        <p style={{ fontSize: "11px", color: "#9e8480", marginBottom: "8px" }}>
          <Loader2 className="w-3 h-3 inline mr-1 animate-spin" />
          バックグラウンドで接続を準備しています…
        </p>
      )}

      {/* ── コントロールボタン ───────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">

        {/* 通常: マイク確認ボタン */}
        {callStatus === "idle" && preConnectStatus !== "connecting" && preConnectStatus !== "ready" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            {showStartHint && isSessionActive && (
              <p style={{ fontSize: "12px", color: "#4caf7d", fontWeight: 600, margin: 0 }}>
                👆 まずこちらをタップしてください
              </p>
            )}
            <Button
              onClick={() => { setShowStartHint(false); checkMicPermission(); }}
              disabled={!isSessionActive}
              className={`voice-call-btn-start${showStartHint && isSessionActive ? " voice-call-btn-blink" : ""}`}
              size="sm"
            >
              <Mic className="w-4 h-4 mr-1.5" />
              マイクを確認する
            </Button>
          </div>
        )}

        {/* マイク確認中スピナー */}
        {isMicCheck && (
          <Button disabled size="sm" variant="outline">
            <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
            確認中...
          </Button>
        )}

        {/* マイクOK → 通話開始ボタン */}
        {isMicOk && (
          <Button onClick={startCall} className="voice-call-btn-start" size="sm">
            <Phone className="w-4 h-4 mr-1.5" />
            通話を開始する
          </Button>
        )}

        {/* 事前接続済み + セッション待機中 */}
        {isStandby && (
          <div className="flex items-center gap-1.5 text-sm" style={{ color: "#9e8480" }}>
            <Radio className="w-4 h-4 text-blue-400 animate-pulse" />
            セッション開始と同時に通話が始まります
          </div>
        )}

        {/* 再確認 / 再接続ボタン */}
        {(isMicDenied || isError || isDisconnected) && (
          <Button
            onClick={
              isMicDenied
                ? checkMicPermission
                : isDisconnected
                ? startCall
                : checkMicPermission
            }
            size="sm"
            variant="outline"
            style={{ borderColor: "#c9a8a3", color: "#6b5b58" }}
          >
            <Phone className="w-4 h-4 mr-1.5" />
            {isMicDenied ? "再度マイクを確認" : isDisconnected ? "再接続する" : "再試行する"}
          </Button>
        )}

        {/* 接続中スピナー */}
        {isConnecting && (
          <Button disabled size="sm" variant="outline">
            <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
            接続中...
          </Button>
        )}

        {/* 通話中コントロール */}
        {(isConnected || isConnecting) && isSessionActive && (
          <>
            <Button
              onClick={endCall}
              variant="destructive"
              size="sm"
              className="voice-call-btn-end"
            >
              <PhoneOff className="w-4 h-4 mr-1.5" />
              通話を終了する
            </Button>

            {isConnected && !receiveOnly && (
              <Button
                onClick={toggleMute}
                variant="outline"
                size="sm"
                className={`voice-call-btn-mute ${isMuted ? "muted" : ""}`}
              >
                {isMuted ? (
                  <>
                    <MicOff className="w-4 h-4 mr-1.5" />
                    ミュート解除
                  </>
                ) : (
                  <>
                    <Mic className="w-4 h-4 mr-1.5" />
                    ミュート
                  </>
                )}
              </Button>
            )}
          </>
        )}
      </div>

      {/* ── 管理者専用: マイク音量スライダー ───────────────────── */}
      {role === "admin" && isConnected && !receiveOnly && (
        <div style={{ marginTop: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
            <span style={{ fontSize: "11px", color: "#9e8480" }}>
              <Mic className="w-3 h-3 inline mr-1" />
              マイク音量
            </span>
            <span style={{ fontSize: "11px", fontWeight: 600, color: micGain >= 150 ? "#4caf7d" : "#9e8480" }}>
              {micGain}%
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={200}
            step={10}
            value={micGain}
            onChange={(e) => changeMicGain(Number(e.target.value))}
            style={{
              width: "100%",
              accentColor: "#c9a8a3",
              cursor: "pointer",
            }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", color: "#c9b8b5", marginTop: "2px" }}>
            <span>0%</span>
            <span>100%</span>
            <span>200%</span>
          </div>
        </div>
      )}

      {/* ── 補足テキスト ─────────────────────────────────────────── */}
      {!isSessionActive && callStatus === "idle" && preConnectStatus === "failed" && (
        <p className="text-xs mt-2" style={{ color: "#9e8480" }}>
          セッションを開始すると通話ボタンが有効になります
        </p>
      )}
      {!isSessionActive && callStatus === "idle" && preConnectStatus === "idle" && !preConnect && (
        <p className="text-xs mt-2" style={{ color: "#9e8480" }}>
          セッションを開始すると通話ボタンが有効になります
        </p>
      )}
      {isConnected && isSessionActive && (
        <p className="text-xs mt-2" style={{ color: "#9e8480" }}>
          チャットも同時に使えます
        </p>
      )}
    </div>
  );
}
