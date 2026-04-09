import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import AngeliqueHeader from "@/components/AngeliqueHeader";
import AdminLogin from "./AdminLogin";
import { useAdminAuth } from "@/contexts/AdminAuthContext";

export default function AdminSettings() {
  const { isAuthenticated, isLoading, refetch: refetchAuth } = useAdminAuth();

  const [storesUrl10, setStoresUrl10] = useState("");
  const [storesUrl20, setStoresUrl20] = useState("");
  const [storesUrl30, setStoresUrl30] = useState("");
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
      setStoresUrl10(settings.find((s) => s.key === "stores_url_10min")?.value ?? "");
      setStoresUrl20(settings.find((s) => s.key === "stores_url_20min")?.value ?? "");
      setStoresUrl30(settings.find((s) => s.key === "stores_url_30min")?.value ?? "");
    }
  }, [settings]);

  function handleSaveUrls(e: React.FormEvent) {
    e.preventDefault();
    setSavingUrls(true);
    setBulkSettings.mutate([
      { key: "stores_url_10min", value: storesUrl10, label: "STORES延長URL（10分）" },
      { key: "stores_url_20min", value: storesUrl20, label: "STORES延長URL（20分）" },
      { key: "stores_url_30min", value: storesUrl30, label: "STORES延長URL（30分）" },
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
            管理者チャット画面の「時間を延長する」ボタンから自動送信されます。
          </p>
          <form onSubmit={handleSaveUrls}>
            <div className="mb-4">
              <label className="angelique-label">10分延長URL</label>
              <input
                type="url"
                className="angelique-input"
                value={storesUrl10}
                onChange={(e) => setStoresUrl10(e.target.value)}
                placeholder="https://stores.jp/..."
              />
            </div>
            <div className="mb-4">
              <label className="angelique-label">20分延長URL</label>
              <input
                type="url"
                className="angelique-input"
                value={storesUrl20}
                onChange={(e) => setStoresUrl20(e.target.value)}
                placeholder="https://stores.jp/..."
              />
            </div>
            <div className="mb-6">
              <label className="angelique-label">30分延長URL</label>
              <input
                type="url"
                className="angelique-input"
                value={storesUrl30}
                onChange={(e) => setStoresUrl30(e.target.value)}
                placeholder="https://stores.jp/..."
              />
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
