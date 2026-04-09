import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

interface AdminLoginProps {
  onSuccess: () => void;
}

export default function AdminLogin({ onSuccess }: AdminLoginProps) {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const loginMutation = trpc.admin.login.useMutation({
    onSuccess: (data) => {
      if (data.firstSetup) {
        toast.success("初回セットアップ完了。このパスワードで管理者ログインできます。");
      } else {
        toast.success("ログインしました");
      }
      onSuccess();
    },
    onError: (err) => {
      toast.error(err.message || "ログインに失敗しました");
      setLoading(false);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;
    setLoading(true);
    loginMutation.mutate({ password });
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: "#f9f5f4" }}
    >
      <div
        className="angelique-card p-10 w-full max-w-sm"
        style={{ textAlign: "center" }}
      >
        {/* Logo */}
        <div
          style={{
            fontFamily: "'Cormorant Garamond', serif",
            fontSize: "32px",
            fontWeight: 400,
            color: "#c9a8a3",
            letterSpacing: "3px",
            marginBottom: "4px",
          }}
        >
          ✦ angelique
        </div>
        <div
          style={{
            fontSize: "12px",
            color: "#9e8480",
            marginBottom: "32px",
            letterSpacing: "1px",
          }}
        >
          管理者ログイン
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: "20px", textAlign: "left" }}>
            <label className="angelique-label">パスワード</label>
            <input
              type="password"
              className="angelique-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="パスワードを入力"
              autoFocus
            />
          </div>
          <button
            type="submit"
            className="angelique-btn w-full justify-center"
            disabled={loading || !password.trim()}
            style={{ width: "100%", justifyContent: "center" }}
          >
            {loading ? "確認中..." : "ログイン"}
          </button>
        </form>

        <p
          style={{
            fontSize: "11px",
            color: "#9e8480",
            marginTop: "20px",
            lineHeight: 1.6,
          }}
        >
          初回アクセス時は任意のパスワードを設定してください。
        </p>
      </div>
    </div>
  );
}
