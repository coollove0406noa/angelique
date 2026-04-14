import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { THEME_COLOR_KEYS, THEME_COLOR_LABELS, THEME_COLOR_MAP } from "@/contexts/BrandContext";
import SuperAdminLogin from "./SuperAdminLogin";

type FortuneTeller = {
  id: number;
  slug: string;
  brandName: string;
  themeColor: string;
  isActive: boolean;
  createdAt: Date;
};

export default function SuperAdminDashboard() {
  const [, navigate] = useLocation();

  const { data: authCheck, isLoading: authLoading, refetch: refetchAuth } = trpc.superAdmin.check.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  const { data: fortuneTellers = [], refetch: refetchFt } = trpc.superAdmin.listFortuneTellers.useQuery(undefined, {
    enabled: authCheck?.authenticated === true,
  });

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);
  const [editingFt, setEditingFt] = useState<FortuneTeller | null>(null);

  const [createForm, setCreateForm] = useState({
    slug: "",
    brandName: "",
    password: "",
    themeColor: "dusty-pink",
  });

  const [editForm, setEditForm] = useState({
    brandName: "",
    themeColor: "dusty-pink",
    isActive: true,
    newPassword: "",
  });

  const logoutMutation = trpc.superAdmin.logout.useMutation({
    onSuccess: () => refetchAuth(),
  });

  const createMutation = trpc.superAdmin.createFortuneTeller.useMutation({
    onSuccess: (data) => {
      toast.success(`${createForm.brandName}（/${data.slug}）を作成しました`);
      setShowCreateForm(false);
      setCreateForm({ slug: "", brandName: "", password: "", themeColor: "dusty-pink" });
      refetchFt();
    },
    onError: (e) => toast.error(e.message),
  });

  const updateMutation = trpc.superAdmin.updateFortuneTeller.useMutation({
    onSuccess: () => {
      toast.success("更新しました");
      setShowEditForm(false);
      setEditingFt(null);
      refetchFt();
    },
    onError: (e) => toast.error(e.message),
  });

  function openEdit(ft: FortuneTeller) {
    setEditingFt(ft);
    setEditForm({ brandName: ft.brandName, themeColor: ft.themeColor, isActive: ft.isActive, newPassword: "" });
    setShowEditForm(true);
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!createForm.slug || !createForm.brandName || !createForm.password) {
      toast.error("必須項目を入力してください");
      return;
    }
    createMutation.mutate(createForm);
  }

  function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    if (!editingFt) return;
    updateMutation.mutate({
      id: editingFt.id,
      brandName: editForm.brandName,
      themeColor: editForm.themeColor,
      isActive: editForm.isActive,
      newPassword: editForm.newPassword || undefined,
    });
  }

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#f9f5f4" }}>
        <div style={{ color: "#9e8480" }}>読み込み中...</div>
      </div>
    );
  }

  if (!authCheck?.authenticated) return <SuperAdminLogin />;

  return (
    <div className="min-h-screen" style={{ background: "#f9f5f4" }}>
      {/* Header */}
      <header style={{ background: "#ffffff", borderBottom: "1px solid #d4bfbb", boxShadow: "0 2px 12px rgba(107,91,88,0.06)" }} className="sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "22px", color: "#9e8480", letterSpacing: "2px" }}>
            ✦ スーパー管理者
          </span>
          <button
            onClick={() => logoutMutation.mutate()}
            style={{ fontSize: "13px", color: "#9e8480", padding: "6px 16px", borderRadius: "20px", background: "transparent", border: "1px solid #d4bfbb", cursor: "pointer" }}
          >
            ログアウト
          </button>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "28px", color: "#6b5b58", fontWeight: 400 }}>
              占い師アカウント管理
            </h1>
            <p style={{ fontSize: "13px", color: "#9e8480", marginTop: "4px" }}>
              占い師アカウントの作成・編集・有効/無効の管理
            </p>
          </div>
          <button
            className="angelique-btn"
            onClick={() => setShowCreateForm(true)}
          >
            ✦ 新規アカウント作成
          </button>
        </div>

        {/* Fortune Teller List */}
        <div className="grid gap-4">
          {fortuneTellers.length === 0 && (
            <div className="angelique-card p-12 text-center">
              <div style={{ fontSize: "32px", marginBottom: "8px" }}>✦</div>
              <p style={{ color: "#9e8480" }}>アカウントがありません</p>
            </div>
          )}
          {fortuneTellers.map((ft) => {
            const colors = THEME_COLOR_MAP[ft.themeColor as keyof typeof THEME_COLOR_MAP] ?? THEME_COLOR_MAP["dusty-pink"];
            return (
              <div
                key={ft.id}
                className="angelique-card p-5"
                style={{ borderLeft: `4px solid ${colors.accent}`, opacity: ft.isActive ? 1 : 0.6 }}
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    {/* Color swatch */}
                    <div style={{ width: "36px", height: "36px", borderRadius: "50%", background: colors.accent, flexShrink: 0, border: `3px solid ${colors.border}` }} />
                    <div>
                      <div className="flex items-center gap-2">
                        <span style={{ fontSize: "16px", fontWeight: 500, color: "#6b5b58" }}>{ft.brandName}</span>
                        {!ft.isActive && (
                          <span style={{ fontSize: "10px", padding: "2px 8px", borderRadius: "8px", background: "#f5f5f5", color: "#9e9e9e", border: "1px solid #e0e0e0" }}>無効</span>
                        )}
                      </div>
                      <div style={{ fontSize: "12px", color: "#9e8480", marginTop: "2px" }}>
                        /admin/<strong>{ft.slug}</strong> · {THEME_COLOR_LABELS[ft.themeColor as keyof typeof THEME_COLOR_LABELS] ?? ft.themeColor}
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      className="angelique-btn-outline"
                      style={{ padding: "6px 14px", fontSize: "12px" }}
                      onClick={() => navigate(`/admin/${ft.slug}`)}
                    >
                      管理画面へ
                    </button>
                    <button
                      className="angelique-btn-outline"
                      style={{ padding: "6px 14px", fontSize: "12px" }}
                      onClick={() => openEdit(ft as FortuneTeller)}
                    >
                      編集
                    </button>
                    <button
                      className="angelique-btn-outline"
                      style={{ padding: "6px 14px", fontSize: "12px", color: ft.isActive ? "#e57373" : "#388e3c", borderColor: ft.isActive ? "#e57373" : "#388e3c" }}
                      onClick={() => updateMutation.mutate({ id: ft.id, isActive: !ft.isActive })}
                    >
                      {ft.isActive ? "無効化" : "有効化"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Create Modal */}
      {showCreateForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(107,91,88,0.25)" }} onClick={(e) => { if (e.target === e.currentTarget) setShowCreateForm(false); }}>
          <div className="angelique-card p-8 w-full max-w-md mx-4 overflow-y-auto max-h-[90vh]">
            <h2 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "22px", color: "#6b5b58", marginBottom: "20px" }}>
              新規占い師アカウント作成
            </h2>
            <form onSubmit={handleCreate}>
              <div className="mb-4">
                <label className="angelique-label">スラッグ（URLに使用）*</label>
                <input type="text" className="angelique-input" value={createForm.slug} onChange={(e) => setCreateForm(f => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") }))} placeholder="例：hanako（英小文字・数字・ハイフンのみ）" required />
                {createForm.slug && <p style={{ fontSize: "11px", color: "#9e8480", marginTop: "4px" }}>管理URL: /admin/{createForm.slug}</p>}
              </div>
              <div className="mb-4">
                <label className="angelique-label">ブランド名 *</label>
                <input type="text" className="angelique-input" value={createForm.brandName} onChange={(e) => setCreateForm(f => ({ ...f, brandName: e.target.value }))} placeholder="例：花子占い" required />
              </div>
              <div className="mb-4">
                <label className="angelique-label">初期パスワード *</label>
                <input type="password" className="angelique-input" value={createForm.password} onChange={(e) => setCreateForm(f => ({ ...f, password: e.target.value }))} placeholder="6文字以上" minLength={6} required />
              </div>
              <div className="mb-6">
                <label className="angelique-label">テーマカラー</label>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  {THEME_COLOR_KEYS.map((key) => {
                    const c = THEME_COLOR_MAP[key];
                    const isSelected = createForm.themeColor === key;
                    return (
                      <label key={key} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 12px", borderRadius: "10px", border: isSelected ? `2px solid ${c.accent}` : "1.5px solid #d4bfbb", background: isSelected ? c.main : "#fff", cursor: "pointer", fontSize: "12px" }}>
                        <input type="radio" name="createTheme" value={key} checked={isSelected} onChange={() => setCreateForm(f => ({ ...f, themeColor: key }))} style={{ accentColor: c.accent }} />
                        <div style={{ width: "14px", height: "14px", borderRadius: "50%", background: c.accent, flexShrink: 0 }} />
                        <span style={{ color: c.text }}>{THEME_COLOR_LABELS[key]}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
              <div className="flex gap-3">
                <button type="submit" className="angelique-btn" disabled={createMutation.isPending}>{createMutation.isPending ? "作成中..." : "作成する"}</button>
                <button type="button" className="angelique-btn-outline" onClick={() => setShowCreateForm(false)}>キャンセル</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {showEditForm && editingFt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(107,91,88,0.25)" }} onClick={(e) => { if (e.target === e.currentTarget) setShowEditForm(false); }}>
          <div className="angelique-card p-8 w-full max-w-md mx-4 overflow-y-auto max-h-[90vh]">
            <h2 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "22px", color: "#6b5b58", marginBottom: "20px" }}>
              {editingFt.brandName} の編集
            </h2>
            <form onSubmit={handleUpdate}>
              <div className="mb-4">
                <label className="angelique-label">ブランド名</label>
                <input type="text" className="angelique-input" value={editForm.brandName} onChange={(e) => setEditForm(f => ({ ...f, brandName: e.target.value }))} required />
              </div>
              <div className="mb-4">
                <label className="angelique-label">テーマカラー</label>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  {THEME_COLOR_KEYS.map((key) => {
                    const c = THEME_COLOR_MAP[key];
                    const isSelected = editForm.themeColor === key;
                    return (
                      <label key={key} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 12px", borderRadius: "10px", border: isSelected ? `2px solid ${c.accent}` : "1.5px solid #d4bfbb", background: isSelected ? c.main : "#fff", cursor: "pointer", fontSize: "12px" }}>
                        <input type="radio" name="editTheme" value={key} checked={isSelected} onChange={() => setEditForm(f => ({ ...f, themeColor: key }))} style={{ accentColor: c.accent }} />
                        <div style={{ width: "14px", height: "14px", borderRadius: "50%", background: c.accent, flexShrink: 0 }} />
                        <span style={{ color: c.text }}>{THEME_COLOR_LABELS[key]}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
              <div className="mb-4">
                <label className="angelique-label">新しいパスワード（変更する場合のみ）</label>
                <input type="password" className="angelique-input" value={editForm.newPassword} onChange={(e) => setEditForm(f => ({ ...f, newPassword: e.target.value }))} placeholder="6文字以上" minLength={6} />
              </div>
              <div className="mb-6 flex items-center gap-2">
                <input type="checkbox" id="isActive" checked={editForm.isActive} onChange={(e) => setEditForm(f => ({ ...f, isActive: e.target.checked }))} style={{ accentColor: "#c9a8a3" }} />
                <label htmlFor="isActive" style={{ fontSize: "13px", color: "#6b5b58", cursor: "pointer" }}>アカウントを有効にする</label>
              </div>
              <div className="flex gap-3">
                <button type="submit" className="angelique-btn" disabled={updateMutation.isPending}>{updateMutation.isPending ? "更新中..." : "更新する"}</button>
                <button type="button" className="angelique-btn-outline" onClick={() => { setShowEditForm(false); setEditingFt(null); }}>キャンセル</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
