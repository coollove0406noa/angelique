import { useEffect, useRef, useState, useCallback } from "react";

// ── BGM ──────────────────────────────────────────────────────────────────
const BGM_TRACKS = [
  `/Moon鳥と清流MP3.mp3`,
];

// ── タロットカードデータ（大アルカナ22枚・自前 public/tarot/ 参照）──────
const TAROT_CARDS = [
  { name: "愚者",         meaning: "新しい始まり・自由・冒険への一歩",       img: "/tarot/00_Fool.webp",            roman: "0",     symbol: "☆" },
  { name: "魔術師",       meaning: "意志の力・創造性・新しいスキル",         img: "/tarot/01_Magician.webp",        roman: "Ⅰ",    symbol: "✦" },
  { name: "女教皇",       meaning: "直感・内なる知恵・神秘",                 img: "/tarot/02_High_Priestess.webp",  roman: "Ⅱ",    symbol: "☽" },
  { name: "女帝",         meaning: "豊かさ・母性・自然の恵み",               img: "/tarot/03_Empress.webp",         roman: "Ⅲ",    symbol: "♀" },
  { name: "皇帝",         meaning: "安定・権威・しっかりとした基盤",         img: "/tarot/04_Emperor.webp",         roman: "Ⅳ",    symbol: "♦" },
  { name: "法王",         meaning: "伝統・精神的な導き・信頼",               img: "/tarot/05_Hierophant.webp",      roman: "Ⅴ",    symbol: "✝" },
  { name: "恋人",         meaning: "愛・選択・調和",                         img: "/tarot/06_Lovers.webp",          roman: "Ⅵ",    symbol: "♡" },
  { name: "戦車",         meaning: "勝利・意志の強さ・前進",                 img: "/tarot/07_Chariot.webp",         roman: "Ⅶ",    symbol: "⚔" },
  { name: "力",           meaning: "内なる強さ・勇気・忍耐",                 img: "/tarot/08_Strength.webp",        roman: "Ⅷ",    symbol: "∞" },
  { name: "隠者",         meaning: "内省・孤独の時間・真実の探求",           img: "/tarot/09_Hermit.webp",          roman: "Ⅸ",    symbol: "🕯" },
  { name: "運命の輪",     meaning: "変化・サイクル・運命の転換点",           img: "/tarot/10_Wheel_of_Fortune.webp",roman: "Ⅹ",    symbol: "☯" },
  { name: "正義",         meaning: "公平・バランス・真実",                   img: "/tarot/11_Justice.webp",         roman: "Ⅺ",    symbol: "⚖" },
  { name: "吊るされた男", meaning: "手放す・新しい視点・待つ時間",           img: "/tarot/12_Hanged_Man.webp",      roman: "Ⅻ",    symbol: "△" },
  { name: "死",           meaning: "変容・終わりと始まり・再生",             img: "/tarot/13_Death.webp",           roman: "ⅩⅢ",  symbol: "☠" },
  { name: "節制",         meaning: "調和・バランス・穏やかな流れ",           img: "/tarot/14_Temperance.webp",      roman: "ⅩⅣ",  symbol: "≈" },
  { name: "悪魔",         meaning: "束縛からの解放・欲望・影の部分",         img: "/tarot/15_Devil.webp",           roman: "ⅩⅤ",  symbol: "⛓" },
  { name: "塔",           meaning: "突然の変化・古いものの崩壊・解放",       img: "/tarot/16_Tower.webp",           roman: "ⅩⅥ",  symbol: "⚡" },
  { name: "星",           meaning: "希望・光・未来への光",                   img: "/tarot/17_Star.webp",            roman: "ⅩⅦ",  symbol: "★" },
  { name: "月",           meaning: "無意識・夢・隠れた真実",                 img: "/tarot/18_Moon.webp",            roman: "ⅩⅧ",  symbol: "🌙" },
  { name: "太陽",         meaning: "喜び・成功・輝かしいエネルギー",         img: "/tarot/19_Sun.webp",             roman: "ⅩⅨ",  symbol: "☀" },
  { name: "審判",         meaning: "覚醒・再生・新しい使命",                 img: "/tarot/20_Judgement.webp",       roman: "ⅩⅩ",  symbol: "♪" },
  { name: "世界",         meaning: "完成・達成・新たなサイクルの始まり",     img: "/tarot/21_World.webp",           roman: "ⅩⅩⅠ", symbol: "◎" },
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
  sessionType: "chat" | "voice" | "video";
  onSessionStarted?: () => void;
}

