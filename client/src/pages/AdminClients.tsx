import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import AngeliqueHeader from "@/components/AngeliqueHeader";
import AdminLogin from "./AdminLogin";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { useBrand } from "@/contexts/BrandContext";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { useParams, useLocation } from "wouter";

type Client = {
  id: number;
  name: string;
  email: string;
  sessionMinutes: number;
  carryoverMinutes: number;
  notes: string | null;
  createdAt: Date;
};

export default function AdminClients() {
  const { slug } = useParams<{ slug: string }>();
  const { isAuthenticated, isLoading, fortuneTeller, refetch: refetchAuth } = useAdminAuth();
  const { colors } = useBrand();
  const [, navigate] = useLocation();

  const [searchQuery, setSearchQuery] = useState("");
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

  const { data: clients = [], refetch: refetchClients } = trpc.clients.list.useQuery(
    { fortuneTellerId: ftId },
    { enabled: isAuthenticated && ftId > 0 }
  );

  const createClient = trpc.clients.create.useMutation({
    onSuccess: () => {
      toast.success("お客様を登録しました");
      setShowClientForm(false);
      resetForm();
      refetchClients();
    },
    onError: (e) => toast.error(e.message),
  });

  const updateClient = trpc.clients.update.useMutation({
    onSuccess: () => {
      toast.success("更新しました");
      setShowClientForm(false);
      setEditClient(null);
      resetForm();
      refetchClients();
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteClient = trpc.clients.delete.useMutation({
    onSuccess: () => { toast.success("削除しました"); refetchClients(); },
    onError: (e) => toast.error(e.message),
  });

  const logoutMutation = trpc.admin.logout.useMutation({ onSuccess: () => refetchAuth() });

  function resetForm() {
    setClientForm({ name: "", email: "", sessionMinutes: "60", carryoverMinutes: "0", notes: "" });
    setEditClient(null);
  }

  function openEdit(client: Client) {
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

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!clientForm.name || !clientForm.email) { toast.error("名前とメールアドレスは必須です"); return; }
    if (editClient) {
      updateClient.mutate({ id: editClient.id, name: clientForm.name, email: clientForm.email, sessionMinutes: Number(clientForm.sessionMinutes), carryoverMinutes: Number(clientForm.carryoverMinutes), notes: clientForm.notes || undefined });
    } else {
      createClient.mutate({ fortuneTellerId: ftId, name: clientForm.name, email: clientForm.email, sessionMinutes: Number(clientForm.sessionMinutes), carryoverMinutes: Number(clientForm.carryoverMinutes), notes: clientForm.notes || undefined });
    }
  }

  const filteredClients = clients.filter(
    (c) =>
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center" style={{ background: colors.main }}><div style={{ color: colors.subText }}>読み込み中...</div></div>;
  }

  if (!isAuthenticated) return <AdminLogin slug={slug} onSuccess={refetchAuth} />;

  return (
    <div className="min-h-screen" style={{ background: colors.main }}>
      <AngeliqueHeader isAdmin slug={slug} onLogout={() => logoutMutation.mutate()} />

      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex justify-between items-start mb-8">
          <div>
            <h1 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "28px", color: colors.text, fontWeight: 400 }}>
              お客様一覧
            </h1>
            <p style={{ fontSize: "13px", color: colors.subText, marginTop: "4px" }}>
              登録済みのお客様とセッション履歴
            </p>
          </div>
          <button className="angelique-btn" onClick={() => { resetForm(); setShowClientForm(true); }}>
            ✦ お客様を追加
          </button>
        </div>

        {/* Search */}
        <div className="mb-6">
          <input
            type="text"
            className="angelique-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="お客様名またはメールアドレスで検索..."
            style={{ maxWidth: "400px" }}
          />
        </div>

        {/* Client Form Modal */}
        {showClientForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(107,91,88,0.2)" }} onClick={(e) => { if (e.target === e.currentTarget) { setShowClientForm(false); setEditClient(null); } }}>
            <div className="angelique-card p-8 w-full max-w-md mx-4">
              <h3 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "22px", color: colors.text, marginBottom: "20px" }}>
                {editClient ? "お客様情報を編集" : "お客様を追加"}
              </h3>
              <form onSubmit={handleSubmit}>
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

        {/* Clients Grid */}
        {filteredClients.length === 0 ? (
          <div className="angelique-card p-12 text-center">
            <div style={{ fontSize: "32px", marginBottom: "8px" }}>✦</div>
            <p style={{ color: colors.subText }}>{searchQuery ? "該当するお客様が見つかりません" : "お客様が登録されていません"}</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {filteredClients.map((client) => (
              <ClientCard
                key={client.id}
                client={client as Client}
                slug={slug}
                onEdit={() => openEdit(client as Client)}
                onDelete={() => { if (confirm(`${client.name}を削除しますか？`)) deleteClient.mutate({ id: client.id }); }}
                onViewHistory={() => navigate(`/admin/${slug}/clients/${client.id}`)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ClientCard({
  client,
  slug,
  onEdit,
  onDelete,
  onViewHistory,
}: {
  client: Client;
  slug: string;
  onEdit: () => void;
  onDelete: () => void;
  onViewHistory: () => void;
}) {
  const { colors } = useBrand();

  return (
    <div className="angelique-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap mb-1">
            <span style={{ fontSize: "16px", fontWeight: 500, color: colors.text }}>{client.name}</span>
            {client.carryoverMinutes > 0 && (
              <span style={{ fontSize: "11px", padding: "2px 8px", borderRadius: "8px", background: colors.main, color: colors.accent, border: `1px solid ${colors.border}`, fontWeight: 500 }}>
                繰越 {client.carryoverMinutes}分
              </span>
            )}
          </div>
          <div style={{ fontSize: "13px", color: colors.subText }}>{client.email}</div>
          <div style={{ fontSize: "12px", color: colors.subText, marginTop: "4px" }}>
            標準: {client.sessionMinutes}分 · 登録: {format(new Date(client.createdAt), "yyyy/MM/dd", { locale: ja })}
          </div>
          {client.notes && (
            <div style={{ fontSize: "12px", color: colors.subText, marginTop: "6px", padding: "6px 10px", background: colors.main, borderRadius: "8px", border: `1px solid ${colors.border}` }}>
              {client.notes}
            </div>
          )}
        </div>

        <div className="flex gap-2 flex-shrink-0">
          <button
            className="angelique-btn-outline"
            style={{ padding: "6px 14px", fontSize: "12px" }}
            onClick={onViewHistory}
          >
            履歴
          </button>
          <button
            className="angelique-btn-outline"
            style={{ padding: "6px 14px", fontSize: "12px" }}
            onClick={onEdit}
          >
            編集
          </button>
          <button
            className="angelique-btn-danger"
            style={{ padding: "6px 14px", fontSize: "12px" }}
            onClick={onDelete}
          >
            削除
          </button>
        </div>
      </div>
    </div>
  );
}
