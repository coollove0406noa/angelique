/**
 * MicTest — マイクモニタリングテスト
 * ボタンを押すと自分の声がスピーカーから聞こえる（ループバック）。
 * 5秒後に自動停止。
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { Mic, MicOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type TestStatus = "idle" | "requesting" | "monitoring" | "done" | "error";

export function MicTest() {
  const [status, setStatus] = useState<TestStatus>("idle");
  const [countdown, setCountdown] = useState(5);
  const [errorMsg, setErrorMsg] = useState("");

  const streamRef    = useRef<MediaStream | null>(null);
  const audioCtxRef  = useRef<AudioContext | null>(null);
  const intervalRef  = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTest = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    // AudioContext を閉じる（ループバックを停止）
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    // マイクストリームを停止
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCountdown(5);
  }, []);

  const startTest = useCallback(async () => {
    setStatus("requesting");
    setErrorMsg("");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      streamRef.current = stream;

      // AudioContext でループバック（マイク → スピーカー）
      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(audioCtx.destination); // スピーカーに直接出力

      setStatus("monitoring");
      setCountdown(5);

      let count = 5;
      intervalRef.current = setInterval(() => {
        count -= 1;
        setCountdown(count);
        if (count <= 0) {
          clearInterval(intervalRef.current!);
          intervalRef.current = null;
          stopTest();
          setStatus("done");
          toast.success("マイクテスト完了");
        }
      }, 1000);
    } catch (err: unknown) {
      const error = err as Error;
      stopTest();
      if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
        setErrorMsg("マイクの許可が必要です。ブラウザでマイクを許可してください。");
      } else if (error.name === "NotFoundError") {
        setErrorMsg("マイクが見つかりません。接続を確認してください。");
      } else {
        setErrorMsg(`エラー: ${error.message}`);
      }
      setStatus("error");
    }
  }, [stopTest]);

  // アンマウント時クリーンアップ
  useEffect(() => {
    return () => stopTest();
  }, [stopTest]);

  return (
    <div
      style={{
        background: "#faf8f7",
        border: "1px solid #e8e0dd",
        borderRadius: "10px",
        padding: "12px 14px",
      }}
    >
      <p style={{ fontSize: "12px", color: "#9e8480", fontWeight: 600, marginBottom: "8px" }}>
        🎤 マイクテスト（自分の声を確認）
      </p>

      {status === "idle" || status === "done" || status === "error" ? (
        <>
          <Button
            onClick={startTest}
            size="sm"
            variant="outline"
            style={{ borderColor: "#c9a8a3", color: "#6b5b58", fontSize: "12px" }}
          >
            <Mic className="w-3.5 h-3.5 mr-1.5" />
            {status === "done" ? "もう一度テストする" : "マイクをテストする"}
          </Button>
          {status === "done" && (
            <p style={{ fontSize: "11px", color: "#4caf7d", marginTop: "6px" }}>
              ✓ テスト完了
            </p>
          )}
          {status === "error" && errorMsg && (
            <p style={{ fontSize: "11px", color: "#c0392b", marginTop: "6px" }}>{errorMsg}</p>
          )}
        </>
      ) : status === "requesting" ? (
        <Button disabled size="sm" variant="outline">
          <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
          マイク確認中…
        </Button>
      ) : (
        /* monitoring */
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <Button
            onClick={() => { stopTest(); setStatus("idle"); }}
            size="sm"
            variant="outline"
            style={{ borderColor: "#f5c6c6", color: "#c0392b", fontSize: "12px" }}
          >
            <MicOff className="w-3.5 h-3.5 mr-1.5" />
            停止
          </Button>
          <span
            style={{
              fontSize: "12px",
              color: "#6b5b58",
              background: "#fff3f3",
              borderRadius: "6px",
              padding: "3px 10px",
              fontWeight: 600,
            }}
          >
            テスト中… {countdown}秒
          </span>
          <span style={{ fontSize: "11px", color: "#9e8480" }}>
            自分の声が聞こえますか？
          </span>
        </div>
      )}
    </div>
  );
}
