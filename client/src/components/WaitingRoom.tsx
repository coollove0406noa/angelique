import { useEffect, useRef, useState, useCallback } from "react";

const CDN = "https://d2xsxph8kpxj0f.cloudfront.net/310519663226441831/B6EzJ6NeuYcNikyfaASeGg";

// ── BGM 3曲 ──────────────────────────────────────────────────────────────
const BGM_TRACKS = [
  `${CDN}/bgm1_82b9bf72.wav`,
  `${CDN}/bgm2_98e4b11a.wav`,
  `${CDN}/bgm3_9f2c6999.wav`,
];

// ── タロットカードデータ（大アルカナ22枚・実画像付き）──────────────────
const TAROT_CARDS = [
  { name: "愚者",         meaning: "新しい始まり・自由・冒険への一歩",       img: `${CDN}/00_Fool_1772fd69.jpg` },
  { name: "魔術師",       meaning: "意志の力・創造性・新しいスキル",         img: `${CDN}/01_Magician_a5223f26.jpg` },
  { name: "女教皇",       meaning: "直感・内なる知恵・神秘",                 img: `${CDN}/02_High_Priestess_8d1c4c1f.jpg` },
  { name: "女帝",         meaning: "豊かさ・母性・自然の恵み",               img: `${CDN}/03_Empress_3afb2b89.jpg` },
  { name: "皇帝",         meaning: "安定・権威・しっかりとした基盤",         img: `${CDN}/04_Emperor_f6db9143.jpg` },
  { name: "法王",         meaning: "伝統・精神的な導き・信頼",               img: `${CDN}/05_Hierophant_5c4b9d5a.jpg` },
  { name: "恋人",         meaning: "愛・選択・調和",                         img: `${CDN}/06_Lovers_72beb078.jpg` },
  { name: "戦車",         meaning: "勝利・意志の強さ・前進",                 img: `${CDN}/07_Chariot_27851a26.jpg` },
  { name: "力",           meaning: "内なる強さ・勇気・忍耐",                 img: `${CDN}/08_Strength_82aa6f86.jpg` },
  { name: "隐者",         meaning: "内省・孤独の時間・真実の探求",           img: `${CDN}/09_Hermit_5d0fa205.jpg` },
  { name: "運命の輪",     meaning: "変化・サイクル・運命の転換点",           img: `${CDN}/10_Wheel_of_Fortune_e02b405b.jpg` },
  { name: "正義",         meaning: "公平・バランス・真実",                   img: `${CDN}/11_Justice_768387c8.jpg` },
  { name: "吹るされた男", meaning: "手放す・新しい視点・待つ時間",           img: `${CDN}/12_Hanged_Man_a9c5873d.jpg` },
  { name: "死",           meaning: "変容・終わりと始まり・再生",             img: `${CDN}/13_Death_a746d50f.jpg` },
  { name: "節制",         meaning: "調和・バランス・穏やかな流れ",           img: `${CDN}/14_Temperance_75152b25.jpg` },
  { name: "悪魔",         meaning: "束縛からの解放・欲望・影の部分",         img: `${CDN}/15_Devil_7ce26fa2.jpg` },
  { name: "塔",           meaning: "突然の変化・古いものの崩壊・解放",       img: `${CDN}/16_Tower_2b7fbe3d.jpg` },
  { name: "星",           meaning: "希望・癍し・未来への光",                 img: `${CDN}/17_Star_37f26fa5.jpg` },
  { name: "月",           meaning: "無意識・夢・隠れた真実",                 img: `${CDN}/18_Moon_482dc011.jpg` },
  { name: "太陽",         meaning: "喜び・成功・輝かしいエネルギー",         img: `${CDN}/19_Sun_f5a128e4.jpg` },
  { name: "審判",         meaning: "覚醒・再生・新しい使命",                 img: `${CDN}/20_Judgement_bc8ffe67.jpg` },
  { name: "世界",         meaning: "完成・達成・新たなサイクルの始まり",     img: `${CDN}/21_World_58612ce5.jpg` },
];

