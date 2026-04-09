import { useEffect, useRef, useState, useCallback } from "react";

// ── タロットカードデータ（大アルカナ22枚）──────────────────────────────────
const TAROT_CARDS = [
  { name: "愚者", meaning: "新しい始まり・自由・冒険への一歩" },
  { name: "魔術師", meaning: "意志の力・創造性・新しいスキル" },
  { name: "女教皇", meaning: "直感・内なる知恵・神秘" },
  { name: "女帝", meaning: "豊かさ・母性・自然の恵み" },
  { name: "皇帝", meaning: "安定・権威・しっかりとした基盤" },
  { name: "教皇", meaning: "伝統・精神的な導き・信頼" },
  { name: "恋人たち", meaning: "愛・選択・調和" },
  { name: "戦車", meaning: "勝利・意志の強さ・前進" },
  { name: "力", meaning: "内なる強さ・勇気・忍耐" },
  { name: "隠者", meaning: "内省・孤独の時間・真実の探求" },
  { name: "運命の輪", meaning: "変化・サイクル・運命の転換点" },
  { name: "正義", meaning: "公平・バランス・真実" },
  { name: "吊るされた男", meaning: "手放す・新しい視点・待つ時間" },
  { name: "死神", meaning: "変容・終わりと始まり・再生" },
  { name: "節制", meaning: "調和・バランス・穏やかな流れ" },
  { name: "悪魔", meaning: "束縛からの解放・欲望・影の部分" },
  { name: "塔", meaning: "突然の変化・古いものの崩壊・解放" },
  { name: "星", meaning: "希望・癒し・未来への光" },
  { name: "月", meaning: "無意識・夢・隠れた真実" },
  { name: "太陽", meaning: "喜び・成功・輝かしいエネルギー" },
  { name: "審判", meaning: "覚醒・再生・新しい使命" },
  { name: "世界", meaning: "完成・達成・新たなサイクルの始まり" },
];

// タロットカードの絵文字シンボル（カードの雰囲気を表現）
const CARD_SYMBOLS = [
  "🌟", "✨", "🌙", "⭐", "💫", "🔮", "🌸", "🌺",
  "🦋", "🌈", "💎", "🌿", "🕊️", "🌊", "🔥", "🌙",
  "☀️", "🌙", "⚡", "🌺", "🔔", "🌍",
];

interface WaitingRoomProps {
  sessionType: "chat" | "voice";
  onSessionStarted?: () => void;
  bgmUrl?: string; // MP3のURL（後でアップロード後に設定）
}

