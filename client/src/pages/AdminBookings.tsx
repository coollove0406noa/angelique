import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import AngeliqueHeader from "@/components/AngeliqueHeader";
import AdminLogin from "./AdminLogin";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { format } from "date-fns";
import { ja } from "date-fns/locale";

type Client = {
  id: number;
  name: string;
  email: string;
  sessionMinutes: number;
  carryoverMinutes: number;
  notes: string | null;
  createdAt: Date;
};

type Session = {
  id: number;
  clientId: number;
  clientToken: string;
  scheduledAt: Date;
  durationMinutes: number;
  carryoverMinutes: number;
  status: string;
  clientName: string | null;
  clientEmail: string | null;
};

function formatDate(d: Date | string) {
  return format(new Date(d), "yyyy/MM/dd HH:mm", { locale: ja });
}

function StatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = {
    scheduled: "予約済",
    active: "進行中",
    paused: "一時停止",
    completed: "完了",
    cancelled: "キャンセル",
  };
  return (
    <span className={`angelique-badge badge-${status}`}>
      {labels[status] ?? status}
    </span>
  );
}

export default function AdminBookings() {
  const { isAuthenticated, isLoading, refetch: refetchAuth } = useAdminAuth();
  const utils = trpc.useUtils();

  // Tabs
  const [tab, setTab] = useState<"sessions" | "clients">("sessions");

  // Session form
  const [showSessionForm, setShowSessionForm] = useState(false);
  const [editSession, setEditSession] = useState<Session | null>(null);
  const [sessionForm, setSessionForm] = useState({
    clientId: "",
    scheduledAt: "",
    durationMinutes: "60",
    carryoverMinutes: "0",
    sendEmail: true,
  });

  // Client form
  const [showClientForm, setShowClientForm] = useState(false);
  const [editClient, setEditClient] = useState<Client | null>(null);
  const [clientForm, setClientForm] = useState({
    name: "",
    email: "",
    sessionMinutes: "60",
    carryoverMinutes: "0",
    notes: "",
  });

  // Data
  const { data: sessions = [], refetch: refetchSessions } = trpc.sessions.list.useQuery();
  const { data: clients = [], refetch: refetchClients } = trpc.clients.list.useQuery();

  // Mutations
  const createSession = trpc.sessions.create.useMutation({
    onSuccess: () => {
      toast.success("セッションを作成しました");
      setShowSessionForm(false);
      resetSessionForm();
      refetchSessions();
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteSession = trpc.sessions.delete.useMutation({
    onSuccess: () => { toast.success("削除しました"); refetchSessions(); },
    onError: (e) => toast.error(e.message),
  });

  const resendEmail = trpc.email.resendInvite.useMutation({
    onSuccess: (r) => {
      if (r.success) toast.success("メールを再送しました");
      else toast.error("メール送信失敗: " + r.error);
    },
    onError: (e) => toast.error(e.message),
  });

  const createClient = trpc.clients.create.useMutation({
    onSuccess: () => {
      toast.success("お客様を登録しました");
      setShowClientForm(false);
      resetClientForm();
      refetchClients();
    },
    onError: (e) => toast.error(e.message),
  });

  const updateClient = trpc.clients.update.useMutation({
    onSuccess: () => {
      toast.success("更新しました");
      setShowClientForm(false);
      setEditClient(null);
      resetClientForm();
      refetchClients();
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteClient = trpc.clients.delete.useMutation({
    onSuccess: () => { toast.success("削除しました"); refetchClients(); },
    onError: (e) => toast.error(e.message),
  });

  const logoutMutation = trpc.admin.logout.useMutation({
    onSuccess: () => { refetchAuth(); },
  });

  function resetSessionForm() {
    setSessionForm({ clientId: "", scheduledAt: "", durationMinutes: "60", carryoverMinutes: "0", sendEmail: true });
    setEditSession(null);
  }

  function resetClientForm() {
    setClientForm({ name: "", email: "", sessionMinutes: "60", carryoverMinutes: "0", notes: "" });
    setEditClient(null);
  }

  function handleSessionSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!sessionForm.clientId || !sessionForm.scheduledAt) {
      toast.error("必須項目を入力してください");
      return;
    }
    createSession.mutate({
      clientId: Number(sessionForm.clientId),
      scheduledAt: new Date(sessionForm.scheduledAt).toISOString(),
      durationMinutes: Number(sessionForm.durationMinutes),
      carryoverMinutes: Number(sessionForm.carryoverMinutes),
      sendEmail: sessionForm.sendEmail,
      origin: window.location.origin,
    });
  }

  function handleClientSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!clientForm.name || !clientForm.email) {
      toast.error("名前とメールアドレスは必須です");
      return;
    }
    if (editClient) {
      updateClient.mutate({
        id: editClient.id,
        name: clientForm.name,
        email: clientForm.email,
        sessionMinutes: Number(clientForm.sessionMinutes),
        carryoverMinutes: Number(clientForm.carryoverMinutes),
        notes: clientForm.notes || undefined,
      });
    } else {
      createClient.mutate({
        name: clientForm.name,
        email: clientForm.email,
        sessionMinutes: Number(clientForm.sessionMinutes),
        carryoverMinutes: Number(clientForm.carryoverMinutes),
        notes: clientForm.notes || undefined,
      });
    }
  }

  function openEditClient(client: Client) {
    setEditClient(client);
    setClientForm({
      name: client.name,
      email: client.email,
      sessionMinutes: String(client.sessionMinutes),
      carryoverMinutes: String(client.carryoverMinutes),
      notes: client.notes ?? "",
    });
    setShowClientForm(true);
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#f9f5f4" }}>
        <div style={{ color: "#9e8480" }}>読み込み中...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <AdminLogin onSuccess={refetchAuth} />;
  }

  return (
    <div className="min-h-screen" style={{ background: "#f9f5f4" }}>
      <AngeliqueHeader isAdmin onLogout={() => logoutMutation.mutate()} />

      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Page title */}
        <div className="mb-6">
          <h1 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "28px", color: "#6b5b58", fontWeight: 400 }}>
            予約管理
          </h1>
          <p style={{ fontSize: "13px", color: "#9e8480", marginTop: "4px" }}>
            セッションの予約・お客様情報の管理
          </p>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          {[
            { key: "sessions", label: "セッション一覧" },
            { key: "clients", label: "お客様一覧" },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key as "sessions" | "clients")}
              style={{
                padding: "8px 20px",
                borderRadius: "20px",
                fontSize: "13px",
                fontWeight: 500,
                border: "none",
                cursor: "pointer",
                background: tab === t.key ? "#c9a8a3" : "#f3e7e5",
                color: tab === t.key ? "#fff" : "#9e8480",
                transition: "all 0.2s",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Sessions Tab */}
        {tab === "sessions" && (
          <div>
            <div className="flex justify-between items-center mb-4">
              <h2 style={{ fontSize: "16px", color: "#6b5b58", fontWeight: 500 }}>
                セッション一覧 ({sessions.length})
              </h2>
              <button
                className="angelique-btn"
                onClick={() => { resetSessionForm(); setShowSessionForm(true); }}
              >
                ✦ 新規セッション作成
              </button>
            </div>

            {/* Session Form Modal */}
            {showSessionForm && (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center"
                style={{ background: "rgba(107,91,88,0.2)" }}
                onClick={(e) => { if (e.target === e.currentTarget) setShowSessionForm(false); }}
              >
                <div className="angelique-card p-8 w-full max-w-md mx-4">
                  <h3 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "22px", color: "#6b5b58", marginBottom: "20px" }}>
                    新規セッション作成
                  </h3>
                  <form onSubmit={handleSessionSubmit}>
                    <div className="mb-4">
                      <label className="angelique-label">お客様 *</label>
                      <select
                        className="angelique-input"
                        value={sessionForm.clientId}
                        onChange={(e) => setSessionForm(f => ({ ...f, clientId: e.target.value }))}
                        required
                      >
                        <option value="">選択してください</option>
                        {clients.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}（{c.email}）
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="mb-4">
                      <label className="angelique-label">セッション日時 *</label>
                      <input
                        type="datetime-local"
                        className="angelique-input"
                        value={sessionForm.scheduledAt}
                        onChange={(e) => setSessionForm(f => ({ ...f, scheduledAt: e.target.value }))}
                        required
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <div>
                        <label className="angelique-label">セッション時間（分）</label>
                        <input
                          type="number"
                          className="angelique-input"
                          value={sessionForm.durationMinutes}
                          onChange={(e) => setSessionForm(f => ({ ...f, durationMinutes: e.target.value }))}
                          min={5} max={480}
                        />
                      </div>
                      <div>
                        <label className="angelique-label">繰越分</label>
                        <input
                          type="number"
                          className="angelique-input"
                          value={sessionForm.carryoverMinutes}
                          onChange={(e) => setSessionForm(f => ({ ...f, carryoverMinutes: e.target.value }))}
                          min={0}
                        />
                      </div>
                    </div>
                    <div className="mb-6 flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="sendEmail"
                        checked={sessionForm.sendEmail}
                        onChange={(e) => setSessionForm(f => ({ ...f, sendEmail: e.target.checked }))}
                        style={{ accentColor: "#c9a8a3" }}
                      />
                      <label htmlFor="sendEmail" style={{ fontSize: "13px", color: "#6b5b58", cursor: "pointer" }}>
                        参加URLをメールで送信する
                      </label>
                    </div>
                    <div className="flex gap-3">
                      <button type="submit" className="angelique-btn" disabled={createSession.isPending}>
                        {createSession.isPending ? "作成中..." : "作成する"}
                      </button>
                      <button type="button" className="angelique-btn-outline" onClick={() => setShowSessionForm(false)}>
                        キャンセル
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}

            {/* Sessions Table */}
            <div className="angelique-card overflow-hidden">
              {sessions.length === 0 ? (
                <div className="p-12 text-center" style={{ color: "#9e8480" }}>
                  <div style={{ fontSize: "32px", marginBottom: "8px" }}>✦</div>
                  <p>セッションがありません</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ background: "#f9f5f4", borderBottom: "1px solid #d4bfbb" }}>
                        {["お客様", "日時", "時間", "ステータス", "操作"].map((h) => (
                          <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontSize: "12px", color: "#9e8480", fontWeight: 500 }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sessions.map((s, i) => (
                        <tr
                          key={s.id}
                          style={{
                            borderBottom: i < sessions.length - 1 ? "1px solid #f3e7e5" : "none",
                          }}
                        >
                          <td style={{ padding: "14px 16px" }}>
                            <div style={{ fontSize: "14px", color: "#6b5b58", fontWeight: 500 }}>{s.clientName}</div>
                            <div style={{ fontSize: "12px", color: "#9e8480" }}>{s.clientEmail}</div>
                          </td>
                          <td style={{ padding: "14px 16px", fontSize: "13px", color: "#6b5b58" }}>
                            {formatDate(s.scheduledAt)}
                          </td>
                          <td style={{ padding: "14px 16px", fontSize: "13px", color: "#6b5b58" }}>
                            {s.durationMinutes}分
                            {s.carryoverMinutes > 0 && (
                              <span style={{ fontSize: "11px", color: "#c9a8a3", marginLeft: "4px" }}>
                                +{s.carryoverMinutes}分繰越
                              </span>
                            )}
                          </td>
                          <td style={{ padding: "14px 16px" }}>
                            <StatusBadge status={s.status} />
                          </td>
                          <td style={{ padding: "14px 16px" }}>
                            <div className="flex gap-2 flex-wrap">
                              <button
                                className="angelique-btn-outline"
                                style={{ padding: "5px 12px", fontSize: "12px" }}
                                onClick={() => {
                                  const url = `${window.location.origin}/session/${s.clientToken}`;
                                  navigator.clipboard.writeText(url);
                                  toast.success("URLをコピーしました");
                                }}
                              >
                                URL
                              </button>
                              <button
                                className="angelique-btn-outline"
                                style={{ padding: "5px 12px", fontSize: "12px" }}
                                onClick={() => resendEmail.mutate({ sessionId: s.id, origin: window.location.origin })}
                                disabled={resendEmail.isPending}
                              >
                                メール再送
                              </button>
                              <button
                                className="angelique-btn-danger"
                                style={{ padding: "5px 12px", fontSize: "12px" }}
                                onClick={() => {
                                  if (confirm("このセッションを削除しますか？")) {
                                    deleteSession.mutate({ id: s.id });
                                  }
                                }}
                              >
                                削除
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Clients Tab */}
        {tab === "clients" && (
          <div>
            <div className="flex justify-between items-center mb-4">
              <h2 style={{ fontSize: "16px", color: "#6b5b58", fontWeight: 500 }}>
                お客様一覧 ({clients.length})
              </h2>
              <button
                className="angelique-btn"
                onClick={() => { resetClientForm(); setShowClientForm(true); }}
              >
                ✦ お客様を追加
              </button>
            </div>

            {/* Client Form Modal */}
            {showClientForm && (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center"
                style={{ background: "rgba(107,91,88,0.2)" }}
                onClick={(e) => { if (e.target === e.currentTarget) { setShowClientForm(false); setEditClient(null); } }}
              >
                <div className="angelique-card p-8 w-full max-w-md mx-4">
                  <h3 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "22px", color: "#6b5b58", marginBottom: "20px" }}>
                    {editClient ? "お客様情報を編集" : "お客様を追加"}
                  </h3>
                  <form onSubmit={handleClientSubmit}>
                    <div className="mb-4">
                      <label className="angelique-label">お名前 *</label>
                      <input
                        type="text"
                        className="angelique-input"
                        value={clientForm.name}
                        onChange={(e) => setClientForm(f => ({ ...f, name: e.target.value }))}
                        placeholder="山田 花子"
                        required
                      />
                    </div>
                    <div className="mb-4">
                      <label className="angelique-label">メールアドレス *</label>
                      <input
                        type="email"
                        className="angelique-input"
                        value={clientForm.email}
                        onChange={(e) => setClientForm(f => ({ ...f, email: e.target.value }))}
                        placeholder="example@email.com"
                        required
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <div>
                        <label className="angelique-label">標準セッション時間（分）</label>
                        <input
                          type="number"
                          className="angelique-input"
                          value={clientForm.sessionMinutes}
                          onChange={(e) => setClientForm(f => ({ ...f, sessionMinutes: e.target.value }))}
                          min={5} max={480}
                        />
                      </div>
                      <div>
                        <label className="angelique-label">繰越分</label>
                        <input
                          type="number"
                          className="angelique-input"
                          value={clientForm.carryoverMinutes}
                          onChange={(e) => setClientForm(f => ({ ...f, carryoverMinutes: e.target.value }))}
                          min={0}
                        />
                      </div>
                    </div>
                    <div className="mb-6">
                      <label className="angelique-label">メモ</label>
                      <textarea
                        className="angelique-input"
                        value={clientForm.notes}
                        onChange={(e) => setClientForm(f => ({ ...f, notes: e.target.value }))}
                        placeholder="備考など"
                        rows={3}
                        style={{ resize: "vertical" }}
                      />
                    </div>
                    <div className="flex gap-3">
                      <button type="submit" className="angelique-btn" disabled={createClient.isPending || updateClient.isPending}>
                        {editClient ? "更新する" : "追加する"}
                      </button>
                      <button type="button" className="angelique-btn-outline" onClick={() => { setShowClientForm(false); setEditClient(null); }}>
                        キャンセル
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}

            {/* Clients Table */}
            <div className="angelique-card overflow-hidden">
              {clients.length === 0 ? (
                <div className="p-12 text-center" style={{ color: "#9e8480" }}>
                  <div style={{ fontSize: "32px", marginBottom: "8px" }}>✦</div>
                  <p>お客様が登録されていません</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ background: "#f9f5f4", borderBottom: "1px solid #d4bfbb" }}>
                        {["お名前", "メールアドレス", "標準時間", "繰越分", "登録日", "操作"].map((h) => (
                          <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontSize: "12px", color: "#9e8480", fontWeight: 500 }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {clients.map((c, i) => (
                        <tr key={c.id} style={{ borderBottom: i < clients.length - 1 ? "1px solid #f3e7e5" : "none" }}>
                          <td style={{ padding: "14px 16px", fontSize: "14px", color: "#6b5b58", fontWeight: 500 }}>{c.name}</td>
                          <td style={{ padding: "14px 16px", fontSize: "13px", color: "#9e8480" }}>{c.email}</td>
                          <td style={{ padding: "14px 16px", fontSize: "13px", color: "#6b5b58" }}>{c.sessionMinutes}分</td>
                          <td style={{ padding: "14px 16px", fontSize: "13px", color: c.carryoverMinutes > 0 ? "#c9a8a3" : "#9e8480" }}>
                            {c.carryoverMinutes > 0 ? `${c.carryoverMinutes}分` : "-"}
                          </td>
                          <td style={{ padding: "14px 16px", fontSize: "12px", color: "#9e8480" }}>
                            {formatDate(c.createdAt)}
                          </td>
                          <td style={{ padding: "14px 16px" }}>
                            <div className="flex gap-2">
                              <button
                                className="angelique-btn-outline"
                                style={{ padding: "5px 12px", fontSize: "12px" }}
                                onClick={() => openEditClient(c as Client)}
                              >
                                編集
                              </button>
                              <button
                                className="angelique-btn-danger"
                                style={{ padding: "5px 12px", fontSize: "12px" }}
                                onClick={() => {
                                  if (confirm(`${c.name}を削除しますか？`)) {
                                    deleteClient.mutate({ id: c.id });
                                  }
                                }}
                              >
                                削除
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
