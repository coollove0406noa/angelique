import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import AngeliqueHeader from "@/components/AngeliqueHeader";
import AdminLogin from "./AdminLogin";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { useBrand } from "@/contexts/BrandContext";
import { useParams } from "wouter";

export default function AdminSettings() {
  const { slug } = useParams<{ slug: string }>();
  const { isAuthenticated, isLoading, fortuneTeller, refetch: refetchAuth } = useAdminAuth();
  const { colors } = useBrand();

  const ftId = fortuneTeller?.fortuneTellerId ?? 0;

  const [chatUrl10, setChatUrl10] = useState("");
  const [chatUrl30, setChatUrl30] = useState("");
  const [voiceUrl10, setVoiceUrl10] = useState("");
  const [voiceUrl30, setVoiceUrl30] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingUrls, setSavingUrls] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [brandName, setBrandName] = useState("");
  const [themeColor, setThemeColor] = useState(fortuneTeller?.themeColor ?? "#f3e7e5");
  const [accentColor, setAccentColor] = useState(fortuneTeller?.accentColor ?? "#c9a8a3");
  const [savingBrand, setSavingBrand] = useState(false);

  const { data: settings } = trpc.settings.list.useQuery(
    { fortuneTellerId: ftId },
    { enabled: isAuthenticated && ftId > 0 }
  );
  const setBulkSettings = trpc.settings.setBulk.useMutation({
    onSuccess: () => { toast.success("設定を保存しました"); setSavingUrls(false); },
    onError: (e) => { toast.error(e.message); setSavingUrls(false); },
  });
  const changePassword = trpc.admin.changePassword.useMutation({
    onSuccess: () => {
      toast.success("パスワードを変更しました");
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      setSavingPassword(false);
    },
    onError: (e) => { toast.error(e.message); setSavingPassword(false); },
  });
  const updateBrand = trpc.admin.updateBrand.useMutation({
    onSuccess: () => {
      toast.success("ブランド設定を保存しました");
      setSavingBrand(false);
      refetchAuth();
    },
    onError: (e) => { toast.error(e.message); setSavingBrand(false); },
  });
  const logoutMutation = trpc.admin.logout.useMutation({ onSuccess: () => refetchAuth() });

  useEffect(() => {
    if (settings) {
      setChatUrl10(settings.find((s) => s.key === "stores_url_chat_10min")?.value ?? "");
      setChatUrl30(settings.find((s) => s.key === "stores_url_chat_30min")?.value ?? "");
      setVoiceUrl10(settings.find((s) => s.key === "stores_url_voice_10min")?.value ?? "");
      setVoiceUrl30(settings.find((s) => s.key === "stores_url_voice_30min")?.value ?? "");
    }
  }, [settings]);

  useEffect(() => {
    if (fortuneTeller) {
      setBrandName(fortuneTeller.brandName);
      // 旧キー名の場合は hex に変換してセット
      const legacy: Record<string, string> = {
        "dusty-pink": "#f3e7e5", lavender: "#ede7f6", "mint-green": "#e8f5e9",
        "sky-blue": "#e3f2fd", peach: "#fce4ec", gold: "#fff8e1",
        mauve: "#f3e5f5", "off-white": "#fafafa",
      };
      const legacyAccent: Record<string, string> = {
        "dusty-pink": "#c9a8a3", lavender: "#9575cd", "mint-green": "#66bb6a",
        "sky-blue": "#42a5f5", peach: "#f48fb1", gold: "#ffc107",
        mauve: "#ab47bc", "off-white": "#9e9e9e",
      };
      setThemeColor(legacy[fortuneTeller.themeColor] ?? fortuneTeller.themeColor);
      setAccentColor(legacyAccent[fortuneTeller.themeColor] ?? fortuneTeller.accentColor ?? "#c9a8a3");
    }
  }, [fortuneTeller]);

  function handleSaveUrls(e: React.FormEvent) {
    e.preventDefault();
    setSavingUrls(true);
    setBulkSettings.mutate({
      fortuneTellerId: ftId,
      items: [
        { key: "stores_url_chat_10min", value: chatUrl10, label: "STORES延長URL（チャット10分）" },
        { key: "stores_url_chat_30min", value: chatUrl30, label: "STORES延長URL（チャット30分）" },
        { key: "stores_url_voice_10min", value: voiceUrl10, label: "STORES延長URL（音声10分）" },
        { key: "stores_url_voice_30min", value: voiceUrl30, label: "STORES延長URL（音声30分）" },
      ],
    });
  }

  function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) { toast.error("新しいパスワードが一致しません"); return; }
    if (newPassword.length < 6) { toast.error("パスワードは6文字以上で設定してください"); return; }
    setSavingPassword(true);
    changePassword.mutate({ slug, currentPassword, newPassword });
  }

  function handleSaveBrand(e: React.FormEvent) {
    e.preventDefault();
    setSavingBrand(true);
    updateBrand.mutate({ slug, brandName, themeColor, accentColor });
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: colors.main }}>
        <div style={{ color: colors.subText }}>読み込み中...</div>
      </div>
    );
  }
  if (!isAuthenticated) return <AdminLogin slug={slug} onSuccess={refetchAuth} />;

  return (
    <div className="min-h-screen" style={{ background: colors.main }}>
      <AngeliqueHeader isAdmin slug={slug} onLogout={() => logoutMutation.mutate()} />

      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "28px", color: colors.text, fontWeight: 400 }}>
            設定
          </h1>
          <p style={{ fontSize: "13px", color: colors.subText, marginTop: "4px" }}>
            ブランド設定・延長URL・パスワードなどを管理します
          </p>
        </div>

        {/* Brand Settings */}
        <div className="angelique-card p-6 mb-6">
          <h2 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "20px", color: colors.text, marginBottom: "6px" }}>
            ✦ ブランドカスタマイズ
          </h2>
          <p style={{ fontSize: "12px", color: colors.subText, marginBottom: "20px" }}>
            ブランド名とテーマカラーを設定します。変更は管理者画面・お客様画面の両方に反映されます。
          </p>
          <form onSubmit={handleSaveBrand}>
            <div className="mb-6">
              <label className="angelique-label">ブランド名（ヘッダーに表示される名前）</label>
              <input
                type="text"
                className="angelique-input"
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                placeholder="例：華耀望愛"
                required
              />
            </div>

            <div className="mb-6">
              <label className="angelique-label">テーマカラー</label>
              <p style={{ fontSize: "11px", color: colors.subText, marginBottom: "16px" }}>
                メインカラーとアクセントカラーの2色を自由に設定できます。
                変更はヘッダー・ボタン・吹き出し・メールに反映されます。
              </p>

              {/* プレビュー */}
              <div
                style={{
                  display: "flex",
                  gap: "8px",
                  padding: "16px",
                  borderRadius: "14px",
                  background: themeColor,
                  border: `1.5px solid ${accentColor}`,
                  marginBottom: "16px",
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <span style={{ fontSize: "13px", color: "#4a3b38", fontWeight: 500 }}>プレビュー：</span>
                <span
                  style={{
                    background: accentColor,
                    color: "#ffffff",
                    borderRadius: "20px",
                    padding: "5px 16px",
                    fontSize: "13px",
                    fontWeight: 500,
                  }}
                >
                  ボタン
                </span>
                <span
                  style={{
                    background: "transparent",
                    color: accentColor,
                    border: `1.5px solid ${accentColor}`,
                    borderRadius: "20px",
                    padding: "5px 16px",
                    fontSize: "13px",
                    fontWeight: 500,
                  }}
                >
                  アウトライン
                </span>
              </div>

              <div className="grid grid-cols-1 gap-4" style={{ maxWidth: "480px" }}>
                {/* メインカラー */}
                <div>
                  <label className="angelique-label">メインカラー（背景・ベース）</label>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "6px" }}>
                    <div style={{ position: "relative", width: "52px", height: "52px" }}>
                      <input
                        type="color"
                        value={themeColor}
                        onChange={(e) => setThemeColor(e.target.value)}
                        style={{
                          position: "absolute",
                          inset: 0,
                          width: "100%",
                          height: "100%",
                          opacity: 0,
                          cursor: "pointer",
                          border: "none",
                          padding: 0,
                        }}
                        title="メインカラーを選択"
                      />
                      <div
                        style={{
                          width: "52px",
                          height: "52px",
                          borderRadius: "12px",
                          background: themeColor,
                          border: `2px solid ${colors.border}`,
                          pointerEvents: "none",
                        }}
                      />
                    </div>
                    <div>
                      <div style={{ fontSize: "14px", color: colors.text, fontWeight: 500 }}>{themeColor.toUpperCase()}</div>
                      <div style={{ fontSize: "11px", color: colors.subText }}>ページ背景・情報ボックス</div>
                    </div>
                    <input
                      type="text"
                      className="angelique-input"
                      value={themeColor}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (/^#[0-9a-fA-F]{0,6}$/.test(v)) setThemeColor(v);
                      }}
                      placeholder="#f3e7e5"
                      style={{ width: "110px", fontFamily: "monospace" }}
                    />
                  </div>
                </div>

                {/* アクセントカラー */}
                <div>
                  <label className="angelique-label">アクセントカラー（ボタン・強調）</label>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "6px" }}>
                    <div style={{ position: "relative", width: "52px", height: "52px" }}>
                      <input
                        type="color"
                        value={accentColor}
                        onChange={(e) => setAccentColor(e.target.value)}
                        style={{
                          position: "absolute",
                          inset: 0,
                          width: "100%",
                          height: "100%",
                          opacity: 0,
                          cursor: "pointer",
                          border: "none",
                          padding: 0,
                        }}
                        title="アクセントカラーを選択"
                      />
                      <div
                        style={{
                          width: "52px",
                          height: "52px",
                          borderRadius: "12px",
                          background: accentColor,
                          border: `2px solid ${colors.border}`,
                          pointerEvents: "none",
                        }}
                      />
                    </div>
                    <div>
                      <div style={{ fontSize: "14px", color: colors.text, fontWeight: 500 }}>{accentColor.toUpperCase()}</div>
                      <div style={{ fontSize: "11px", color: colors.subText }}>ボタン・ヘッダー・メール</div>
                    </div>
                    <input
                      type="text"
                      className="angelique-input"
                      value={accentColor}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (/^#[0-9a-fA-F]{0,6}$/.test(v)) setAccentColor(v);
                      }}
                      placeholder="#c9a8a3"
                      style={{ width: "110px", fontFamily: "monospace" }}
                    />
                  </div>
                </div>
              </div>

              {/* プリセット */}
              <div style={{ marginTop: "16px" }}>
                <div style={{ fontSize: "11px", color: colors.subText, marginBottom: "8px" }}>プリセット</div>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  {[
                    { label: "くすみピンク", main: "#f3e7e5", accent: "#c9a8a3" },
                    { label: "ラベンダー",   main: "#ede7f6", accent: "#9575cd" },
                    { label: "ミント",       main: "#e8f5e9", accent: "#66bb6a" },
                    { label: "スカイ",       main: "#e3f2fd", accent: "#42a5f5" },
                    { label: "ピーチ",       main: "#fce4ec", accent: "#f48fb1" },
                    { label: "ゴールド",     main: "#fff8e1", accent: "#ffc107" },
                    { label: "モーブ",       main: "#f3e5f5", accent: "#ab47bc" },
                    { label: "モノ",         main: "#fafafa", accent: "#9e9e9e" },
                  ].map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => { setThemeColor(preset.main); setAccentColor(preset.accent); }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        padding: "5px 10px",
                        borderRadius: "20px",
                        border: `1.5px solid ${themeColor === preset.main && accentColor === preset.accent ? preset.accent : colors.border}`,
                        background: preset.main,
                        cursor: "pointer",
                        fontSize: "11px",
                        color: "#4a3b38",
                        transition: "all 0.15s",
                      }}
                    >
                      <span
                        style={{
                          width: "12px",
                          height: "12px",
                          borderRadius: "50%",
                          background: preset.accent,
                          flexShrink: 0,
                        }}
                      />
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <button type="submit" className="angelique-btn" disabled={savingBrand}>
              {savingBrand ? "保存中..." : "ブランド設定を保存する"}
            </button>
          </form>
        </div>

        {/* STORES URLs */}
        <div className="angelique-card p-6 mb-6">
          <h2 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "20px", color: colors.text, marginBottom: "6px" }}>
            ✦ STORES 延長商品URL
          </h2>
          <p style={{ fontSize: "12px", color: colors.subText, marginBottom: "20px" }}>
            お客様に送信する延長用のSTORES商品URLを設定してください。
            鑑定方法（チャット・音声）に応じて自動的に対応するURLが使用されます。
          </p>
          <form onSubmit={handleSaveUrls}>
            <div style={{ background: colors.main, border: `1px solid ${colors.border}`, borderRadius: "10px", padding: "16px", marginBottom: "16px" }}>
              <div style={{ fontSize: "13px", fontWeight: 600, color: colors.text, marginBottom: "12px" }}>💬 チャット鑑定</div>
              <div className="mb-4">
                <label className="angelique-label">10分延長URL</label>
                <input type="url" className="angelique-input" value={chatUrl10} onChange={(e) => setChatUrl10(e.target.value)} placeholder="https://stores.jp/..." />
              </div>
              <div>
                <label className="angelique-label">30分延長URL</label>
                <input type="url" className="angelique-input" value={chatUrl30} onChange={(e) => setChatUrl30(e.target.value)} placeholder="https://stores.jp/..." />
              </div>
            </div>

            <div style={{ background: colors.main, border: `1px solid ${colors.border}`, borderRadius: "10px", padding: "16px", marginBottom: "20px" }}>
              <div style={{ fontSize: "13px", fontWeight: 600, color: colors.text, marginBottom: "12px" }}>🎙 音声鑑定</div>
              <div className="mb-4">
                <label className="angelique-label">10分延長URL</label>
                <input type="url" className="angelique-input" value={voiceUrl10} onChange={(e) => setVoiceUrl10(e.target.value)} placeholder="https://stores.jp/..." />
              </div>
              <div>
                <label className="angelique-label">30分延長URL</label>
                <input type="url" className="angelique-input" value={voiceUrl30} onChange={(e) => setVoiceUrl30(e.target.value)} placeholder="https://stores.jp/..." />
              </div>
            </div>

            <button type="submit" className="angelique-btn" disabled={savingUrls}>
              {savingUrls ? "保存中..." : "URLを保存する"}
            </button>
          </form>
        </div>

        {/* Password Change */}
        <div className="angelique-card p-6 mb-6">
          <h2 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "20px", color: colors.text, marginBottom: "6px" }}>
            ✦ パスワード変更
          </h2>
          <p style={{ fontSize: "12px", color: colors.subText, marginBottom: "20px" }}>
            管理者ログインパスワードを変更します
          </p>
          <form onSubmit={handleChangePassword}>
            <div className="mb-4">
              <label className="angelique-label">現在のパスワード</label>
              <input type="password" className="angelique-input" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
            </div>
            <div className="mb-4">
              <label className="angelique-label">新しいパスワード（6文字以上）</label>
              <input type="password" className="angelique-input" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={6} />
            </div>
            <div className="mb-6">
              <label className="angelique-label">新しいパスワード（確認）</label>
              <input type="password" className="angelique-input" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
            </div>
            <button type="submit" className="angelique-btn" disabled={savingPassword}>
              {savingPassword ? "変更中..." : "パスワードを変更する"}
            </button>
          </form>
        </div>

        {/* SendGrid Info */}
        <div className="angelique-card p-6">
          <h2 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "20px", color: colors.text, marginBottom: "6px" }}>
            ✦ メール設定（SendGrid）
          </h2>
          <p style={{ fontSize: "12px", color: colors.subText, marginBottom: "16px" }}>
            メール送信にはSendGridのAPIキーが必要です。
          </p>
          <div style={{ background: colors.main, border: `1px solid ${colors.border}`, borderRadius: "12px", padding: "14px", fontSize: "12px", color: colors.text, lineHeight: 1.8 }}>
            <strong>必要な環境変数：</strong><br />
            • SENDGRID_API_KEY — SendGridのAPIキー<br />
            • SENDGRID_FROM_EMAIL — 送信元メールアドレス<br />
            • SENDGRID_FROM_NAME — 送信者名（省略可）
          </div>
        </div>
      </div>
    </div>
  );
}