export function WaitingRoom({ sessionType, onSessionStarted, bgmUrl }: WaitingRoomProps) {
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [opacity, setOpacity] = useState(1);
  const [isBgmPlaying, setIsBgmPlaying] = useState(false);
  const [bgmError, setBgmError] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // ── マイクテスト（音声鑑定のみ）────────────────────────────────────────
  const [micStatus, setMicStatus] = useState<"idle" | "testing" | "ok" | "error">("idle");
  const [micVolume, setMicVolume] = useState(0);
  const micStreamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // ── タロットカードのフェードイン・アウト ──────────────────────────────
  useEffect(() => {
    const DISPLAY_DURATION = 4000; // 4秒表示
    const FADE_DURATION = 800; // 0.8秒フェード

    let fadeOutTimer: ReturnType<typeof setTimeout>;
    let nextCardTimer: ReturnType<typeof setTimeout>;

    const startCycle = () => {
      // フェードアウト開始
      fadeOutTimer = setTimeout(() => {
        setOpacity(0);
        // フェードアウト完了後に次のカードへ
        nextCardTimer = setTimeout(() => {
          setCurrentCardIndex((prev) => (prev + 1) % TAROT_CARDS.length);
          setOpacity(1);
        }, FADE_DURATION);
      }, DISPLAY_DURATION);
    };

    startCycle();
    return () => {
      clearTimeout(fadeOutTimer);
      clearTimeout(nextCardTimer);
    };
  }, [currentCardIndex]);

  // ── BGM再生 ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!bgmUrl) return;
    const audio = new Audio(bgmUrl);
    audio.loop = true;
    audio.volume = 0.25;
    audioRef.current = audio;

    const tryPlay = async () => {
      try {
        await audio.play();
        setIsBgmPlaying(true);
      } catch {
        setBgmError(false); // 自動再生ブロックは静かに無視
      }
    };
    tryPlay();

    return () => {
      audio.pause();
      audio.src = "";
    };
  }, [bgmUrl]);

  const toggleBgm = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || !bgmUrl) return;
    if (isBgmPlaying) {
      audio.pause();
      setIsBgmPlaying(false);
    } else {
      try {
        await audio.play();
        setIsBgmPlaying(true);
      } catch {
        setBgmError(true);
      }
    }
  }, [isBgmPlaying, bgmUrl]);

  // ── マイクテスト ─────────────────────────────────────────────────────
  const startMicTest = useCallback(async () => {
    setMicStatus("testing");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      micStreamRef.current = stream;

      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      let maxVolume = 0;
      let frames = 0;

      const measure = () => {
        analyser.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        const normalized = Math.min(100, (avg / 128) * 100);
        setMicVolume(normalized);
        if (normalized > maxVolume) maxVolume = normalized;
        frames++;

        if (frames < 120) {
          // 約2秒間測定
          animFrameRef.current = requestAnimationFrame(measure);
        } else {
          // 測定完了
          setMicStatus(maxVolume > 2 ? "ok" : "error");
          setMicVolume(0);
          stream.getTracks().forEach((t) => t.stop());
          audioCtx.close();
        }
      };
      animFrameRef.current = requestAnimationFrame(measure);
    } catch {
      setMicStatus("error");
    }
  }, []);

  useEffect(() => {
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const card = TAROT_CARDS[currentCardIndex];
  const symbol = CARD_SYMBOLS[currentCardIndex];

  return (
    <div className="waiting-room-container">
      {/* 背景の星エフェクト */}
      <div className="stars-bg" aria-hidden="true">
        {Array.from({ length: 20 }).map((_, i) => (
          <span
            key={i}
            className="star-dot"
            style={{
              left: `${(i * 37 + 13) % 100}%`,
              top: `${(i * 53 + 7) % 100}%`,
              animationDelay: `${(i * 0.3) % 3}s`,
              fontSize: `${8 + (i % 4) * 4}px`,
              opacity: 0.3 + (i % 5) * 0.1,
            }}
          >
            ✦
          </span>
        ))}
      </div>

      {/* メインコンテンツ */}
      <div className="waiting-content">
        {/* ロゴ */}
        <div className="waiting-logo">
          <span className="logo-star">✦</span>
          <span className="logo-text">angelique</span>
        </div>

        {/* タロットカード表示 */}
        <div
          className="tarot-card-display"
          style={{
            opacity,
            transition: "opacity 0.8s ease-in-out",
          }}
        >
          <div className="tarot-symbol">{symbol}</div>
          <div className="tarot-card-name">{card.name}</div>
          <div className="tarot-card-meaning">{card.meaning}</div>
        </div>

        {/* 待機メッセージ */}
        <div className="waiting-message">
          <div className="waiting-dots">
            <span>占い師の準備ができるまでお待ちください</span>
            <span className="dot-anim">...</span>
          </div>
        </div>

        {/* BGMコントロール（bgmUrlが設定されている場合のみ） */}
        {bgmUrl && (
          <button
            onClick={toggleBgm}
            className="bgm-toggle-btn"
            aria-label={isBgmPlaying ? "BGMを停止" : "BGMを再生"}
          >
            {isBgmPlaying ? "🔊 BGM ON" : "🔇 BGM OFF"}
          </button>
        )}

        {/* 音声鑑定のみ：マイクテスト */}
        {sessionType === "voice" && (
          <div className="mic-test-panel">
            <div className="mic-test-title">🎤 マイクテスト</div>
            {micStatus === "idle" && (
              <button onClick={startMicTest} className="mic-test-btn">
                マイクをテストする
              </button>
            )}
            {micStatus === "testing" && (
              <div className="mic-testing">
                <div className="mic-volume-bar">
                  <div
                    className="mic-volume-fill"
                    style={{ width: `${micVolume}%` }}
                  />
                </div>
                <p className="mic-testing-text">マイクの音量を測定中...</p>
              </div>
            )}
            {micStatus === "ok" && (
              <div className="mic-ok">
                <span className="mic-ok-icon">✓</span>
                <span>マイクが正常に動作しています</span>
              </div>
            )}
            {micStatus === "error" && (
              <div className="mic-error">
                <span>⚠ マイクが検出できませんでした</span>
                <button onClick={startMicTest} className="mic-retry-btn">
                  再試行
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <style>{`
        .waiting-room-container {
          position: fixed;
          inset: 0;
          background: linear-gradient(135deg, #1a0a2e 0%, #2d1b4e 40%, #1a0a2e 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 50;
          overflow: hidden;
        }
        .stars-bg {
          position: absolute;
          inset: 0;
          pointer-events: none;
        }
        .star-dot {
          position: absolute;
          color: #c9a8a3;
          animation: twinkle 3s ease-in-out infinite;
        }
        @keyframes twinkle {
          0%, 100% { opacity: 0.2; transform: scale(1); }
          50% { opacity: 0.8; transform: scale(1.3); }
        }
        .waiting-content {
          position: relative;
          z-index: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 1.5rem;
          padding: 2rem 1.5rem;
          max-width: 420px;
          width: 100%;
          text-align: center;
        }
        .waiting-logo {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-bottom: 0.5rem;
        }
        .logo-star {
          color: #c9a8a3;
          font-size: 1.5rem;
        }
        .logo-text {
          font-family: 'Cormorant Garamond', serif;
          font-size: 1.8rem;
          color: #e8d5d0;
          letter-spacing: 0.15em;
        }
        .tarot-card-display {
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(201, 168, 163, 0.3);
          border-radius: 1.5rem;
          padding: 2rem 2.5rem;
          width: 100%;
          backdrop-filter: blur(10px);
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        }
        .tarot-symbol {
          font-size: 3.5rem;
          margin-bottom: 0.75rem;
          display: block;
        }
        .tarot-card-name {
          font-family: 'Cormorant Garamond', serif;
          font-size: 1.6rem;
          color: #e8d5d0;
          font-weight: 600;
          margin-bottom: 0.5rem;
          letter-spacing: 0.1em;
        }
        .tarot-card-meaning {
          font-family: 'Noto Sans JP', sans-serif;
          font-size: 0.875rem;
          color: #c9a8a3;
          line-height: 1.6;
        }
        .waiting-message {
          color: #e8d5d0;
          font-family: 'Noto Sans JP', sans-serif;
          font-size: 0.9rem;
          letter-spacing: 0.05em;
        }
        .waiting-dots {
          display: flex;
          align-items: center;
          gap: 0.25rem;
          justify-content: center;
        }
        .dot-anim {
          animation: dotPulse 1.5s ease-in-out infinite;
        }
        @keyframes dotPulse {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 1; }
        }
        .bgm-toggle-btn {
          background: rgba(201, 168, 163, 0.15);
          border: 1px solid rgba(201, 168, 163, 0.4);
          color: #c9a8a3;
          border-radius: 2rem;
          padding: 0.4rem 1rem;
          font-size: 0.8rem;
          cursor: pointer;
          transition: all 0.2s;
          font-family: 'Noto Sans JP', sans-serif;
        }
        .bgm-toggle-btn:hover {
          background: rgba(201, 168, 163, 0.25);
        }
        .mic-test-panel {
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(201, 168, 163, 0.25);
          border-radius: 1rem;
          padding: 1.25rem 1.5rem;
          width: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.75rem;
        }
        .mic-test-title {
          color: #e8d5d0;
          font-family: 'Noto Sans JP', sans-serif;
          font-size: 0.9rem;
          font-weight: 500;
        }
        .mic-test-btn {
          background: rgba(201, 168, 163, 0.2);
          border: 1px solid rgba(201, 168, 163, 0.5);
          color: #e8d5d0;
          border-radius: 0.5rem;
          padding: 0.5rem 1.25rem;
          font-size: 0.875rem;
          cursor: pointer;
          transition: all 0.2s;
          font-family: 'Noto Sans JP', sans-serif;
        }
        .mic-test-btn:hover {
          background: rgba(201, 168, 163, 0.35);
        }
        .mic-testing {
          width: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.5rem;
        }
        .mic-volume-bar {
          width: 100%;
          height: 8px;
          background: rgba(255,255,255,0.1);
          border-radius: 4px;
          overflow: hidden;
        }
        .mic-volume-fill {
          height: 100%;
          background: linear-gradient(90deg, #c9a8a3, #e8d5d0);
          border-radius: 4px;
          transition: width 0.1s ease;
        }
        .mic-testing-text {
          color: #c9a8a3;
          font-size: 0.8rem;
          font-family: 'Noto Sans JP', sans-serif;
        }
        .mic-ok {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          color: #a8d5b5;
          font-size: 0.875rem;
          font-family: 'Noto Sans JP', sans-serif;
        }
        .mic-ok-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 20px;
          height: 20px;
          background: #a8d5b5;
          color: #1a2e1f;
          border-radius: 50%;
          font-size: 0.7rem;
          font-weight: bold;
        }
        .mic-error {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.5rem;
          color: #e8a8a3;
          font-size: 0.875rem;
          font-family: 'Noto Sans JP', sans-serif;
        }
        .mic-retry-btn {
          background: rgba(232, 168, 163, 0.2);
          border: 1px solid rgba(232, 168, 163, 0.4);
          color: #e8a8a3;
          border-radius: 0.5rem;
          padding: 0.3rem 0.75rem;
          font-size: 0.8rem;
          cursor: pointer;
          font-family: 'Noto Sans JP', sans-serif;
        }
      `}</style>
    </div>
  );
}
