import { useState, useRef } from "react";
import { QRCodeSVG } from "qrcode.react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import AngeliqueHeader from "@/components/AngeliqueHeader";
import AdminLogin from "./AdminLogin";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { useBrand } from "@/contexts/BrandContext";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { useParams } from "wouter";

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
  sessionType: "chat" | "voice" | "video";
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
  return <span className={`angelique-badge badge-${status}`}>{labels[status] ?? status}</span>;
}

function QRButton({ clientToken, clientName }: { clientToken: string; clientName: string | null }) {
  const [showQR, setShowQR] = useState(false);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const { colors } = useBrand();
  const url = `${window.location.origin}/session/${clientToken}`;

  const downloadPng = () => {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const serializer = new XMLSerializer();
    const svgStr = serializer.serializeToString(svgEl);
    const img = new Image();
    const size = 220;
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = size + 40;
      canvas.height = size + 40;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 20, 20, size, size);
      const link = document.createElement("a");
      link.download = `qr_${clientName ?? "session"}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    };
    img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svgStr)));
  };

  return (
    <>
      <button className="angelique-btn-outline" style={{ padding: "5px 12px", fontSize: "12px" }} onClick={() => setShowQR(true)}>QR</button>
      {showQR && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(107,91,88,0.35)" }} onClick={(e) => { if (e.target === e.currentTarget) setShowQR(false); }}>
          <div className="angelique-card p-8 w-full max-w-xs mx-4 text-center">
            <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "20px", color: colors.text, marginBottom: "4px" }}>QRコード</div>
            <p style={{ fontSize: "12px", color: colors.subText, marginBottom: "20px" }}>{clientName} 様のセッションURL</p>
            <div style={{ display: "inline-flex", padding: "12px", background: "#fff", borderRadius: "12px", border: `1px solid ${colors.border}`, marginBottom: "16px" }}>
              <QRCodeSVG value={url} size={180} ref={svgRef} />
            </div>
            <p style={{ fontSize: "10px", color: colors.subText, wordBreak: "break-all", marginBottom: "16px", lineHeight: 1.5 }}>{url}</p>
            <div className="flex gap-2 justify-center flex-wrap">
              <button className="angelique-btn-outline" style={{ padding: "6px 16px", fontSize: "12px" }} onClick={() => { navigator.clipboard.writeText(url); toast.success("URLをコピーしました"); }}>URLをコピー</button>
              <button className="angelique-btn-outline" style={{ padding: "6px 16px", fontSize: "12px" }} onClick={downloadPng}>PNG保存</button>
              <button className="angelique-btn-outline" style={{ padding: "6px 16px", fontSize: "12px" }} onClick={() => setShowQR(false)}>閉じる</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function AdminBookings() {
  const { slug } = useParams<{ slug: string }>();
  const { isAuthenticated, isLoading, fortuneTeller, refetch: refetchAuth } = useAdminAuth();
  const { colors } = useBrand();

  const [tab, setTab] = useState<"sessions" | "clients">("sessions");

  const [showSessionForm, setShowSessionForm] = useState(false);
  const [sessionForm, setSessionForm] = useState({
    clientId: "",
    scheduledAt: "",
    durationMinutes: "60",
    carryoverMinutes: "0",
    sessionType: "chat" as "chat" | "voice" | "video",
    sendEmail: true,
  });

  const [showClientForm, setShowClientForm] = useState(false);
  const [editClient, setEditClient] = useState<Client | null>(null);
  const [clientForm, setClientForm] = useState({
    name: "",
    email: "",
    sessionMinutes: "60",
    carryoverMinutes: "0",
    notes: "",
  });

  const ftId = fortuneTeller?.fortuneTellerId ?? 0;

  const { data: sessions = [], refetch: refetchSessions } = trpc.sessions.list.useQuery(
    { fortuneTellerId: ftId },
    { enabled: isAuthenticated && ftId > 0 }
  );
  const { data: clients = [], refetch: refetchClients } = trpc.clients.list.useQuery(
    { fortuneTellerId: ftId },
    { enabled: isAuthenticated && ftId > 0 }
  );

  const createSession = trpc.sessions.create.useMutation({
    onSuccess: () => { toast.success("セッションを作成しました"); setShowSessionForm(false); resetSessionForm(); refetchSessions(); },
    onError: (e) => toast.error(e.message),
  });

  const deleteSession = trpc.sessions.delete.useMutation({
    onSuccess: () => { toast.success("削除しました"); refetchSessions(); },
    onError: (e) => toast.error(e.message),
  });

  const resendEmail = trpc.email.resendInvite.useMutation({
    onSuccess: (r) => { if (r.success) toast.success("メールを再送しました"); else toast.error("メール送信失敗: " + r.error); },
    onError: (e) => toast.error(e.message),
  });

  const createClient = trpc.clients.create.useMutation({
    onSuccess: () => { toast.success("お客様を登録しました"); setShowClientForm(false); resetClientForm(); refetchClients(); },
    onError: (e) => toast.error(e.message),
  });

  const updateClient = trpc.clients.update.useMutation({
    onSuccess: () => { toast.success("更新しました"); setShowClientForm(false); setEditClient(null); resetClientForm(); refetchClients(); },
    onError: (e) => toast.error(e.message),
  });

  const deleteClient = trpc.clients.delete.useMutation({
    onSuccess: () => { toast.success("削除しました"); refetchClients(); },
    onError: (e) => toast.error(e.message),
  });

  const logoutMutation = trpc.admin.logout.useMutation({ onSuccess: () => refetchAuth() });

  function resetSessionForm() {
    setSessionForm({ clientId: "", scheduledAt: "", durationMinutes: "60", carryoverMinutes: "0", sessionType: "chat", sendEmail: true });
  }

  function resetClientForm() {
    setClientForm({ name: "", email: "", sessionMinutes: "60", carryoverMinutes: "0", notes: "" });
    setEditClient(null);
  }

  function handleSessionSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!sessionForm.clientId || !sessionForm.scheduledAt) { toast.error("必須項目を入力してください"); return; }
    createSession.mutate({
      fortuneTellerId: ftId,
      clientId: Number(sessionForm.clientId),
      scheduledAt: new Date(sessionForm.scheduledAt).toISOString(),
      durationMinutes: Number(sessionForm.durationMinutes),
      carryoverMinutes: Number(sessionForm.carryoverMinutes),
      sessionType: sessionForm.sessionType,
      sendEmail: sessionForm.sendEmail,
      origin: window.location.origin,
    });
  }

  function handleClientSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!clientForm.name || !clientForm.email) { toast.error("名前とメールアドレスは必須です"); return; }
    if (editClient) {
      updateClient.mutate({ id: editClient.id, name: clientForm.name, email: clientForm.email, sessionMinutes: Number(clientForm.sessionMinutes), carryoverMinutes: Number(clientForm.carryoverMinutes), notes: clientForm.notes || undefined });
    } else {
      createClient.mutate({ fortuneTellerId: ftId, name: clientForm.name, email: clientForm.email, sessionMinutes: Number(clientForm.sessionMinutes), carryoverMinutes: Number(clientForm.carryoverMinutes), notes: clientForm.notes || undefined });
    }
  }

  function openEditClient(client: Client) {
    setEditClient(client);
    setClientForm({ name: client.name, email: client.email, sessionMinutes: String(client.sessionMinutes), carryoverMinutes: String(client.carryoverMinutes), notes: client.notes ?? "" });
    setShowClientForm(true);
  }

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center" style={{ background: colors.main }}><div style={{ color: colors.subText }}>読み込み中...</div></div>;
  }

  if (!isAuthenticated) return <AdminLogin slug={slug} onSuccess={refetchAuth} />;

  return (
    <div className="min-h-screen" style={{ background: colors.main }}>
      <AngeliqueHeader isAdmin slug={slug} onLogout={() => logoutMutation.mutate()} />

      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "28px", color: colors.text, fontWeight: 400 }}>
            予約管理
          </h1>
          <p style={{ fontSize: "13px", color: colors.subText, marginTop: "4px" }}>
            セッションの予約・お客様情報の管理
          </p>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          {[{ key: "sessions", label: "セッション一覧" }, { key: "clients", label: "お客様一覧" }].map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key as "sessions" | "clients")}
              style={{
                padding: "8px 20px", borderRadius: "20px", fontSize: "13px", fontWeight: 500,
                border: "none", cursor: "pointer",
                background: tab === t.key ? colors.accent : colors.main,
                color: tab === t.key ? "#fff" : colors.subText,
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
              <h2 style={{ fontSize: "16px", color: colors.text, fontWeight: 500 }}>セッション一覧 ({sessions.length})</h2>
              <button className="angelique-btn" onClick={() => { resetSessionForm(); setShowSessionForm(true); }}>✦ 新規セッション作成</button>
            </div>

            {showSessionForm && (
              <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(107,91,88,0.2)" }} onClick={(e) => { if (e.target === e.currentTarget) setShowSessionForm(false); }}>
                <div className="angelique-card p-8 w-full max-w-md mx-4">
                  <h3 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "22px", color: colors.text, marginBottom: "20px" }}>新規セッション作成</h3>
                  <form onSubmit={handleSessionSubmit}>
                    <div className="mb-4">
                      <label className="angelique-label">お客様 *</label>
                      <select className="angelique-input" value={sessionForm.clientId} onChange={(e) => setSessionForm(f => ({ ...f, clientId: e.target.value }))} required>
                        <option value="">選択してください</option>
                        {clients.map((c) => <option key={c.id} value={c.id}>{c.name}（{c.email}）</option>)}
                      </select>
                    </div>
                    <div className="mb-4">
                      <label className="angelique-label">セッション日時 *</label>
                      <input type="datetime-local" className="angelique-input" value={sessionForm.scheduledAt} onChange={(e) => setSessionForm(f => ({ ...f, scheduledAt: e.target.value }))} required />
                    </div>
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <div>
                        <label className="angelique-label">時間（分）</label>
                        <input type="number" className="angelique-input" value={sessionForm.durationMinutes} onChange={(e) => setSessionForm(f => ({ ...f, durationMinutes: e.target.value }))} min={5} max={480} />
                      </div>
                      <div>
                        <label className="angelique-label">繰越分</label>
                        <input type="number" className="angelique-input" value={sessionForm.carryoverMinutes} onChange={(e) => setSessionForm(f => ({ ...f, carryoverMinutes: e.target.value }))} min={0} />
                      </div>
                    </div>
                    <div className="mb-4">
                      <label className="angelique-label">鑑定方法</label>
                      <div className="flex gap-3 mt-1">
                        {[
                          { val: "chat", label: "💬 チャット鑑定" },
                          { val: "voice", label: "🎙 音声鑑定" },
                          { val: "video", label: "📹 ビデオ鑑定" },
                        ].map((opt) => (
                          <label key={opt.val} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 16px", borderRadius: "12px", border: sessionForm.sessionType === opt.val ? `2px solid ${colors.accent}` : `1.5px solid ${colors.border}`, background: sessionForm.sessionType === opt.val ? colors.main : "#f9f5f4", cursor: "pointer", fontSize: "13px", color: colors.text, fontWeight: sessionForm.sessionType === opt.val ? 600 : 400 }}>
                            <input type="radio" name="sessionType" value={opt.val} checked={sessionForm.sessionType === opt.val} onChange={() => setSessionForm(f => ({ ...f, sessionType: opt.val as "chat" | "voice" | "video" }))} style={{ accentColor: colors.accent }} />
                            {opt.label}
                          </label>
                        ))}
                      </div>
                    </div>
                    <div className="mb-6 flex items-center gap-2">
                      <input type="checkbox" id="sendEmail" checked={sessionForm.sendEmail} onChange={(e) => setSessionForm(f => ({ ...f, sendEmail: e.target.checked }))} style={{ accentColor: colors.accent }} />
                      <label htmlFor="sendEmail" style={{ fontSize: "13px", color: colors.text, cursor: "pointer" }}>参加URLをメールで送信する</label>
                    </div>
                    <div className="flex gap-3">
                      <button type="submit" className="angelique-btn" disabled={createSession.isPending}>{createSession.isPending ? "作成中..." : "作成する"}</button>
                      <button type="button" className="angelique-btn-outline" onClick={() => setShowSessionForm(false)}>キャンセル</button>
                    </div>
                  </form>
                </div>
              </div>
            )}

            <div className="angelique-card overflow-hidden">
              {sessions.length === 0 ? (
                <div className="p-12 text-center" style={{ color: colors.subText }}><div style={{ fontSize: "32px", marginBottom: "8px" }}>✦</div><p>セッションがありません</p></div>
              ) : (
                <div className="overflow-x-auto">
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ background: colors.main, borderBottom: `1px solid ${colors.border}` }}>
                        {["お客様", "日時", "時間", "方法", "ステータス", "操作"].map((h) => (
                          <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontSize: "12px", color: colors.subText, fontWeight: 500 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sessions.map((s, i) => (
                        <tr key={s.id} style={{ borderBottom: i < sessions.length - 1 ? `1px solid ${colors.main}` : "none" }}>
                          <td style={{ padding: "14px 16px" }}>
                            <div style={{ fontSize: "14px", color: colors.text, fontWeight: 500 }}>{s.clientName}</div>
                            <div style={{ fontSize: "12px", color: colors.subText }}>{s.clientEmail}</div>
                          </td>
                          <td style={{ padding: "14px 16px", fontSize: "13px", color: colors.text }}>{formatDate(s.scheduledAt)}</td>
                          <td style={{ padding: "14px 16px", fontSize: "13px", color: colors.text }}>
                            {s.durationMinutes}分{s.carryoverMinutes > 0 && <span style={{ fontSize: "11px", color: colors.accent, marginLeft: "4px" }}>+{s.carryoverMinutes}分繰越</span>}
                          </td>
                          <td style={{ padding: "14px 16px", fontSize: "12px", color: colors.subText }}>
                            {s.sessionType === "voice" ? "🎙 音声" : s.sessionType === "video" ? "📹 ビデオ" : "💬 チャット"}
                          </td>
                          <td style={{ padding: "14px 16px" }}><StatusBadge status={s.status} /></td>
                          <td style={{ padding: "14px 16px" }}>
                            <div className="flex gap-2 flex-wrap">
                              <button className="angelique-btn-outline" style={{ padding: "5px 12px", fontSize: "12px" }} onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/session/${s.clientToken}`); toast.success("URLをコピーしました"); }}>URL</button>
                              <QRButton clientToken={s.clientToken} clientName={s.clientName} />
                              <button className="angelique-btn-outline" style={{ padding: "5px 12px", fontSize: "12px" }} onClick={() => resendEmail.mutate({ sessionId: s.id, origin: window.location.origin })} disabled={resendEmail.isPending}>メール再送</button>
                              <button className="angelique-btn-danger" style={{ padding: "5px 12px", fontSize: "12px" }} onClick={() => { if (confirm("このセッションを削除しますか？")) deleteSession.mutate({ id: s.id }); }}>削除</button>
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
              <h2 style={{ fontSize: "16px", color: colors.text, fontWeight: 500 }}>お客様一覧 ({clients.length})</h2>
              <button className="angelique-btn" onClick={() => { resetClientForm(); setShowClientForm(true); }}>✦ お客様を追加</button>
            </div>

            {showClientForm && (
              <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(107,91,88,0.2)" }} onClick={(e) => { if (e.target === e.currentTarget) { setShowClientForm(false); setEditClient(null); } }}>
                <div className="angelique-card p-8 w-full max-w-md mx-4">
                  <h3 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "22px", color: colors.text, marginBottom: "20px" }}>{editClient ? "お客様情報を編集" : "お客様を追加"}</h3>
                  <form onSubmit={handleClientSubmit}>
                    <div className="mb-4"><label className="angelique-label">お名前 *</label><input type="text" className="angelique-input" value={clientForm.name} onChange={(e) => setClientForm(f => ({ ...f, name: e.target.value }))} placeholder="山田 花子" required /></div>
                    <div className="mb-4"><label className="angelique-label">メールアドレス *</label><input type="email" className="angelique-input" value={clientForm.email} onChange={(e) => setClientForm(f => ({ ...f, email: e.target.value }))} placeholder="example@email.com" required /></div>
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <div><label className="angelique-label">標準セッション時間（分）</label><input type="number" className="angelique-input" value={clientForm.sessionMinutes} onChange={(e) => setClientForm(f => ({ ...f, sessionMinutes: e.target.value }))} min={5} max={480} /></div>
                      <div><label className="angelique-label">繰越分</label><input type="number" className="angelique-input" value={clientForm.carryoverMinutes} onChange={(e) => setClientForm(f => ({ ...f, carryoverMinutes: e.target.value }))} min={0} /></div>
                    </div>
                    <div className="mb-6"><label className="angelique-label">メモ</label><textarea className="angelique-input" value={clientForm.notes} onChange={(e) => setClientForm(f => ({ ...f, notes: e.target.value }))} placeholder="備考など" rows={3} style={{ resize: "vertical" }} /></div>
                    <div className="flex gap-3">
                      <button type="submit" className="angelique-btn" disabled={createClient.isPending || updateClient.isPending}>{editClient ? "更新する" : "追加する"}</button>
                      <button type="button" className="angelique-btn-outline" onClick={() => { setShowClientForm(false); setEditClient(null); }}>キャンセル</button>
                    </div>
                  </form>
                </div>
              </div>
            )}

            <div className="angelique-card overflow-hidden">
              {clients.length === 0 ? (
                <div className="p-12 text-center" style={{ color: colors.subText }}><div style={{ fontSize: "32px", marginBottom: "8px" }}>✦</div><p>お客様が登録されていません</p></div>
              ) : (
                <div className="overflow-x-auto">
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ background: colors.main, borderBottom: `1px solid ${colors.border}` }}>
                        {["お名前", "メールアドレス", "標準時間", "繰越分", "登録日", "操作"].map((h) => (
                          <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontSize: "12px", color: colors.subText, fontWeight: 500 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {clients.map((c, i) => (
                        <tr key={c.id} style={{ borderBottom: i < clients.length - 1 ? `1px solid ${colors.main}` : "none" }}>
                          <td style={{ padding: "14px 16px", fontSize: "14px", color: colors.text, fontWeight: 500 }}>{c.name}</td>
                          <td style={{ padding: "14px 16px", fontSize: "13px", color: colors.subText }}>{c.email}</td>
                          <td style={{ padding: "14px 16px", fontSize: "13px", color: colors.text }}>{c.sessionMinutes}分</td>
                          <td style={{ padding: "14px 16px", fontSize: "13px", color: c.carryoverMinutes > 0 ? colors.accent : colors.subText }}>{c.carryoverMinutes > 0 ? `${c.carryoverMinutes}分` : "-"}</td>
                          <td style={{ padding: "14px 16px", fontSize: "12px", color: colors.subText }}>{formatDate(c.createdAt)}</td>
                          <td style={{ padding: "14px 16px" }}>
                            <div className="flex gap-2">
                              <button className="angelique-btn-outline" style={{ padding: "5px 12px", fontSize: "12px" }} onClick={() => openEditClient(c as Client)}>編集</button>
                              <button className="angelique-btn-danger" style={{ padding: "5px 12px", fontSize: "12px" }} onClick={() => { if (confirm(`${c.name}を削除しますか？`)) deleteClient.mutate({ id: c.id }); }}>削除</button>
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
