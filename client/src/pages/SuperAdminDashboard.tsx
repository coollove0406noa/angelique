import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { resolveColors } from "@/contexts/BrandContext";
import SuperAdminLogin from "./SuperAdminLogin";

type FortuneTeller = {
  id: number;
  slug: string;
  brandName: string;
  themeColor: string;
  isActive: boolean;
  createdAt: Date;
};

const PRESETS = [
  { label: "くすみピンク", main: "#f3e7e5", accent: "#c9a8a3" },
  { label: "ラベンダー",   main: "#ede7f6", accent: "#9575cd" },
  { label: "ミント",       main: "#e8f5e9", accent: "#66bb6a" },
  { label: "スカイ",       main: "#e3f2fd", accent: "#42a5f5" },
  { label: "ピーチ",       main: "#fce4ec", accent: "#f48fb1" },
  { label: "ゴールド",     main: "#fff8e1", accent: "#ffc107" },
  { label: "モーブ",       main: "#f3e5f5", accent: "#ab47bc" },
  { label: "モノ",         main: "#fafafa", accent: "#9e9e9e" },
];

function ColorPickerInline({
  main, accent, onChangeMain, onChangeAccent,
}: {
  main: string; accent: string;
  onChangeMain: (v: string) => void;
  onChangeAccent: (v: string) => void;
}) {
  return (
    <div>
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "10px" }}>
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => { onChangeMain(p.main); onChangeAccent(p.accent); }}
            style={{
              display: "flex", alignItems: "center", gap: "5px",
              padding: "4px 10px", borderRadius: "20px",
              border: `1.5px solid ${main === p.main && accent === p.accent ? p.accent : "#d4bfbb"}`,
              background: p.main, cursor: "pointer", fontSize: "11px", color: "#4a3b38",
            }}
          >
            <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: p.accent, flexShrink: 0 }} />
            {p.label}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: "11px", color: "#9e8480", marginBottom: "4px" }}>メインカラー</div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <div style={{ position: "relative", width: "36px", height: "36px" }}>
              <input type="color" value={main} onChange={(e) => onChangeMain(e.target.value)}
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer", border: "none", padding: 0 }} />
              <div style={{ width: "36px", height: "36px", borderRadius: "8px", background: main, border: "1.5px solid #d4bfbb", pointerEvents: "none" }} />
            </div>
            <input type="text" value={main}
              onChange={(e) => { if (/^#[0-9a-fA-F]{0,6}$/.test(e.target.value)) onChangeMain(e.target.value); }}
              style={{ width: "90px", padding: "5px 8px", borderRadius: "8px", border: "1.5px solid #d4bfbb", fontSize: "12px", fontFamily: "monospace", background: "#fafafa" }} />
          </div>
        </div>
        <div>
          <div style={{ fontSize: "11px", color: "#9e8480", marginBottom: "4px" }}>アクセントカラー</div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <div style={{ position: "relative", width: "36px", height: "36px" }}>
              <input type="color" value={accent} onChange={(e) => onChangeAccent(e.target.value)}
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer", border: "none", padding: 0 }} />
              <div style={{ width: "36px", height: "36px", borderRadius: "8px", background: accent, border: "1.5px solid #d4bfbb", pointerEvents: "none" }} />
            </div>
            <input type="text" value={accent}
              onChange={(e) => { if (/^#[0-9a-fA-F]{0,6}$/.test(e.target.value)) onChangeAccent(e.target.value); }}
              style={{ width: "90px", padding: "5px 8px", borderRadius: "8px", border: "1.5px solid #d4bfbb", fontSize: "12px", fontFamily: "monospace", background: "#fafafa" }} />
          </div>
        </div>
      </div>
    </div>
  );
}

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
    slug: "", brandName: "", password: "",
    themeColor: "#f3e7e5", accentColor: "#c9a8a3",
    storesUrlChatMin10: "", storesUrlChatMin30: "",
    storesUrlVoiceMin10: "", storesUrlVoiceMin30: "",
  });
  const [testEmailTarget, setTestEmailTarget] = useState<{ id: number; brandName: string } | null>(null);
  const [testEmailAddress, setTestEmailAddress] = useState("");

  const [editForm, setEditForm] = useState({
    brandName: "", themeColor: "#f3e7e5", accentColor: "#c9a8a3",
    isActive: true, newPassword: "",
  });

  const logoutMutation = trpc.superAdmin.logout.useMutation({ onSuccess: () => refetchAuth() });

  const createMutation = trpc.superAdmin.createFortuneTeller.useMutation({
    onSuccess: (data) => {
      toast.success(`${createForm.brandName}（/${data.slug}）を作成しました`);
      setShowCreateForm(false);
      setCreateForm({ slug: "", brandName: "", password: "", themeColor: "#f3e7e5", accentColor: "#c9a8a3", storesUrlChatMin10: "", storesUrlChatMin30: "", storesUrlVoiceMin10: "", storesUrlVoiceMin30: "" });
      refetchFt();
    },
    onError: (e) => toast.error(e.message),
  });

  const testEmailMutation = trpc.superAdmin.sendTestEmail.useMutation({
    onSuccess: () => {
      toast.success("テストメールを送信しました");
      setTestEmailTarget(null);
      setTestEmailAddress("");
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
    const c = resolveColors(ft.themeColor);
    setEditForm({ brandName: ft.brandName, themeColor: c.main, accentColor: c.accent, isActive: ft.isActive, newPassword: "" });
    setShowEditForm(true);
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!createForm.slug || !createForm.brandName || !createForm.password) {
      toast.error("必須項目を入力してください"); return;
    }
    createMutation.mutate({
      slug: createForm.slug,
      brandName: createForm.brandName,
      password: createForm.password,
      themeColor: createForm.themeColor,
      accentColor: createForm.accentColor,
      storesUrlChatMin10: createForm.storesUrlChatMin10 || undefined,
      storesUrlChatMin30: createForm.storesUrlChatMin30 || undefined,
      storesUrlVoiceMin10: createForm.storesUrlVoiceMin10 || undefined,
      storesUrlVoiceMin30: createForm.storesUrlVoiceMin30 || undefined,
    });
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
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#f3e7e5" }}>
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
          <button className="angelique-btn" onClick={() => setShowCreateForm(true)}>
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
            const c = resolveColors(ft.themeColor);
            return (
              <div
                key={ft.id}
                className="angelique-card p-5"
                style={{ borderLeft: `4px solid ${c.accent}`, opacity: ft.isActive ? 1 : 0.6 }}
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div style={{ width: "36px", height: "36px", borderRadius: "50%", background: c.accent, flexShrink: 0, border: `3px solid ${c.border}` }} />
                    <div>
                      <div className="flex items-center gap-2">
                        <span style={{ fontSize: "16px", fontWeight: 500, color: "#6b5b58" }}>{ft.brandName}</span>
                        {!ft.isActive && (
                          <span style={{ fontSize: "10px", padding: "2px 8px", borderRadius: "8px", background: "#f5f5f5", color: "#9e9e9e", border: "1px solid #e0e0e0" }}>無効</span>
                        )}
                      </div>
                      <div style={{ fontSize: "12px", color: "#9e8480", marginTop: "2px", display: "flex", alignItems: "center", gap: "6px" }}>
                        /admin/<strong>{ft.slug}</strong>
                        <span style={{ display: "inline-block", width: "12px", height: "12px", borderRadius: "50%", background: c.main, border: `2px solid ${c.accent}`, verticalAlign: "middle" }} />
                        <span style={{ display: "inline-block", width: "12px", height: "12px", borderRadius: "50%", background: c.accent, border: `2px solid ${c.border}`, verticalAlign: "middle" }} />
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2 flex-wrap">
                    <button className="angelique-btn-outline" style={{ padding: "6px 14px", fontSize: "12px" }} onClick={() => navigate(`/admin/${ft.slug}`)}>
                      管理画面へ
                    </button>
                    <button className="angelique-btn-outline" style={{ padding: "6px 14px", fontSize: "12px" }} onClick={() => openEdit(ft as FortuneTeller)}>
                      編集
                    </button>
                    <button
                      className="angelique-btn-outline"
                      style={{ padding: "6px 14px", fontSize: "12px", color: "#42a5f5", borderColor: "#42a5f5" }}
                      onClick={() => { setTestEmailTarget({ id: ft.id, brandName: ft.brandName }); setTestEmailAddress(""); }}
                    >
                      テストメール
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
                <input type="text" className="angelique-input"
                  value={createForm.slug}
                  onChange={(e) => setCreateForm(f => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") }))}
                  placeholder="例：hanako（英小文字・数字・ハイフンのみ）" required />
                {createForm.slug && <p style={{ fontSize: "11px", color: "#9e8480", marginTop: "4px" }}>管理URL: /admin/{createForm.slug}</p>}
              </div>
              <div className="mb-4">
                <label className="angelique-label">ブランド名 *</label>
                <input type="text" className="angelique-input" value={createForm.brandName}
                  onChange={(e) => setCreateForm(f => ({ ...f, brandName: e.target.value }))} placeholder="例：花子占い" required />
              </div>
              <div className="mb-4">
                <label className="angelique-label">初期パスワード *</label>
                <input type="password" className="angelique-input" value={createForm.password}
                  onChange={(e) => setCreateForm(f => ({ ...f, password: e.target.value }))} placeholder="6文字以上" minLength={6} required />
              </div>
              <div className="mb-6">
                <label className="angelique-label">テーマカラー</label>
                <div className="mt-2">
                  <ColorPickerInline
                    main={createForm.themeColor} accent={createForm.accentColor}
                    onChangeMain={(v) => setCreateForm(f => ({ ...f, themeColor: v }))}
                    onChangeAccent={(v) => setCreateForm(f => ({ ...f, accentColor: v }))}
                  />
                </div>
              </div>
              <div className="mb-4">
                <label className="angelique-label" style={{ fontWeight: 600, color: "#6b5b58" }}>STORES 延長URL（任意）</label>
                <p style={{ fontSize: "11px", color: "#9e8480", marginBottom: "8px" }}>後から設定画面でも変更できます。</p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                  <div>
                    <label className="angelique-label">チャット 10分URL</label>
                    <input type="url" className="angelique-input" value={createForm.storesUrlChatMin10}
                      onChange={(e) => setCreateForm(f => ({ ...f, storesUrlChatMin10: e.target.value }))} placeholder="https://stores.jp/..." />
                  </div>
                  <div>
                    <label className="angelique-label">チャット 30分URL</label>
                    <input type="url" className="angelique-input" value={createForm.storesUrlChatMin30}
                      onChange={(e) => setCreateForm(f => ({ ...f, storesUrlChatMin30: e.target.value }))} placeholder="https://stores.jp/..." />
                  </div>
                  <div>
                    <label className="angelique-label">音声 10分URL</label>
                    <input type="url" className="angelique-input" value={createForm.storesUrlVoiceMin10}
                      onChange={(e) => setCreateForm(f => ({ ...f, storesUrlVoiceMin10: e.target.value }))} placeholder="https://stores.jp/..." />
                  </div>
                  <div>
                    <label className="angelique-label">音声 30分URL</label>
                    <input type="url" className="angelique-input" value={createForm.storesUrlVoiceMin30}
                      onChange={(e) => setCreateForm(f => ({ ...f, storesUrlVoiceMin30: e.target.value }))} placeholder="https://stores.jp/..." />
                  </div>
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

      {/* Test Email Modal */}
      {testEmailTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(107,91,88,0.25)" }} onClick={(e) => { if (e.target === e.currentTarget) setTestEmailTarget(null); }}>
          <div className="angelique-card p-8 w-full max-w-sm mx-4">
            <h2 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "20px", color: "#6b5b58", marginBottom: "8px" }}>
              テストメール送信
            </h2>
            <p style={{ fontSize: "12px", color: "#9e8480", marginBottom: "20px" }}>
              {testEmailTarget.brandName} からテストメールを送信します。
            </p>
            <div className="mb-6">
              <label className="angelique-label">送信先メールアドレス *</label>
              <input type="email" className="angelique-input" value={testEmailAddress}
                onChange={(e) => setTestEmailAddress(e.target.value)} placeholder="test@example.com" required />
            </div>
            <div className="flex gap-3">
              <button
                className="angelique-btn"
                disabled={testEmailMutation.isPending || !testEmailAddress}
                onClick={() => testEmailMutation.mutate({ fortuneTellerId: testEmailTarget.id, toEmail: testEmailAddress })}
              >
                {testEmailMutation.isPending ? "送信中..." : "送信する"}
              </button>
              <button className="angelique-btn-outline" onClick={() => setTestEmailTarget(null)}>キャンセル</button>
            </div>
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
                <input type="text" className="angelique-input" value={editForm.brandName}
                  onChange={(e) => setEditForm(f => ({ ...f, brandName: e.target.value }))} required />
              </div>
              <div className="mb-4">
                <label className="angelique-label">テーマカラー</label>
                <div className="mt-2">
                  <ColorPickerInline
                    main={editForm.themeColor} accent={editForm.accentColor}
                    onChangeMain={(v) => setEditForm(f => ({ ...f, themeColor: v }))}
                    onChangeAccent={(v) => setEditForm(f => ({ ...f, accentColor: v }))}
                  />
                </div>
              </div>
              <div className="mb-4">
                <label className="angelique-label">新しいパスワード（変更する場合のみ）</label>
                <input type="password" className="angelique-input" value={editForm.newPassword}
                  onChange={(e) => setEditForm(f => ({ ...f, newPassword: e.target.value }))} placeholder="6文字以上" minLength={6} />
              </div>
              <div className="mb-6 flex items-center gap-2">
                <input type="checkbox" id="isActive" checked={editForm.isActive}
                  onChange={(e) => setEditForm(f => ({ ...f, isActive: e.target.checked }))} />
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
