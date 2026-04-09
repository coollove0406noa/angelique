import { useState, useEffect, useRef, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { Mic, MicOff, Phone, PhoneOff, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface VoiceCallProps {
  sessionId: number;
  role: "admin" | "client";
  isSessionActive: boolean;
}

type CallStatus = "idle" | "connecting" | "connected" | "disconnected" | "error";

// Agora RTC SDK is loaded dynamically to avoid SSR issues
let AgoraRTC: typeof import("agora-rtc-sdk-ng").default | null = null;

export default function VoiceCall({ sessionId, role, isSessionActive }: VoiceCallProps) {
  const [callStatus, setCallStatus] = useState<CallStatus>("idle");
  const [isMuted, setIsMuted] = useState(false);
  const [isRemoteMuted, setIsRemoteMuted] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [remoteUserCount, setRemoteUserCount] = useState(0);

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
      AgoraRTC.setLogLevel(4); // Suppress verbose logs
    }
    return AgoraRTC;
  }, []);

  // Start call duration timer
  const startDurationTimer = useCallback(() => {
    callStartTimeRef.current = Date.now();
    durationTimerRef.current = setInterval(() => {
      if (callStartTimeRef.current) {
        setCallDuration(Math.floor((Date.now() - callStartTimeRef.current) / 1000));
      }
    }, 1000);
  }, []);

  // Stop call duration timer
  const stopDurationTimer = useCallback(() => {
    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }
    callStartTimeRef.current = null;
    setCallDuration(0);
  }, []);

  // Format duration as MM:SS
  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  // Start voice call
  const startCall = useCallback(async () => {
    if (callStatus !== "idle" && callStatus !== "disconnected") return;

    setCallStatus("connecting");

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

      rtcClient.on("user-unpublished", (user, mediaType) => {
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
        AEC: true, // Acoustic Echo Cancellation
        ANS: true, // Automatic Noise Suppression
        AGC: true, // Automatic Gain Control
      });
      localAudioTrackRef.current = localAudioTrack;
      await rtcClient.publish([localAudioTrack]);

      setCallStatus("connected");
      startDurationTimer();
      toast.success("通話を開始しました");
    } catch (error) {
      console.error("[VoiceCall] Failed to start call:", error);
      setCallStatus("error");
      toast.error("通話の開始に失敗しました。マイクの許可を確認してください。");

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

  return (
    <div className="voice-call-panel">
      {/* Status indicator */}
      <div className="flex items-center gap-2 mb-3">
        <div
          className={`w-2.5 h-2.5 rounded-full ${
            isConnected
              ? "bg-green-500 animate-pulse"
              : isConnecting
              ? "bg-yellow-400 animate-pulse"
              : callStatus === "error"
              ? "bg-red-500"
              : "bg-gray-300"
          }`}
        />
        <span className="text-sm font-medium" style={{ color: "#6b5b58" }}>
          {isConnected
            ? `通話中 ${formatDuration(callDuration)}`
            : isConnecting
            ? "接続中..."
            : callStatus === "error"
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

      {/* Call controls */}
      <div className="flex items-center gap-2 flex-wrap">
        {!isConnected && !isConnecting && (
          <Button
            onClick={startCall}
            disabled={!isSessionActive || isConnecting}
            className="voice-call-btn-start"
            size="sm"
          >
            <Phone className="w-4 h-4 mr-1.5" />
            通話を開始する
          </Button>
        )}

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

        {callStatus === "error" && (
          <Button
            onClick={startCall}
            size="sm"
            variant="outline"
            className="text-red-600 border-red-300"
          >
            <Phone className="w-4 h-4 mr-1.5" />
            再接続する
          </Button>
        )}
      </div>

      {/* Info note */}
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