export function WaitingRoom({ sessionType, onSessionStarted }: WaitingRoomProps) {
  // ── カード表示 ──────────────────────────────────────────────────────────
  const [shuffled] = useState(() => shuffleIndices(TAROT_CARDS.length));
  // shuffleの位置はrefで管理（state変更によるeffect再実行を防ぐ）
  const nextPosRef = useRef(0);
  // 表示するカードデータを独立したstateで管理
  const [displayCard, setDisplayCard] = useState(() => TAROT_CARDS[shuffled[0]]);
  // opacity=0/1をbooleanで管理（falseでフェードアウト）
  const [cardVisible, setCardVisible] = useState(true);
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    const DISPLAY = 15000; // 15秒表示
    const FADE    = 1500;  // 1.5秒フェード（CSSのtransition-durationと一致させる）

    let displayTimer: ReturnType<typeof setTimeout>;
    let switchTimer: ReturnType<typeof setTimeout>;
    let raf1: number, raf2: number;

    const scheduleNext = () => {
      displayTimer = setTimeout(() => {
        // ① フェードアウト開始
        setCardVisible(false);

        switchTimer = setTimeout(() => {
          // ② 完全に不可視になってからカードデータを差し替え
          nextPosRef.current = (nextPosRef.current + 1) % TAROT_CARDS.length;
          setDisplayCard(TAROT_CARDS[shuffled[nextPosRef.current]]);
          setImgError(false);

          // ③ Reactが新カードをDOMに反映した直後にフェードイン（2フレーム待機）
          raf1 = requestAnimationFrame(() => {
            raf2 = requestAnimationFrame(() => {
              setCardVisible(true);
              scheduleNext(); // 次のサイクルをスケジュール
            });
          });
        }, FADE);
      }, DISPLAY);
    };

    scheduleNext();

    return () => {
      clearTimeout(displayTimer);
      clearTimeout(switchTimer);
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  // shuffledは初回のみ生成される安定した値なので実質マウント時1回のみ実行
  }, [shuffled]);

  // ── BGM（3曲ランダム切替・フェードイン/アウト）──────────────────────
  const [bgmEnabled, setBgmEnabled] = useState(false);
  const [bgmStarted, setBgmStarted] = useState(false);
  const audioRef    = useRef<HTMLAudioElement | null>(null);
  const trackIdxRef = useRef<number>(-1);
  const fadeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // BGM ON/OFF の最新状態をrefで管理（fadeOutAndNextのstale closure対策）
  const bgmEnabledRef = useRef(false);

  // ランダムな曲インデックスを選ぶ（直前と同じ曲は避ける）
  const pickNextTrack = useCallback(() => {
    const prev = trackIdxRef.current;
    let next = Math.floor(Math.random() * BGM_TRACKS.length);
    if (BGM_TRACKS.length > 1 && next === prev) {
      next = (next + 1) % BGM_TRACKS.length;
    }
    return next;
  }, []);

  // フェードアウト → 次の曲へ（BGMがOFFになっていれば次曲は再生しない）
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
        // BGMがオフになっていれば次曲を再生しない
        if (bgmEnabledRef.current) {
          playTrack(pickNextTrack());
        }
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
      bgmEnabledRef.current = true;
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
      // BGMをオフにする：refを先に更新してfadeOutAndNextの連鎖再生を防ぐ
      bgmEnabledRef.current = false;
      setBgmEnabled(false);
      // 実行中のフェードタイマーを停止
      if (fadeTimerRef.current) {
        clearInterval(fadeTimerRef.current);
        fadeTimerRef.current = null;
      }
      // audio.pause()で完全停止
      const audio = audioRef.current;
      if (!audio) return;
      audio.pause();
      audio.currentTime = 0;
    }
  }, [bgmEnabled, bgmStarted, playTrack, pickNextTrack]);

  // アンマウント時にBGM停止
  useEffect(() => {
    return () => {
      if (fadeTimerRef.current) clearInterval(fadeTimerRef.current);
      audioRef.current?.pause();
    };
  }, []);

  // ── マイクテスト（音声・ビデオ鑑定用・リアルタイムレベルメーター）───────
  const [micStatus, setMicStatus] = useState<"idle" | "testing" | "denied" | "notfound" | "error">("idle");
  const [micVolume, setMicVolume] = useState(0);
  const micStreamRef    = useRef<MediaStream | null>(null);
  const analyserRef     = useRef<AnalyserNode | null>(null);
  const animFrameRef    = useRef<number | null>(null);
  const micAudioCtxRef  = useRef<AudioContext | null>(null);

  // テスト停止・マイク解放
  const stopMicTest = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    micAudioCtxRef.current?.close().catch(() => {});
    micAudioCtxRef.current = null;
    analyserRef.current = null;
    setMicVolume(0);
    setMicStatus("idle");
  }, []);

  // テスト開始：「テスト終了」ボタンが押されるまで連続計測
  const startMicTest = useCallback(async () => {
    setMicStatus("testing");
    setMicVolume(0);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      micStreamRef.current = stream;

      const audioCtx = new AudioContext();
      micAudioCtxRef.current = audioCtx;
      const source   = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8; // なめらかなアニメーション
      source.connect(analyser);
      // ⚠️ audioCtx.destination には接続しない（ハウリング防止）
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const measure = () => {
        if (!analyserRef.current) return;
        analyser.getByteFrequencyData(dataArray);
        const avg        = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        const normalized = Math.min(100, (avg / 128) * 200); // 感度2倍
        setMicVolume(normalized);
        animFrameRef.current = requestAnimationFrame(measure);
      };
      animFrameRef.current = requestAnimationFrame(measure);
    } catch (err: unknown) {
      const error = err as Error;
      if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
        setMicStatus("denied");
      } else if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
        setMicStatus("notfound");
      } else {
        setMicStatus("error");
      }
    }
  }, []);

  useEffect(() => {
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      micAudioCtxRef.current?.close().catch(() => {});
    };
  }, []);

  // ── 画面スリープ防止（音声・ビデオ鑑定のみ）─────────────────────────
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);
  const [wakeLockActive, setWakeLockActive] = useState(false);

  useEffect(() => {
    if (sessionType !== "voice" && sessionType !== "video") return;
    let released = false;

    const acquire = async () => {
      if ("wakeLock" in navigator) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const lock = await (navigator as any).wakeLock.request("screen");
          if (!released) {
            wakeLockRef.current = lock;
            setWakeLockActive(true);
          } else {
            lock.release().catch(() => {});
          }
        } catch {
          // WakeLock 未対応 or 拒否：テキスト案内で対応
        }
      }
    };

    acquire();

    return () => {
      released = true;
      wakeLockRef.current?.release().catch(() => {});
      wakeLockRef.current = null;
      setWakeLockActive(false);
    };
  }, [sessionType]);

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
          style={{ opacity: cardVisible ? 1 : 0, transition: "opacity 1.5s ease-in-out" }}
        >
          {!imgError ? (
            <img
              key={displayCard.name}
              src={displayCard.img}
              alt={displayCard.name}
              className="wr-card-img"
              draggable={false}
              onError={() => setImgError(true)}
            />
          ) : (
            <div className="wr-card-fallback">
              <div className="wr-card-roman">{displayCard.roman}</div>
              <div className="wr-card-symbol-big">{displayCard.symbol}</div>
            </div>
          )}
          <div className="wr-card-name">{displayCard.name}</div>
          <div className="wr-card-meaning">{displayCard.meaning}</div>
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
          {bgmEnabled ? "🔇 BGMを止める" : "🎵 BGMを流す"}
        </button>

        {/* 音声・ビデオ鑑定のみ：スリープ防止案内 + マイクテスト */}
        {(sessionType === "voice" || sessionType === "video") && (
          <div className="wr-sleep-notice">
            {wakeLockActive ? (
              <p className="wr-sleep-ok">🔒 画面スリープを自動で防止しています</p>
            ) : (
              <p className="wr-sleep-warn">
                📵 画面が自動的にオフにならないよう、端末の設定で<strong>「画面の自動ロック」をオフ</strong>にしてください
              </p>
            )}
          </div>
        )}
        {(sessionType === "voice" || sessionType === "video") && (
          <div className="wr-mic-panel">
            <div className="wr-mic-title">🎤 マイクテスト</div>

            {/* 待機中 */}
            {micStatus === "idle" && (
              <button onClick={startMicTest} className="wr-mic-btn">
                マイクをテストする
              </button>
            )}

            {/* テスト中：リアルタイムレベルメーター */}
            {micStatus === "testing" && (
              <div className="wr-mic-testing">
                <div className="wr-vol-bar">
                  <div className="wr-vol-fill" style={{ width: `${micVolume}%` }} />
                </div>
                <p className="wr-mic-sub">🎤 声を出すと棒が伸びます</p>
                <button onClick={stopMicTest} className="wr-mic-stop-btn">
                  テスト終了
                </button>
              </div>
            )}

            {/* エラー系 */}
            {micStatus === "denied" && (
              <div className="wr-mic-denied">
                <p className="wr-mic-denied-title">⚠ マイクへのアクセスが拒否されました</p>
                <ol className="wr-mic-guide">
                  <li>ブラウザのアドレスバー左端の 🔒 アイコンをタップ</li>
                  <li>「マイク」を <strong>許可</strong> に変更</li>
                  <li>ページを再読み込み（更新）してください</li>
                </ol>
                <button onClick={startMicTest} className="wr-mic-retry">再試行</button>
              </div>
            )}
            {micStatus === "notfound" && (
              <div className="wr-mic-error">
                <p>⚠ マイクが見つかりません</p>
                <p className="wr-mic-sub">スマートフォンの場合はブラウザを変更してお試しください（Safari → Chrome など）</p>
                <button onClick={startMicTest} className="wr-mic-retry">再試行</button>
              </div>
            )}
            {micStatus === "error" && (
              <div className="wr-mic-error">
                <p>⚠ マイクへのアクセスに失敗しました</p>
                <p className="wr-mic-sub">ブラウザのマイク許可設定を確認してください</p>
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
        .wr-card-fallback {
          width: 140px;
          height: 200px;
          border-radius: 0.75rem;
          border: 1.5px solid rgba(201,168,163,0.5);
          background: linear-gradient(160deg, rgba(40,20,60,0.9) 0%, rgba(25,12,45,0.95) 100%);
          box-shadow: 0 4px 20px rgba(0,0,0,0.5);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
        }
        .wr-card-roman {
          font-family: 'Cormorant Garamond', serif;
          font-size: 0.9rem;
          color: rgba(201,168,163,0.7);
          letter-spacing: 0.2em;
        }
        .wr-card-symbol-big {
          font-size: 3rem;
          line-height: 1;
          filter: drop-shadow(0 0 8px rgba(201,168,163,0.6));
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
        /* スリープ防止案内 */
        .wr-sleep-notice {
          width: 100%;
          border-radius: 0.75rem;
          padding: 0.6rem 0.9rem;
          font-family: 'Noto Sans JP', sans-serif;
          font-size: 0.75rem;
          line-height: 1.6;
          text-align: left;
        }
        .wr-sleep-ok {
          color: #a8d4c9;
          margin: 0;
          background: rgba(100,200,180,0.08);
          border: 1px solid rgba(100,200,180,0.25);
          border-radius: 0.5rem;
          padding: 0.4rem 0.7rem;
        }
        .wr-sleep-warn {
          color: #e8d5a0;
          margin: 0;
          background: rgba(232,213,100,0.08);
          border: 1px solid rgba(232,213,100,0.25);
          border-radius: 0.5rem;
          padding: 0.4rem 0.7rem;
        }
        .wr-sleep-warn strong {
          color: #f0e070;
        }
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
          gap: 0.6rem;
        }
        .wr-vol-bar {
          width: 100%;
          height: 14px;
          background: rgba(255,255,255,0.1);
          border-radius: 7px;
          overflow: hidden;
        }
        .wr-vol-fill {
          height: 100%;
          background: linear-gradient(90deg, #c9a8a3 0%, #e8d5d0 60%, #ffe0a0 100%);
          border-radius: 7px;
          transition: width 0.08s ease;
        }
        .wr-mic-sub {
          color: #c9a8a3;
          font-size: 0.75rem;
          font-family: 'Noto Sans JP', sans-serif;
          margin: 0;
        }
        .wr-mic-stop-btn {
          background: rgba(232,168,163,0.18);
          border: 1px solid rgba(232,168,163,0.5);
          color: #e8d5d0;
          border-radius: 0.5rem;
          padding: 0.4rem 1.2rem;
          font-size: 0.82rem;
          cursor: pointer;
          transition: background 0.2s;
          font-family: 'Noto Sans JP', sans-serif;
        }
        .wr-mic-stop-btn:hover { background: rgba(232,168,163,0.32); }
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
        /* マイク拒否ガイド */
        .wr-mic-denied {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 0.5rem;
          background: rgba(255,80,80,0.08);
          border: 1px solid rgba(232,168,163,0.4);
          border-radius: 0.75rem;
          padding: 0.75rem 1rem;
          width: 100%;
        }
        .wr-mic-denied-title {
          color: #e8a8a3;
          font-size: 0.82rem;
          font-weight: 700;
          font-family: 'Noto Sans JP', sans-serif;
          margin: 0;
        }
        .wr-mic-guide {
          color: #c9a8a3;
          font-size: 0.76rem;
          font-family: 'Noto Sans JP', sans-serif;
          line-height: 1.8;
          padding-left: 1.2rem;
          margin: 0;
          text-align: left;
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
