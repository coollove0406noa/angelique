import { useState, useEffect, useRef, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { Mic, MicOff, Phone, PhoneOff, AlertCircle, CheckCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface VoiceCallProps {
  sessionId: number;
  role: "admin" | "client";
  isSessionActive: boolean;
}

type CallStatus = "idle" | "mic_check" | "mic_ok" | "mic_denied" | "connecting" | "connected" | "disconnected" | "error";

// Agora RTC SDK is loaded dynamically to avoid SSR issues
let AgoraRTC: typeof import("agora-rtc-sdk-ng").default | null = null;

export default function VoiceCall({ sessionId, role, isSessionActive }: VoiceCallProps) {
  const [callStatus, setCallStatus] = useState<CallStatus>("idle");
  const [isMuted, setIsMuted] = useState(false);
  const [remoteUserCount, setRemoteUserCount] = useState(0);
  const [callDuration, setCallDuration] = useState(0);
  const [errorDetail, setErrorDetail] = useState<string>("");

  const clientRef = useRef<import("agora-rtc-sdk-ng").IAgoraRTCClient | null>(null);
  const localAudioTrackRef = useRef<import("agora-rtc-sdk-ng").IMicrophoneAudioTrack | null>(null);
  const callStartTimeRef = useRef<number | null>(null);
  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const getTokenMutation = trpc.agora.getToken.useMutation();
  const channelName = `session-${sessionId}`;

  // Load Agora SDK dynamically
  const loadAgoraSDK = useCallback(async () => {
    if (!AgoraRTC) {
      const module = await import("agora-rtc-sdk-ng");
      AgoraRTC = module.default;
      AgoraRTC.setLogLevel(4);
    }
    return AgoraRTC;
  }, []);

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

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  // Step 1: Check microphone permission
  const checkMicPermission = useCallback(async () => {
    setCallStatus("mic_check");
    setErrorDetail("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      // マイク許可OK → すぐに停止してから通話開始へ
      stream.getTracks().forEach(t => t.stop());
      setCallStatus("mic_ok");
    } catch (err: unknown) {
      const error = err as Error;
      if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
        setCallStatus("mic_denied");
        setErrorDetail("マイクへのアクセスが拒否されました。ブラウザのアドレスバー左のアイコンからマイクを許可してください。");
      } else if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
        setCallStatus("error");
        setErrorDetail("マイクが見つかりません。マイクが接続されているか確認してください。");
      } else {
        setCallStatus("error");
        setErrorDetail(`マイクの確認中にエラーが発生しました: ${error.message}`);
      }
    }
  }, []);

  // Step 2: Start actual call (after mic permission confirmed)
  const startCall = useCallback(async () => {
    if (callStatus !== "mic_ok" && callStatus !== "disconnected" && callStatus !== "error") return;

    setCallStatus("connecting");
    setErrorDetail("");

    try {
      const sdk = await loadAgoraSDK();

      // Get token from server
      const tokenData = await getTokenMutation.mutateAsync({
        channelName,
        uid: role === "admin" ? 1 : 2,
        role: "publisher",
      });

      // Create RTC client
      const rtcClient = sdk.createClient({ mode: "rtc", codec: "vp8" });
      clientRef.current = rtcClient;

      // Set up event listeners
      rtcClient.on("user-published", async (user, mediaType) => {
        await rtcClient.subscribe(user, mediaType);
        if (mediaType === "audio") {
          user.audioTrack?.play();
          setRemoteUserCount(prev => prev + 1);
          toast.success(role === "admin" ? "お客様が通話に参加しました" : "占い師が通話に参加しました");
        }
      });

      rtcClient.on("user-unpublished", (_user, mediaType) => {
        if (mediaType === "audio") {
          setRemoteUserCount(prev => Math.max(0, prev - 1));
        }
      });

      rtcClient.on("user-left", () => {
        setRemoteUserCount(prev => Math.max(0, prev - 1));
        toast.info(role === "admin" ? "お客様が通話を終了しました" : "占い師が通話を終了しました");
      });

      rtcClient.on("connection-state-change", (curState) => {
        if (curState === "DISCONNECTED") {
          setCallStatus("disconnected");
          stopDurationTimer();
          toast.warning("通話が切断されました。再接続ボタンを押してください。");
        }
      });

      // Join channel
      await rtcClient.join(
        tokenData.appId,
        channelName,
        tokenData.token ?? null,
        role === "admin" ? 1 : 2
      );

      // Create and publish local audio track
      const localAudioTrack = await sdk.createMicrophoneAudioTrack({
        encoderConfig: "music_standard",
        AEC: true,
        ANS: true,
        AGC: true,
      });
      localAudioTrackRef.current = localAudioTrack;
      await rtcClient.publish([localAudioTrack]);

      setCallStatus("connected");
      startDurationTimer();
      toast.success("通話を開始しました");
    } catch (err: unknown) {
      const error = err as Error;
      console.error("[VoiceCall] Failed to start call:", error);
      setCallStatus("error");

      let detail = "通話の開始に失敗しました。";
      if (error.message?.includes("PERMISSION_DENIED") || error.message?.includes("NotAllowed")) {
        detail = "マイクの許可が必要です。ブラウザのアドレスバー左のアイコンからマイクを許可してください。";
      } else if (error.message?.includes("UID_CONFLICT")) {
        detail = "同じチャンネルに既に接続されています。ページを再読み込みしてください。";
      } else if (error.message?.includes("INVALID_VENDOR_KEY") || error.message?.includes("INVALID_TOKEN")) {
        detail = "Agoraのトークンが無効です。ページを再読み込みしてください。";
      } else if (error.message) {
        detail = `エラー: ${error.message}`;
      }
      setErrorDetail(detail);
      toast.error(detail);

      // Cleanup on error
      if (clientRef.current) {
        await clientRef.current.leave().catch(() => {});
        clientRef.current = null;
      }
      if (localAudioTrackRef.current) {
        localAudioTrackRef.current.close();
        localAudioTrackRef.current = null;
      }
    }
  }, [callStatus, channelName, getTokenMutation, loadAgoraSDK, role, startDurationTimer, stopDurationTimer]);

  // End voice call
  const endCall = useCallback(async () => {
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
      setCallStatus("idle");
      setIsMuted(false);
      setRemoteUserCount(0);
      setErrorDetail("");
      stopDurationTimer();
      toast.info("通話を終了しました");
    } catch (error) {
      console.error("[VoiceCall] Failed to end call:", error);
      setCallStatus("idle");
      stopDurationTimer();
    }
  }, [stopDurationTimer]);

  // Toggle mute
  const toggleMute = useCallback(async () => {
    if (!localAudioTrackRef.current) return;
    const newMuted = !isMuted;
    await localAudioTrackRef.current.setMuted(newMuted);
    setIsMuted(newMuted);
    toast.info(newMuted ? "マイクをミュートしました" : "マイクのミュートを解除しました");
  }, [isMuted]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopDurationTimer();
      if (localAudioTrackRef.current) {
        localAudioTrackRef.current.stop();
        localAudioTrackRef.current.close();
      }
      if (clientRef.current) {
        clientRef.current.leave().catch(() => {});
      }
    };
  }, [stopDurationTimer]);

  const isConnected = callStatus === "connected";
  const isConnecting = callStatus === "connecting";
  const isMicCheck = callStatus === "mic_check";
  const isMicOk = callStatus === "mic_ok";
  const isMicDenied = callStatus === "mic_denied";
  const isDisconnected = callStatus === "disconnected";
  const isError = callStatus === "error";

  return (
    <div className="voice-call-panel">
      {/* Status indicator */}
      <div className="flex items-center gap-2 mb-3">
        <div
          className={`w-2.5 h-2.5 rounded-full ${
            isConnected
              ? "bg-green-500 animate-pulse"
              : isConnecting || isMicCheck
              ? "bg-yellow-400 animate-pulse"
              : isError || isMicDenied
              ? "bg-red-500"
              : isMicOk
              ? "bg-blue-400"
              : "bg-gray-300"
          }`}
        />
        <span className="text-sm font-medium" style={{ color: "#6b5b58" }}>
          {isConnected
            ? `通話中 ${formatDuration(callDuration)}`
            : isConnecting
            ? "接続中..."
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
        {isConnected && remoteUserCount > 0 && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">
            相手接続済み
          </span>
        )}
        {isConnected && remoteUserCount === 0 && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700">
            相手の接続待ち
          </span>
        )}
      </div>

      {/* Mic permission check UI */}
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
              <p style={{ fontSize: "13px", color: "#c0392b", fontWeight: 600, marginBottom: "4px" }}>
                マイクへのアクセスが拒否されました
              </p>
              <p style={{ fontSize: "12px", color: "#9e8480", lineHeight: 1.5 }}>
                ブラウザのアドレスバー左端の🔒アイコンをクリックし、マイクを「許可」に変更してからページを再読み込みしてください。
              </p>
            </div>
          </div>
        </div>
      )}

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
            <p style={{ fontSize: "12px", color: "#2e7d32" }}>マイクの確認が完了しました。「通話を開始する」を押してください。</p>
          </div>
        </div>
      )}

      {/* Call controls */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Step 1: Mic check button (idle state) */}
        {callStatus === "idle" && (
          <Button
            onClick={checkMicPermission}
            disabled={!isSessionActive}
            className="voice-call-btn-start"
            size="sm"
          >
            <Mic className="w-4 h-4 mr-1.5" />
            マイクを確認する
          </Button>
        )}

        {/* Mic checking spinner */}
        {isMicCheck && (
          <Button disabled size="sm" variant="outline">
            <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
            確認中...
          </Button>
        )}

        {/* Step 2: Start call button (after mic ok) */}
        {isMicOk && (
          <Button
            onClick={startCall}
            className="voice-call-btn-start"
            size="sm"
          >
            <Phone className="w-4 h-4 mr-1.5" />
            通話を開始する
          </Button>
        )}

        {/* Reconnect button (after mic denied or error) */}
        {(isMicDenied || isError || isDisconnected) && (
          <Button
            onClick={isMicDenied ? checkMicPermission : (isDisconnected ? startCall : checkMicPermission)}
            size="sm"
            variant="outline"
            style={{ borderColor: "#c9a8a3", color: "#6b5b58" }}
          >
            <Phone className="w-4 h-4 mr-1.5" />
            {isMicDenied ? "再度マイクを確認" : isDisconnected ? "再接続する" : "再試行する"}
          </Button>
        )}

        {/* Connecting spinner */}
        {isConnecting && (
          <Button disabled size="sm" variant="outline">
            <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
            接続中...
          </Button>
        )}

        {/* Active call controls */}
        {(isConnected || isConnecting) && (
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

            {isConnected && (
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

      {/* Info notes */}
      {!isSessionActive && callStatus === "idle" && (
        <p className="text-xs mt-2" style={{ color: "#9e8480" }}>
          セッションを開始すると通話ボタンが有効になります
        </p>
      )}
      {isConnected && (
        <p className="text-xs mt-2" style={{ color: "#9e8480" }}>
          チャットも同時に使えます
        </p>
      )}
    </div>
  );
}
