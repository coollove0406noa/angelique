import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import AngeliqueHeader from "@/components/AngeliqueHeader";
import AdminLogin from "./AdminLogin";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { useBrand } from "@/contexts/BrandContext";
import { THEME_COLOR_KEYS, THEME_COLOR_LABELS, THEME_COLOR_MAP } from "@/contexts/BrandContext";
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
  const [themeColor, setThemeColor] = useState(fortuneTeller?.themeColor ?? "dusty-pink");
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
      setThemeColor(fortuneTeller.themeColor);
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
    updateBrand.mutate({ slug, brandName, themeColor });
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
              <p style={{ fontSize: "11px", color: colors.subText, marginBottom: "12px" }}>
                選んだカラーがヘッダー・ボタン・吹き出しの色に反映されます
              </p>
              <div className="grid grid-cols-2 gap-3">
                {THEME_COLOR_KEYS.map((key) => {
                  const c = THEME_COLOR_MAP[key];
                  const isSelected = themeColor === key;
                  return (
                    <label
                      key={key}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        padding: "10px 14px",
                        borderRadius: "12px",
                        border: isSelected ? `2px solid ${c.accent}` : `1.5px solid ${colors.border}`,
                        background: isSelected ? c.main : "#ffffff",
                        cursor: "pointer",
                        transition: "all 0.2s",
                      }}
                    >
                      <input
                        type="radio"
                        name="themeColor"
                        value={key}
                        checked={isSelected}
                        onChange={() => setThemeColor(key)}
                        style={{ accentColor: c.accent }}
                      />
                      {/* Color swatch */}
                      <div
                        style={{
                          width: "20px",
                          height: "20px",
                          borderRadius: "50%",
                          background: c.accent,
                          border: `2px solid ${c.border}`,
                          flexShrink: 0,
                        }}
                      />
                      <span style={{ fontSize: "12px", color: c.text, fontWeight: isSelected ? 600 : 400 }}>
                        {THEME_COLOR_LABELS[key]}
                      </span>
                    </label>
                  );
                })}
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
