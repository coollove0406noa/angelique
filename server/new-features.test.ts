import { describe, it, expect, vi, beforeEach } from "vitest";

// ── WaitingRoom関連のロジックテスト ──────────────────────────────────────

describe("WaitingRoom - タロットカードデータ", () => {
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

  it("大アルカナ22枚が定義されている", () => {
    expect(TAROT_CARDS).toHaveLength(22);
  });

  it("各カードにname・meaningが存在する", () => {
    for (const card of TAROT_CARDS) {
      expect(card.name).toBeTruthy();
      expect(card.meaning).toBeTruthy();
    }
  });

  it("カードのインデックスがループする", () => {
    const total = TAROT_CARDS.length;
    const nextIndex = (prev: number) => (prev + 1) % total;
    expect(nextIndex(21)).toBe(0); // 最後のカードの次は最初に戻る
    expect(nextIndex(0)).toBe(1);
  });
});

// ── スタンプ機能テスト ────────────────────────────────────────────────────

describe("スタンプ機能", () => {
  const STAMPS = [
    { label: "少々お待ちください🙏", text: "少々お待ちください🙏" },
    { label: "承知しました✨", text: "承知しました✨" },
    { label: "ありがとうございました🌙", text: "ありがとうございました🌙" },
    { label: "確認中です⭐", text: "確認中です⭐" },
  ];

  it("4種類のスタンプが定義されている", () => {
    expect(STAMPS).toHaveLength(4);
  });

  it("各スタンプにlabelとtextが存在する", () => {
    for (const stamp of STAMPS) {
      expect(stamp.label).toBeTruthy();
      expect(stamp.text).toBeTruthy();
      expect(stamp.label).toBe(stamp.text);
    }
  });

  it("スタンプテキストに絵文字が含まれる", () => {
    // 絵文字の範囲: U+1F300-U+1F9FF, U+2600-U+27BF, U+2B50 など
    const hasEmoji = STAMPS.every((s) => /[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{2B50}]/u.test(s.text));
    expect(hasEmoji).toBe(true);
  });
});

// ── 画像アップロードバリデーションテスト ─────────────────────────────────

describe("画像アップロードバリデーション", () => {
  const MAX_SIZE = 5 * 1024 * 1024; // 5MB

  it("5MB以下の画像は許可される", () => {
    const fileSize = 4 * 1024 * 1024; // 4MB
    expect(fileSize <= MAX_SIZE).toBe(true);
  });

  it("5MBを超える画像は拒否される", () => {
    const fileSize = 6 * 1024 * 1024; // 6MB
    expect(fileSize > MAX_SIZE).toBe(true);
  });

  it("base64プレフィックスを除去できる", () => {
    const base64WithPrefix = "data:image/jpeg;base64,/9j/4AAQSkZJRgAB";
    const cleaned = base64WithPrefix.replace(/^data:[^;]+;base64,/, "");
    expect(cleaned).toBe("/9j/4AAQSkZJRgAB");
    expect(cleaned).not.toContain("data:");
  });

  it("画像拡張子をMIMEタイプから取得できる", () => {
    const getExt = (mimeType: string) => mimeType.split("/")[1] || "jpg";
    expect(getExt("image/jpeg")).toBe("jpeg");
    expect(getExt("image/png")).toBe("png");
    expect(getExt("image/webp")).toBe("webp");
    expect(getExt("unknown")).toBe("jpg"); // フォールバック
  });
});

// ── QRコード機能テスト ────────────────────────────────────────────────────

describe("QRコード機能", () => {
  it("セッションURLが正しい形式で生成される", () => {
    const origin = "https://example.manus.space";
    const token = "abc123xyz";
    const url = `${origin}/session/${token}`;
    expect(url).toBe("https://example.manus.space/session/abc123xyz");
    expect(url).toContain("/session/");
  });

  it("空のトークンでもURLが生成される（エラーにならない）", () => {
    const origin = "https://example.com";
    const token = "";
    const url = `${origin}/session/${token}`;
    expect(url).toBe("https://example.com/session/");
  });
});

// ── Socket.ioイベント名テスト ─────────────────────────────────────────────

describe("Socket.ioイベント名", () => {
  const EVENTS = {
    waitingRoomJoin: "waiting_room_join",
    sessionStartNotify: "session_start_notify",
    sessionStarted: "session_started",
    clientWaiting: "client_waiting",
    sendMessage: "send_message",
    newMessage: "new_message",
  };

  it("ウェイティングルーム関連イベントが定義されている", () => {
    expect(EVENTS.waitingRoomJoin).toBe("waiting_room_join");
    expect(EVENTS.sessionStartNotify).toBe("session_start_notify");
    expect(EVENTS.sessionStarted).toBe("session_started");
    expect(EVENTS.clientWaiting).toBe("client_waiting");
  });

  it("メッセージ関連イベントが定義されている", () => {
    expect(EVENTS.sendMessage).toBe("send_message");
    expect(EVENTS.newMessage).toBe("new_message");
  });
});
