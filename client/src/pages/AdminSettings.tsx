import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import AngeliqueHeader from "@/components/AngeliqueHeader";
import AdminLogin from "./AdminLogin";
import { useAdminAuth } from "@/contexts/AdminAuthContext";

export default function AdminSettings() {
  const { isAuthenticated, isLoading, refetch: refetchAuth } = useAdminAuth();

  // 4種類の延長URL
  const [chatUrl10, setChatUrl10] = useState("");
  const [chatUrl30, setChatUrl30] = useState("");
  const [voiceUrl10, setVoiceUrl10] = useState("");
  const [voiceUrl30, setVoiceUrl30] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingUrls, setSavingUrls] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  const { data: settings } = trpc.settings.list.useQuery(undefined, { enabled: isAuthenticated });
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
  const logoutMutation = trpc.admin.logout.useMutation({ onSuccess: () => refetchAuth() });

  useEffect(() => {
    if (settings) {
      // 新しい4種類のキー。旧キー（stores_url_10min等）からのマイグレーション対応
      setChatUrl10(
        settings.find((s) => s.key === "stores_url_chat_10min")?.value ??
        settings.find((s) => s.key === "stores_url_10min")?.value ?? ""
      );
      setChatUrl30(
        settings.find((s) => s.key === "stores_url_chat_30min")?.value ??
        settings.find((s) => s.key === "stores_url_30min")?.value ?? ""
      );
      setVoiceUrl10(settings.find((s) => s.key === "stores_url_voice_10min")?.value ?? "");
      setVoiceUrl30(settings.find((s) => s.key === "stores_url_voice_30min")?.value ?? "");
    }
  }, [settings]);

  function handleSaveUrls(e: React.FormEvent) {
    e.preventDefault();
    setSavingUrls(true);
    setBulkSettings.mutate([
      { key: "stores_url_chat_10min",  value: chatUrl10,  label: "STORES延長URL（チャット10分）" },
      { key: "stores_url_chat_30min",  value: chatUrl30,  label: "STORES延長URL（チャット30分）" },
      { key: "stores_url_voice_10min", value: voiceUrl10, label: "STORES延長URL（音声10分）" },
      { key: "stores_url_voice_30min", value: voiceUrl30, label: "STORES延長URL（音声30分）" },
    ]);
  }

  function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error("新しいパスワードが一致しません");
      return;
    }
    if (newPassword.length < 6) {
      toast.error("パスワードは6文字以上で設定してください");
      return;
    }
    setSavingPassword(true);
    changePassword.mutate({ currentPassword, newPassword });
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#f9f5f4" }}>
        <div style={{ color: "#9e8480" }}>読み込み中...</div>
      </div>
    );
  }
  if (!isAuthenticated) return <AdminLogin onSuccess={refetchAuth} />;

  return (
    <div className="min-h-screen" style={{ background: "#f9f5f4" }}>
      <AngeliqueHeader isAdmin onLogout={() => logoutMutation.mutate()} />

      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "28px", color: "#6b5b58", fontWeight: 400 }}>
            設定
          </h1>
          <p style={{ fontSize: "13px", color: "#9e8480", marginTop: "4px" }}>
            延長URL・パスワードなどの設定を管理します
          </p>
        </div>

        {/* STORES URLs */}
        <div className="angelique-card p-6 mb-6">
          <h2 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "20px", color: "#6b5b58", marginBottom: "6px" }}>
            ✦ STORES 延長商品URL
          </h2>
          <p style={{ fontSize: "12px", color: "#9e8480", marginBottom: "20px" }}>
            お客様に送信する延長用のSTORES商品URLを設定してください。
            鑑定方法（チャット・音声）に応じて自動的に対応するURLが使用されます。
          </p>
          <form onSubmit={handleSaveUrls}>
            {/* チャット鑑定 */}
            <div
              style={{
                background: "#f9f5f4",
                border: "1px solid #d4bfbb",
                borderRadius: "10px",
                padding: "16px",
                marginBottom: "16px",
              }}
            >
              <div style={{ fontSize: "13px", fontWeight: 600, color: "#6b5b58", marginBottom: "12px" }}>
                💬 チャット鑑定
              </div>
              <div className="mb-4">
                <label className="angelique-label">10分延長URL</label>
                <input
                  type="url"
                  className="angelique-input"
                  value={chatUrl10}
                  onChange={(e) => setChatUrl10(e.target.value)}
                  placeholder="https://stores.jp/..."
                />
              </div>
              <div>
                <label className="angelique-label">30分延長URL</label>
                <input
                  type="url"
                  className="angelique-input"
                  value={chatUrl30}
                  onChange={(e) => setChatUrl30(e.target.value)}
                  placeholder="https://stores.jp/..."
                />
              </div>
            </div>

            {/* 音声鑑定 */}
            <div
              style={{
                background: "#f9f5f4",
                border: "1px solid #d4bfbb",
                borderRadius: "10px",
                padding: "16px",
                marginBottom: "20px",
              }}
            >
              <div style={{ fontSize: "13px", fontWeight: 600, color: "#6b5b58", marginBottom: "12px" }}>
                🎙 音声鑑定
              </div>
              <div className="mb-4">
                <label className="angelique-label">10分延長URL</label>
                <input
                  type="url"
                  className="angelique-input"
                  value={voiceUrl10}
                  onChange={(e) => setVoiceUrl10(e.target.value)}
                  placeholder="https://stores.jp/..."
                />
              </div>
              <div>
                <label className="angelique-label">30分延長URL</label>
                <input
                  type="url"
                  className="angelique-input"
                  value={voiceUrl30}
                  onChange={(e) => setVoiceUrl30(e.target.value)}
                  placeholder="https://stores.jp/..."
                />
              </div>
            </div>

            <button type="submit" className="angelique-btn" disabled={savingUrls}>
              {savingUrls ? "保存中..." : "URLを保存する"}
            </button>
          </form>
        </div>

        {/* Password Change */}
        <div className="angelique-card p-6 mb-6">
          <h2 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "20px", color: "#6b5b58", marginBottom: "6px" }}>
            ✦ パスワード変更
          </h2>
          <p style={{ fontSize: "12px", color: "#9e8480", marginBottom: "20px" }}>
            管理者ログインパスワードを変更します
          </p>
          <form onSubmit={handleChangePassword}>
            <div className="mb-4">
              <label className="angelique-label">現在のパスワード</label>
              <input
                type="password"
                className="angelique-input"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
            </div>
            <div className="mb-4">
              <label className="angelique-label">新しいパスワード（6文字以上）</label>
              <input
                type="password"
                className="angelique-input"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>
            <div className="mb-6">
              <label className="angelique-label">新しいパスワード（確認）</label>
              <input
                type="password"
                className="angelique-input"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </div>
            <button type="submit" className="angelique-btn" disabled={savingPassword}>
              {savingPassword ? "変更中..." : "パスワードを変更する"}
            </button>
          </form>
        </div>

        {/* SendGrid Info */}
        <div className="angelique-card p-6">
          <h2 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "20px", color: "#6b5b58", marginBottom: "6px" }}>
            ✦ メール設定（SendGrid）
          </h2>
          <p style={{ fontSize: "12px", color: "#9e8480", marginBottom: "16px" }}>
            メール送信にはSendGridのAPIキーが必要です。
            環境変数 <code style={{ background: "#f3e7e5", padding: "2px 6px", borderRadius: "4px", fontSize: "11px" }}>SENDGRID_API_KEY</code> と{" "}
            <code style={{ background: "#f3e7e5", padding: "2px 6px", borderRadius: "4px", fontSize: "11px" }}>SENDGRID_FROM_EMAIL</code> を設定してください。
          </p>
          <div
            style={{
              background: "#f9f5f4",
              border: "1px solid #d4bfbb",
              borderRadius: "12px",
              padding: "14px",
              fontSize: "12px",
              color: "#6b5b58",
              lineHeight: 1.8,
            }}
          >
            <strong>必要な環境変数：</strong><br />
            • SENDGRID_API_KEY — SendGridのAPIキー<br />
            • SENDGRID_FROM_EMAIL — 送信元メールアドレス<br />
            • SENDGRID_FROM_NAME — 送信者名（省略可、デフォルト: angelique）
          </div>
        </div>
      </div>
    </div>
  );
}
