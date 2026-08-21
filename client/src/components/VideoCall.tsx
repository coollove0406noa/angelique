import { useState, useEffect, useRef, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import {
  Mic, MicOff, Video, VideoOff,
  Phone, PhoneOff, AlertCircle, CheckCircle, Loader2, Monitor, Eye, EyeOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

// ─────────────────────────────────────────────────────────────────────────────
// 型定義
// ─────────────────────────────────────────────────────────────────────────────

interface VideoCallProps {
  sessionId: number;
  role: "admin" | "client";
  isSessionActive: boolean;
  onScreenShareChange?: (isSharing: boolean) => void;
  remoteIsScreenSharing?: boolean;
}

type CallStatus =
  | "idle"
  | "cam_check"
  | "cam_ok"
  | "cam_denied"
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

// Agora SDK はグローバルキャッシュ（動的インポート）
let AgoraRTC: typeof import("agora-rtc-sdk-ng").default | null = null;

// ─────────────────────────────────────────────────────────────────────────────
// コンポーネント
// ─────────────────────────────────────────────────────────────────────────────

export default function VideoCall({ sessionId, role, isSessionActive, onScreenShareChange, remoteIsScreenSharing }: VideoCallProps) {
  const [callStatus, setCallStatus] = useState<CallStatus>("idle");
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isPipHidden, setIsPipHidden] = useState(false);
  const [remoteHasVideo, setRemoteHasVideo] = useState(false);
  const [remoteHasAudio, setRemoteHasAudio] = useState(false);
  const [errorDetail, setErrorDetail] = useState("");
  // PiP ドラッグ用オフセット（default: bottom-right コーナー）
  const [pipOffset, setPipOffset] = useState({ x: 0, y: 0 });

  const clientRef = useRef<import("agora-rtc-sdk-ng").IAgoraRTCClient | null>(null);
  const localAudioTrackRef = useRef<import("agora-rtc-sdk-ng").IMicrophoneAudioTrack | null>(null);
  const localVideoTrackRef = useRef<import("agora-rtc-sdk-ng").ICameraVideoTrack | null>(null);
  const screenVideoTrackRef = useRef<import("agora-rtc-sdk-ng").ILocalVideoTrack | null>(null);
  const remoteVideoTrackRef = useRef<import("agora-rtc-sdk-ng").IRemoteVideoTrack | null>(null);

  // 各映像の表示先DOM（callback refで確実にAgora.play()を呼ぶ）
  const remoteVideoContainerRef = useRef<HTMLDivElement | null>(null);
  const localPipContainerRef = useRef<HTMLDivElement | null>(null);

  // PiP ドラッグ管理
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ mouseX: 0, mouseY: 0, pipX: 0, pipY: 0 });

  const getTokenMutation = trpc.agora.getToken.useMutation();
  const channelName = `session-${sessionId}`;
  // admin=1, client=2（VoiceCallと同じUID割り当て、ビデオ専用チャンネルではないため）
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

  // ── remoteVideo callback ref（DOMマウント時に即play）─────────────────────
  const remoteVideoCallbackRef = useCallback((el: HTMLDivElement | null) => {
    remoteVideoContainerRef.current = el;
    if (el && remoteVideoTrackRef.current) {
      remoteVideoTrackRef.current.play(el);
    }
  }, []);

  // ── localPiP callback ref（DOMマウント時に即play）────────────────────────
  const localPipCallbackRef = useCallback((el: HTMLDivElement | null) => {
    localPipContainerRef.current = el;
    if (el && localVideoTrackRef.current && !isCameraOff) {
      localVideoTrackRef.current.play(el);
    }
  }, [isCameraOff]);

  // ── イベントリスナー登録 ──────────────────────────────────────────────────
  const setupClientEvents = useCallback(
    (rtcClient: import("agora-rtc-sdk-ng").IAgoraRTCClient) => {
      rtcClient.on("user-published", async (user, mediaType) => {
        await rtcClient.subscribe(user, mediaType);

        if (mediaType === "audio" && user.audioTrack) {
          user.audioTrack.play();
          setRemoteHasAudio(true);
          toast.success(
            role === "admin" ? "お客様が通話に参加しました" : "占い師が通話に参加しました"
          );
        }

        if (mediaType === "video" && user.videoTrack) {
          remoteVideoTrackRef.current = user.videoTrack;
          setRemoteHasVideo(true);
          // DOM がすでにある場合はここで play
          if (remoteVideoContainerRef.current) {
            user.videoTrack.play(remoteVideoContainerRef.current);
          }
        }
      });

      rtcClient.on("user-unpublished", (_user, mediaType) => {
        if (mediaType === "video") {
          remoteVideoTrackRef.current = null;
          setRemoteHasVideo(false);
        }
        if (mediaType === "audio") {
          setRemoteHasAudio(false);
        }
      });

      rtcClient.on("user-left", () => {
        remoteVideoTrackRef.current = null;
        setRemoteHasVideo(false);
        setRemoteHasAudio(false);
        toast.info(
          role === "admin" ? "お客様が通話を終了しました" : "占い師が通話を終了しました"
        );
      });

      rtcClient.on("connection-state-change", (curState) => {
        if (curState === "DISCONNECTED") {
          setCallStatus("disconnected");
          toast.warning("通話が切断されました。再接続ボタンを押してください。");
        }
      });
    },
    [role]
  );

  // ── STEP 1: カメラ・マイク権限確認 ──────────────────────────────────────
  const checkPermissions = useCallback(async () => {
    setCallStatus("cam_check");
    setErrorDetail("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true,
      });
      stream.getTracks().forEach((t) => t.stop());
      setCallStatus("cam_ok");
    } catch (err: unknown) {
      const error = err as Error;
      if (
        error.name === "NotAllowedError" ||
        error.name === "PermissionDeniedError"
      ) {
        setCallStatus("cam_denied");
        setErrorDetail(
          "カメラ・マイクへのアクセスが拒否されました。ブラウザの設定から許可してください。"
        );
      } else if (
        error.name === "NotFoundError" ||
        error.name === "DevicesNotFoundError"
      ) {
        setCallStatus("error");
        setErrorDetail(
          "カメラまたはマイクが見つかりません。接続を確認してください。"
        );
      } else {
        setCallStatus("error");
        setErrorDetail(`デバイス確認中にエラーが発生しました: ${error.message}`);
      }
    }
  }, []);

  // ── STEP 2: ビデオ通話開始 ───────────────────────────────────────────────
  const startCall = useCallback(async () => {
    if (
      callStatus !== "cam_ok" &&
      callStatus !== "disconnected" &&
      callStatus !== "error"
    )
      return;

    setCallStatus("connecting");
    setErrorDetail("");

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

      await rtcClient.join(
        tokenData.appId,
        channelName,
        tokenData.token ?? null,
        uid
      );

      // マイクトラック
      const localAudioTrack = await sdk.createMicrophoneAudioTrack({
        encoderConfig: { sampleRate: 48000, stereo: false, bitrate: 128 },
        AEC: true,
        ANS: false,
        AGC: false,
      });
      localAudioTrack.setVolume(200);
      localAudioTrackRef.current = localAudioTrack;

      // カメラトラック（SD画質）
      const localVideoTrack = await sdk.createCameraVideoTrack({
        encoderConfig: "480p_1",
      });
      localVideoTrackRef.current = localVideoTrack;

      // ローカルプレビュー（PiP）
      if (localPipContainerRef.current) {
        localVideoTrack.play(localPipContainerRef.current);
      }

      // チャンネルに公開
      await rtcClient.publish([localAudioTrack, localVideoTrack]);

      setCallStatus("connected");
      toast.success("ビデオ通話を開始しました");
    } catch (err: unknown) {
      const error = err as Error;
      console.error("[VideoCall] startCall error:", error);
      setCallStatus("error");

      let detail = "ビデオ通話の開始に失敗しました。";
      if (
        error.message?.includes("PERMISSION_DENIED") ||
        error.message?.includes("NotAllowed")
      ) {
        detail =
          "カメラ・マイクの許可が必要です。ブラウザのアドレスバーから許可してください。";
      } else if (error.message?.includes("UID_CONFLICT")) {
        detail =
          "同じチャンネルに既に接続されています。ページを再読み込みしてください。";
      } else if (error.message) {
        detail = `エラー: ${error.message}`;
      }
      setErrorDetail(detail);
      toast.error(detail);

      // クリーンアップ
      localAudioTrackRef.current?.close();
      localAudioTrackRef.current = null;
      localVideoTrackRef.current?.stop();
      localVideoTrackRef.current?.close();
      localVideoTrackRef.current = null;
      if (clientRef.current) {
        await clientRef.current.leave().catch(() => {});
        clientRef.current = null;
      }
    }
  }, [
    callStatus,
    channelName,
    getTokenMutation,
    loadAgoraSDK,
    setupClientEvents,
    uid,
  ]);

  // ── 通話終了 ──────────────────────────────────────────────────────────────
  const endCall = useCallback(async () => {
    screenVideoTrackRef.current?.stop();
    screenVideoTrackRef.current?.close();
    screenVideoTrackRef.current = null;

    localAudioTrackRef.current?.stop();
    localAudioTrackRef.current?.close();
    localAudioTrackRef.current = null;

    localVideoTrackRef.current?.stop();
    localVideoTrackRef.current?.close();
    localVideoTrackRef.current = null;

    if (clientRef.current) {
      await clientRef.current.leave().catch(() => {});
      clientRef.current = null;
    }

    remoteVideoTrackRef.current = null;
    setCallStatus("idle");
    setIsMuted(false);
    setIsCameraOff(false);
    setIsScreenSharing(false);
    setIsPipHidden(false);
    setRemoteHasVideo(false);
    setRemoteHasAudio(false);
    setPipOffset({ x: 0, y: 0 });
    onScreenShareChange?.(false);
    toast.info("ビデオ通話を終了しました");
  }, [onScreenShareChange]);

  // ── 画面共有停止（内部共通処理）────────────────────────────────────────
  const stopScreenShare = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    const screenTrack = screenVideoTrackRef.current;
    if (screenTrack) {
      await client.unpublish(screenTrack).catch(() => {});
      screenTrack.stop();
      screenTrack.close();
      screenVideoTrackRef.current = null;
    }
    // カメラトラックを再publish
    if (localVideoTrackRef.current) {
      await client.publish(localVideoTrackRef.current).catch(() => {});
      if (localPipContainerRef.current && !isCameraOff) {
        localVideoTrackRef.current.play(localPipContainerRef.current);
      }
    }
    setIsScreenSharing(false);
    onScreenShareChange?.(false);
  }, [isCameraOff, onScreenShareChange]);

  // ── 画面共有開始・停止トグル ──────────────────────────────────────────
  const toggleScreenShare = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;

    if (isScreenSharing) {
      await stopScreenShare();
      return;
    }

    try {
      const sdk = AgoraRTC;
      if (!sdk) return;

      const screenTrack = await sdk.createScreenVideoTrack(
        { encoderConfig: "1080p_1" },
        "disable"
      );
      // createScreenVideoTrack は単体トラックを返すが型が配列になることもある
      const track = Array.isArray(screenTrack) ? screenTrack[0] : screenTrack;
      screenVideoTrackRef.current = track;

      // カメラトラックをunpublishして画面共有をpublish
      if (localVideoTrackRef.current) {
        await client.unpublish(localVideoTrackRef.current).catch(() => {});
      }
      await client.publish(track);

      // ブラウザの「共有を停止」ボタンで停止したときの自動対応
      track.on("track-ended", () => {
        stopScreenShare();
        toast.info("画面共有を停止しました");
      });

      setIsScreenSharing(true);
      onScreenShareChange?.(true);
      toast.success("画面共有を開始しました");
    } catch (err: unknown) {
      const error = err as Error;
      // ユーザーがキャンセルした場合は何もしない
      if (error.name === "NotAllowedError" || error.message?.includes("cancel")) return;
      toast.error("画面共有を開始できませんでした");
      // カメラトラックに戻す
      if (localVideoTrackRef.current && client) {
        await client.publish(localVideoTrackRef.current).catch(() => {});
      }
    }
  }, [isScreenSharing, stopScreenShare, onScreenShareChange]);

  // ── ミュート切り替え ──────────────────────────────────────────────────────
  const toggleMute = useCallback(async () => {
    if (!localAudioTrackRef.current) return;
    const newMuted = !isMuted;
    await localAudioTrackRef.current.setMuted(newMuted);
    setIsMuted(newMuted);
    toast.info(newMuted ? "マイクをミュートしました" : "マイクのミュートを解除しました");
  }, [isMuted]);

  // ── カメラ ON/OFF ─────────────────────────────────────────────────────────
  const toggleCamera = useCallback(async () => {
    if (!localVideoTrackRef.current) return;
    const newOff = !isCameraOff;
    await localVideoTrackRef.current.setMuted(newOff);
    setIsCameraOff(newOff);
    if (!newOff && localPipContainerRef.current) {
      localVideoTrackRef.current.play(localPipContainerRef.current);
    }
    toast.info(newOff ? "カメラをOFFにしました" : "カメラをONにしました");
  }, [isCameraOff]);

  // ── PiP ドラッグ（マウス）────────────────────────────────────────────────
  const handlePipMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDraggingRef.current = true;
      dragStartRef.current = {
        mouseX: e.clientX,
        mouseY: e.clientY,
        pipX: pipOffset.x,
        pipY: pipOffset.y,
      };

      const onMove = (me: MouseEvent) => {
        if (!isDraggingRef.current) return;
        setPipOffset({
          x: dragStartRef.current.pipX + (me.clientX - dragStartRef.current.mouseX),
          y: dragStartRef.current.pipY + (me.clientY - dragStartRef.current.mouseY),
        });
      };
      const onUp = () => {
        isDraggingRef.current = false;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [pipOffset]
  );

  // ── PiP ドラッグ（タッチ）───────────────────────────────────────────────
  const handlePipTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0];
      isDraggingRef.current = true;
      dragStartRef.current = {
        mouseX: touch.clientX,
        mouseY: touch.clientY,
        pipX: pipOffset.x,
        pipY: pipOffset.y,
      };

      const onMove = (te: TouchEvent) => {
        if (!isDraggingRef.current) return;
        const t = te.touches[0];
        setPipOffset({
          x: dragStartRef.current.pipX + (t.clientX - dragStartRef.current.mouseX),
          y: dragStartRef.current.pipY + (t.clientY - dragStartRef.current.mouseY),
        });
      };
      const onEnd = () => {
        isDraggingRef.current = false;
        window.removeEventListener("touchmove", onMove);
        window.removeEventListener("touchend", onEnd);
      };
      window.addEventListener("touchmove", onMove);
      window.addEventListener("touchend", onEnd);
    },
    [pipOffset]
  );

  // ── アンマウント時クリーンアップ ─────────────────────────────────────────
  useEffect(() => {
    return () => {
      screenVideoTrackRef.current?.stop();
      screenVideoTrackRef.current?.close();
      localAudioTrackRef.current?.stop();
      localAudioTrackRef.current?.close();
      localVideoTrackRef.current?.stop();
      localVideoTrackRef.current?.close();
      clientRef.current?.leave().catch(() => {});
    };
  }, []);

  // ── 派生状態 ─────────────────────────────────────────────────────────────
  const isConnected    = callStatus === "connected";
  const isConnecting   = callStatus === "connecting";
  const isCamCheck     = callStatus === "cam_check";
  const isCamOk        = callStatus === "cam_ok";
  const isCamDenied    = callStatus === "cam_denied";
  const isDisconnected = callStatus === "disconnected";
  const isError        = callStatus === "error";

  // ─────────────────────────────────────────────────────────────────────────
  // レンダリング
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="voice-call-panel">
      {/* ── ステータスインジケーター ─────────────────────────────── */}
      <div className="flex items-center gap-2 mb-3">
        <div
          className={`w-2.5 h-2.5 rounded-full ${
            isConnected && isSessionActive
              ? "bg-green-500 animate-pulse"
              : isConnecting || isCamCheck
              ? "bg-yellow-400 animate-pulse"
              : isError || isCamDenied
              ? "bg-red-500"
              : isCamOk
              ? "bg-blue-400"
              : "bg-gray-300"
          }`}
        />
        <span className="text-sm font-medium" style={{ color: "#6b5b58" }}>
          {isConnected && isSessionActive
            ? isScreenSharing
              ? "画面共有中"
              : remoteIsScreenSharing
              ? "画面共有中（相手）"
              : "ビデオ通話中"
            : isConnecting
            ? "接続中..."
            : isCamCheck
            ? "カメラ確認中..."
            : isCamOk
            ? "カメラ確認OK"
            : isCamDenied
            ? "カメラ・マイク許可が必要"
            : isDisconnected
            ? "通話が切断されました"
            : isError
            ? "接続エラー"
            : "ビデオ通話"}
        </span>
        {isConnected && isSessionActive && remoteHasVideo && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">
            相手接続済み
          </span>
        )}
        {isConnected && isSessionActive && !remoteHasVideo && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700">
            相手待ち
          </span>
        )}
      </div>

      {/* ── カメラ映像エリア（接続後に表示）──────────────────────── */}
      {isConnected && (
        <div
          className="vc-video-area"
          style={{
            position: "relative",
            width: "100%",
            aspectRatio: "16 / 9",
            background: "#111",
            borderRadius: "10px",
            overflow: "hidden",
            marginBottom: "10px",
            border: "1px solid #333",
          }}
        >
          {/* リモート映像（メイン） */}
          {remoteHasVideo ? (
            <div
              ref={remoteVideoCallbackRef}
              className="vc-remote-video"
              style={{ width: "100%", height: "100%" }}
            />
          ) : (
            <div
              style={{
                width: "100%",
                height: "100%",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                color: "#666",
                gap: "6px",
              }}
            >
              <VideoOff className="w-8 h-8" />
              <span style={{ fontSize: "12px" }}>カメラOFF</span>
            </div>
          )}

          {/* ローカル映像（PiP・ドラッグ可能）*/}
          <div
            className="vc-pip-container"
            style={{
              position: "absolute",
              bottom: `${8 - pipOffset.y}px`,
              right: `${8 - pipOffset.x}px`,
              background: "#222",
              borderRadius: "6px",
              border: "2px solid rgba(255,255,255,0.8)",
              overflow: "hidden",
              cursor: isDraggingRef.current ? "grabbing" : "grab",
              zIndex: 10,
              boxShadow: "0 2px 8px rgba(0,0,0,0.5)",
              display: isPipHidden ? "none" : undefined,
            }}
            onMouseDown={handlePipMouseDown}
            onTouchStart={handlePipTouchStart}
          >
            {!isCameraOff ? (
              <div
                ref={localPipCallbackRef}
                className="vc-pip-video"
                style={{ width: "100%", height: "100%" }}
              />
            ) : (
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#666",
                }}
              >
                <VideoOff className="w-4 h-4" />
              </div>
            )}
          </div>

          {/* セッション未開始の暗転オーバーレイ */}
          {!isSessionActive && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "rgba(0,0,0,0.5)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: "10px",
              }}
            >
              <span style={{ fontSize: "12px", color: "#ccc" }}>
                セッション開始後に映像が表示されます
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── 権限拒否ガイド ───────────────────────────────────────── */}
      {isCamDenied && (
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
              <p
                style={{
                  fontSize: "13px",
                  color: "#c0392b",
                  fontWeight: 600,
                  marginBottom: "6px",
                }}
              >
                カメラ・マイクへのアクセスが拒否されました
              </p>
              <ol
                style={{
                  fontSize: "12px",
                  color: "#9e8480",
                  lineHeight: 1.7,
                  paddingLeft: "16px",
                  margin: 0,
                }}
              >
                <li>ブラウザのアドレスバー左端の 🔒 アイコンをクリック</li>
                <li>「カメラ」と「マイク」を <strong>許可</strong> に変更</li>
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
            <p style={{ fontSize: "12px", color: "#9e8480", lineHeight: 1.5 }}>
              {errorDetail}
            </p>
          </div>
        </div>
      )}

      {/* ── カメラOK通知 ─────────────────────────────────────────── */}
      {isCamOk && (
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
              カメラ・マイクの確認が完了しました。「ビデオ通話を開始する」を押してください。
            </p>
          </div>
        </div>
      )}

      {/* ── コントロールボタン ───────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* カメラ確認ボタン */}
        {callStatus === "idle" && (
          <Button
            onClick={checkPermissions}
            disabled={!isSessionActive}
            className="voice-call-btn-start"
            size="sm"
          >
            <Video className="w-4 h-4 mr-1.5" />
            カメラを確認する
          </Button>
        )}

        {/* カメラ確認中スピナー */}
        {isCamCheck && (
          <Button disabled size="sm" variant="outline">
            <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
            確認中...
          </Button>
        )}

        {/* カメラOK → 通話開始ボタン */}
        {isCamOk && (
          <Button onClick={startCall} className="voice-call-btn-start" size="sm">
            <Phone className="w-4 h-4 mr-1.5" />
            ビデオ通話を開始する
          </Button>
        )}

        {/* 再試行ボタン */}
        {(isCamDenied || isError || isDisconnected) && (
          <Button
            onClick={isCamDenied || isError ? checkPermissions : startCall}
            size="sm"
            variant="outline"
            style={{ borderColor: "#c9a8a3", color: "#6b5b58" }}
          >
            <Video className="w-4 h-4 mr-1.5" />
            {isDisconnected ? "再接続する" : "再試行する"}
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
        {isConnected && isSessionActive && (
          <>
            {/* 通話終了 */}
            <Button
              onClick={endCall}
              variant="destructive"
              size="sm"
              className="voice-call-btn-end"
            >
              <PhoneOff className="w-4 h-4 mr-1.5" />
              通話終了
            </Button>

            {/* ミュート */}
            <Button
              onClick={toggleMute}
              variant="outline"
              size="sm"
              className={`voice-call-btn-mute ${isMuted ? "muted" : ""}`}
              title={isMuted ? "マイクON" : "マイクOFF"}
            >
              {isMuted ? (
                <MicOff className="w-4 h-4" />
              ) : (
                <Mic className="w-4 h-4" />
              )}
            </Button>

            {/* カメラ ON/OFF */}
            <Button
              onClick={toggleCamera}
              variant="outline"
              size="sm"
              style={
                isCameraOff
                  ? { borderColor: "#e57373", color: "#c62828" }
                  : { borderColor: "#c9a8a3", color: "#6b5b58" }
              }
              title={isCameraOff ? "カメラON" : "カメラOFF"}
            >
              {isCameraOff ? (
                <VideoOff className="w-4 h-4" />
              ) : (
                <Video className="w-4 h-4" />
              )}
            </Button>

            {/* 画面共有ボタン（PCのみ） */}
            <Button
              onClick={toggleScreenShare}
              variant="outline"
              size="sm"
              className="vc-screen-share-btn"
              style={
                isScreenSharing
                  ? { borderColor: "#5c6bc0", color: "#3949ab", background: "#e8eaf6" }
                  : { borderColor: "#c9a8a3", color: "#6b5b58" }
              }
              title={isScreenSharing ? "画面共有を停止" : "画面共有を開始"}
            >
              <Monitor className="w-4 h-4" />
            </Button>

            {/* 自分を隠すボタン */}
            <Button
              onClick={() => setIsPipHidden((v) => !v)}
              variant="outline"
              size="sm"
              style={
                isPipHidden
                  ? { borderColor: "#9e8480", color: "#9e8480", background: "#f3eeee" }
                  : { borderColor: "#c9a8a3", color: "#6b5b58" }
              }
              title={isPipHidden ? "自分の映像を表示" : "自分の映像を非表示"}
            >
              {isPipHidden ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </Button>

          </>
        )}
      </div>

      {/* ── 補足テキスト ─────────────────────────────────────────── */}
      {!isSessionActive && callStatus === "idle" && (
        <p className="text-xs mt-2" style={{ color: "#9e8480" }}>
          セッションを開始するとカメラボタンが有効になります
        </p>
      )}
      {isConnected && isSessionActive && (
        <p className="text-xs mt-2" style={{ color: "#9e8480" }}>
          小さい映像（右下）はドラッグで移動できます
        </p>
      )}

      {/* Agora が注入する <video> に object-fit: cover + レスポンシブサイズ + PiP サイズ */}
      <style>{`
        /* 画面共有ボタンはスマホで非表示 */
        .vc-screen-share-btn {
          display: inline-flex;
        }
        @media (max-width: 767px) {
          .vc-screen-share-btn {
            display: none;
          }
        }
        /* PC: aspect-ratio 維持のまま最大 300px 高に制限し中央寄せ */
        @media (min-width: 768px) {
          .vc-video-area {
            max-width: calc(300px * 16 / 9);
            max-height: 300px;
            margin: 0 auto;
          }
        }
        /* PiP サイズ：PC 160×120px、スマホ 120×90px */
        .vc-pip-container {
          width: 160px;
          height: 120px;
        }
        @media (max-width: 767px) {
          .vc-pip-container {
            width: 120px;
            height: 90px;
          }
        }
        .vc-remote-video video,
        .vc-remote-video > div {
          object-fit: cover !important;
          width: 100% !important;
          height: 100% !important;
        }
        .vc-pip-video video,
        .vc-pip-video > div {
          object-fit: cover !important;
          width: 100% !important;
          height: 100% !important;
        }
      `}</style>
    </div>
  );
}