// カードインデックスをランダムに並べ替えたシャッフル済みリストを生成
function shuffleIndices(len: number): number[] {
  const arr = Array.from({ length: len }, (_, i) => i);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

interface WaitingRoomProps {
  sessionType: "chat" | "voice";
  onSessionStarted?: () => void;
}

export function WaitingRoom({ sessionType, onSessionStarted }: WaitingRoomProps) {
  // ── カード表示 ──────────────────────────────────────────────────────────
  const [shuffled] = useState(() => shuffleIndices(TAROT_CARDS.length));
  const [shufflePos, setShufflePos] = useState(0);
  const [cardOpacity, setCardOpacity] = useState(1);
  const currentCard = TAROT_CARDS[shuffled[shufflePos]];

  useEffect(() => {
    const DISPLAY = 15000; // 15秒表示
    const FADE   = 2000;   // 2秒フェード

    const fadeOut = setTimeout(() => {
      setCardOpacity(0);
      const next = setTimeout(() => {
        setShufflePos((p) => (p + 1) % TAROT_CARDS.length);
        setCardOpacity(1);
      }, FADE);
      return () => clearTimeout(next);
    }, DISPLAY);

    return () => clearTimeout(fadeOut);
  }, [shufflePos]);

  // ── BGM（3曲ランダム切替・フェードイン/アウト）──────────────────────
  const [bgmEnabled, setBgmEnabled] = useState(false);
  const [bgmStarted, setBgmStarted] = useState(false);
  const audioRef    = useRef<HTMLAudioElement | null>(null);
  const trackIdxRef = useRef<number>(-1);
  const fadeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ランダムな曲インデックスを選ぶ（直前と同じ曲は避ける）
  const pickNextTrack = useCallback(() => {
    const prev = trackIdxRef.current;
    let next = Math.floor(Math.random() * BGM_TRACKS.length);
    if (BGM_TRACKS.length > 1 && next === prev) {
      next = (next + 1) % BGM_TRACKS.length;
    }
    return next;
  }, []);

  // フェードアウト → 次の曲へ
  const fadeOutAndNext = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (fadeTimerRef.current) clearInterval(fadeTimerRef.current);

    const startVol = audio.volume;
    const step = startVol / 20; // 20ステップでフェードアウト
    fadeTimerRef.current = setInterval(() => {
      if (!audioRef.current) return;
      const v = Math.max(0, audioRef.current.volume - step);
      audioRef.current.volume = v;
      if (v <= 0) {
        clearInterval(fadeTimerRef.current!);
        audioRef.current.pause();
        playTrack(pickNextTrack());
      }
    }, 50); // 50ms × 20 = 1秒フェードアウト
  }, [pickNextTrack]);

  const playTrack = useCallback((idx: number) => {
    trackIdxRef.current = idx;
    const audio = new Audio(BGM_TRACKS[idx]);
    audio.volume = 0;
    audioRef.current = audio;

    audio.addEventListener("ended", fadeOutAndNext);
    audio.play().then(() => {
      // フェードイン（0 → 0.15 を1秒かけて）
      if (fadeTimerRef.current) clearInterval(fadeTimerRef.current);
      const target = 0.15;
      const step = target / 20;
      fadeTimerRef.current = setInterval(() => {
        if (!audioRef.current) return;
        const v = Math.min(target, audioRef.current.volume + step);
        audioRef.current.volume = v;
        if (v >= target) clearInterval(fadeTimerRef.current!);
      }, 50);
    }).catch(() => {
      // 自動再生ブロック時は静かに無視
    });
  }, [fadeOutAndNext]);

  // BGM ON/OFF トグル
  const toggleBgm = useCallback(async () => {
    if (!bgmEnabled) {
      // BGMをオンにする
      setBgmEnabled(true);
      if (!bgmStarted) {
        // 初回起動
        setBgmStarted(true);
        playTrack(pickNextTrack());
      } else if (audioRef.current) {
        // 既存のオーディオを再生
        audioRef.current.volume = 0;
        audioRef.current.play().catch(() => {});
        if (fadeTimerRef.current) clearInterval(fadeTimerRef.current);
        const target = 0.15;
        const step = target / 20;
        fadeTimerRef.current = setInterval(() => {
          if (!audioRef.current) return;
          const v = Math.min(target, audioRef.current.volume + step);
          audioRef.current.volume = v;
          if (v >= target) clearInterval(fadeTimerRef.current!);
        }, 50);
      } else {
        // audioRefがない場合は新しく再生
        setBgmStarted(true);
        playTrack(pickNextTrack());
      }
    } else {
      // BGMをオフにする（フェードアウト後に完全停止）
      setBgmEnabled(false);
      // フェードタイマーを必ずクリア
      if (fadeTimerRef.current) {
        clearInterval(fadeTimerRef.current);
        fadeTimerRef.current = null;
      }
      const audio = audioRef.current;
      if (!audio) return;
      const startVol = audio.volume;
      if (startVol <= 0) {
        // 既に音量0ならそのまま停止
        audio.pause();
        audio.currentTime = 0;
        return;
      }
      // フェードアウトしてから停止
      const step = startVol / 20;
      fadeTimerRef.current = setInterval(() => {
        if (!audioRef.current) {
          clearInterval(fadeTimerRef.current!);
          fadeTimerRef.current = null;
          return;
        }
        const v = Math.max(0, audioRef.current.volume - step);
        audioRef.current.volume = v;
        if (v <= 0) {
          clearInterval(fadeTimerRef.current!);
          fadeTimerRef.current = null;
          audioRef.current.pause();
          audioRef.current.currentTime = 0;
        }
      }, 50);
    }
  }, [bgmEnabled, bgmStarted, playTrack, pickNextTrack]);

  // アンマウント時にBGM停止
  useEffect(() => {
    return () => {
      if (fadeTimerRef.current) clearInterval(fadeTimerRef.current);
      audioRef.current?.pause();
    };
  }, []);

  // ── マイクテスト（音声鑑定のみ）────────────────────────────────────────
  const [micStatus, setMicStatus] = useState<"idle" | "testing" | "ok" | "error">("idle");
  const [micVolume, setMicVolume] = useState(0);
  const micStreamRef  = useRef<MediaStream | null>(null);
  const analyserRef   = useRef<AnalyserNode | null>(null);
  const animFrameRef  = useRef<number | null>(null);

  const startMicTest = useCallback(async () => {
    setMicStatus("testing");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      micStreamRef.current = stream;

      const audioCtx = new AudioContext();
      const source   = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      let maxVol = 0;
      let frames = 0;

      const measure = () => {
        analyser.getByteFrequencyData(dataArray);
        const avg        = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        const normalized = Math.min(100, (avg / 128) * 100);
        setMicVolume(normalized);
        if (normalized > maxVol) maxVol = normalized;
        frames++;

        if (frames < 120) {
          animFrameRef.current = requestAnimationFrame(measure);
        } else {
          setMicStatus(maxVol > 2 ? "ok" : "error");
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

  // ── レンダリング ──────────────────────────────────────────────────────
  return (
    <div className="wr-root">
      {/* 背景の星エフェクト */}
      <div className="wr-stars" aria-hidden="true">
        {Array.from({ length: 24 }).map((_, i) => (
          <span
            key={i}
            className="wr-star"
            style={{
              left:           `${(i * 37 + 13) % 100}%`,
              top:            `${(i * 53 + 7) % 100}%`,
              animationDelay: `${(i * 0.31) % 3.5}s`,
              fontSize:       `${8 + (i % 4) * 5}px`,
              opacity:        0.25 + (i % 5) * 0.08,
            }}
          >
            ✦
          </span>
        ))}
      </div>

      {/* メインコンテンツ */}
      <div className="wr-content">
        {/* ロゴ */}
        <div className="wr-logo">
          <span style={{ color: "#c9a8a3", fontSize: "1.4rem" }}>✦</span>
          <span className="wr-logo-text">angelique</span>
        </div>

        {/* タロットカード */}
        <div
          className="wr-card"
          style={{ opacity: cardOpacity, transition: "opacity 2s ease-in-out" }}
        >
          <img
            src={currentCard.img}
            alt={currentCard.name}
            className="wr-card-img"
            draggable={false}
          />
          <div className="wr-card-name">{currentCard.name}</div>
          <div className="wr-card-meaning">{currentCard.meaning}</div>
        </div>

        {/* 待機メッセージ */}
        <div className="wr-message">
          <span>占い師の準備ができるまでお待ちください</span>
          <span className="wr-dots">...</span>
        </div>

        {/* BGMコントロール */}
        <button
          onClick={toggleBgm}
          className="wr-bgm-btn"
          aria-label={bgmEnabled ? "BGMを停止" : "BGMを再生"}
        >
          {bgmEnabled ? "🔊 BGM ON" : "🔇 BGM OFF"}
        </button>

        {/* 音声鑑定のみ：マイクテスト */}
        {sessionType === "voice" && (
          <div className="wr-mic-panel">
            <div className="wr-mic-title">🎤 マイクテスト</div>
            {micStatus === "idle" && (
              <button onClick={startMicTest} className="wr-mic-btn">
                マイクをテストする
              </button>
            )}
            {micStatus === "testing" && (
              <div className="wr-mic-testing">
                <div className="wr-vol-bar">
                  <div className="wr-vol-fill" style={{ width: `${micVolume}%` }} />
                </div>
                <p className="wr-mic-sub">マイクの音量を測定中...</p>
              </div>
            )}
            {micStatus === "ok" && (
              <div className="wr-mic-ok">
                <span className="wr-mic-ok-icon">✓</span>
                <span>マイクが正常に動作しています</span>
              </div>
            )}
            {micStatus === "error" && (
              <div className="wr-mic-error">
                <span>⚠ マイクが検出できませんでした</span>
                <button onClick={startMicTest} className="wr-mic-retry">再試行</button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* スタイル */}
      <style>{`
        .wr-root {
          position: fixed;
          inset: 0;
          background: linear-gradient(135deg, #12082a 0%, #251540 45%, #12082a 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 50;
          overflow: hidden;
        }
        .wr-stars {
          position: absolute;
          inset: 0;
          pointer-events: none;
        }
        .wr-star {
          position: absolute;
          color: #c9a8a3;
          animation: wr-twinkle 3.5s ease-in-out infinite;
        }
        @keyframes wr-twinkle {
          0%, 100% { opacity: 0.15; transform: scale(1); }
          50%       { opacity: 0.7;  transform: scale(1.4); }
        }
        .wr-content {
          position: relative;
          z-index: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 1.25rem;
          padding: 2rem 1.5rem;
          max-width: 380px;
          width: 100%;
          text-align: center;
        }
        .wr-logo {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        .wr-logo-text {
          font-family: 'Cormorant Garamond', serif;
          font-size: 1.75rem;
          color: #e8d5d0;
          letter-spacing: 0.18em;
        }
        /* カード */
        .wr-card {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.6rem;
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(201,168,163,0.25);
          border-radius: 1.25rem;
          padding: 1.25rem 1.5rem 1.5rem;
          width: 100%;
          backdrop-filter: blur(12px);
          box-shadow: 0 8px 40px rgba(0,0,0,0.4);
        }
        .wr-card-img {
          width: 140px;
          height: auto;
          border-radius: 0.75rem;
          box-shadow: 0 4px 20px rgba(0,0,0,0.5);
          object-fit: cover;
          user-select: none;
        }
        .wr-card-name {
          font-family: 'Cormorant Garamond', serif;
          font-size: 1.4rem;
          color: #e8d5d0;
          font-weight: 600;
          letter-spacing: 0.12em;
          margin-top: 0.25rem;
        }
        .wr-card-meaning {
          font-family: 'Noto Sans JP', sans-serif;
          font-size: 0.8rem;
          color: #c9a8a3;
          line-height: 1.7;
        }
        /* 待機メッセージ */
        .wr-message {
          color: #e8d5d0;
          font-family: 'Noto Sans JP', sans-serif;
          font-size: 0.85rem;
          letter-spacing: 0.04em;
          display: flex;
          align-items: center;
          gap: 0.2rem;
          justify-content: center;
        }
        .wr-dots {
          animation: wr-dot-pulse 1.6s ease-in-out infinite;
        }
        @keyframes wr-dot-pulse {
          0%, 100% { opacity: 0.3; }
          50%       { opacity: 1; }
        }
        /* BGMボタン */
        .wr-bgm-btn {
          background: rgba(201,168,163,0.12);
          border: 1px solid rgba(201,168,163,0.35);
          color: #c9a8a3;
          border-radius: 2rem;
          padding: 0.35rem 1rem;
          font-size: 0.78rem;
          cursor: pointer;
          transition: background 0.2s;
          font-family: 'Noto Sans JP', sans-serif;
        }
        .wr-bgm-btn:hover { background: rgba(201,168,163,0.22); }
        /* マイクテスト */
        .wr-mic-panel {
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(201,168,163,0.2);
          border-radius: 1rem;
          padding: 1rem 1.25rem;
          width: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.6rem;
        }
        .wr-mic-title {
          color: #e8d5d0;
          font-family: 'Noto Sans JP', sans-serif;
          font-size: 0.85rem;
          font-weight: 500;
        }
        .wr-mic-btn {
          background: rgba(201,168,163,0.18);
          border: 1px solid rgba(201,168,163,0.45);
          color: #e8d5d0;
          border-radius: 0.5rem;
          padding: 0.45rem 1.2rem;
          font-size: 0.82rem;
          cursor: pointer;
          transition: background 0.2s;
          font-family: 'Noto Sans JP', sans-serif;
        }
        .wr-mic-btn:hover { background: rgba(201,168,163,0.3); }
        .wr-mic-testing {
          width: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.4rem;
        }
        .wr-vol-bar {
          width: 100%;
          height: 7px;
          background: rgba(255,255,255,0.1);
          border-radius: 4px;
          overflow: hidden;
        }
        .wr-vol-fill {
          height: 100%;
          background: linear-gradient(90deg, #c9a8a3, #e8d5d0);
          border-radius: 4px;
          transition: width 0.1s ease;
        }
        .wr-mic-sub {
          color: #c9a8a3;
          font-size: 0.75rem;
          font-family: 'Noto Sans JP', sans-serif;
        }
        .wr-mic-ok {
          display: flex;
          align-items: center;
          gap: 0.45rem;
          color: #a8d5b5;
          font-size: 0.82rem;
          font-family: 'Noto Sans JP', sans-serif;
        }
        .wr-mic-ok-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 18px;
          height: 18px;
          background: #a8d5b5;
          color: #1a2e1f;
          border-radius: 50%;
          font-size: 0.65rem;
          font-weight: bold;
        }
        .wr-mic-error {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.4rem;
          color: #e8a8a3;
          font-size: 0.82rem;
          font-family: 'Noto Sans JP', sans-serif;
        }
        .wr-mic-retry {
          background: rgba(232,168,163,0.18);
          border: 1px solid rgba(232,168,163,0.4);
          color: #e8a8a3;
          border-radius: 0.5rem;
          padding: 0.28rem 0.7rem;
          font-size: 0.75rem;
          cursor: pointer;
          font-family: 'Noto Sans JP', sans-serif;
        }
        /* スマホ対応 */
        @media (max-width: 420px) {
          .wr-content { padding: 1.5rem 1rem; gap: 1rem; }
          .wr-card-img { width: 110px; }
          .wr-card-name { font-size: 1.2rem; }
        }
      `}</style>
    </div>
  );
}
