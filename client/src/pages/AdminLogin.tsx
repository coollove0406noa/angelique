import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useBrand } from "@/contexts/BrandContext";

interface AdminLoginProps {
  slug: string;
  onSuccess: () => void;
}

export default function AdminLogin({ slug }: AdminLoginProps) {
  const [password, setPassword] = useState("");
  const { brandName, colors } = useBrand();

  const loginMutation = trpc.admin.login.useMutation({
    onSuccess: () => {
      window.location.replace(`/admin/${slug}`);
    },
    onError: () => {
      toast.error("パスワードが違います");
    },
  });

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    loginMutation.mutate({ slug, password });
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: colors.main }}
    >
      <div
        className="angelique-card p-10 w-full max-w-sm"
        style={{ textAlign: "center" }}
      >
        {/* Logo / Brand */}
        <div
          style={{
            fontFamily: "'Cormorant Garamond', serif",
            fontSize: "28px",
            fontWeight: 400,
            color: colors.accent,
            letterSpacing: "3px",
            marginBottom: "4px",
          }}
        >
          ✦ {brandName}
        </div>
        <div
          style={{
            fontSize: "12px",
            color: colors.subText,
            marginBottom: "32px",
            letterSpacing: "1px",
          }}
        >
          管理者ログイン
        </div>

        <form onSubmit={handleLogin}>
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
            disabled={loginMutation.isPending || !password.trim()}
            style={{
              width: "100%",
              justifyContent: "center",
              background: colors.accent,
              borderColor: colors.accent,
            }}
          >
            {loginMutation.isPending ? "確認中..." : "ログイン"}
          </button>
        </form>
      </div>
    </div>
  );
}
