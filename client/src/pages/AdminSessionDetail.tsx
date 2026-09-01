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

type SessionWithClient = {
  id: number;
  clientId: number;
  clientToken: string;
  scheduledAt: Date;
  durationMinutes: number;
  carryoverMinutes: number;
  sessionType: "chat" | "voice" | "video";
  status: string;
  startedAt: Date | null;
  endedAt: Date | null;
  remainingSeconds: number | null;
  adminNotes: string | null;
  clientName: string | null;
  clientEmail: string | null;
};

type Message = {
  id: number;
  sessionId: number;
  sender: "admin" | "client" | "system";
  content: string;
  imageUrl: string | null;
  createdAt: Date;
};

export default function AdminSessionDetail() {
  const { slug, clientId } = useParams<{ slug: string; clientId: string }>();
  const { isAuthenticated, isLoading, fortuneTeller, refetch: refetchAuth } = useAdminAuth();
  const { colors } = useBrand();
  const [, navigate] = useLocation();

  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);
  const [sessionNotes, setSessionNotes] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");

  const clientIdNum = Number(clientId);

  const { data: client } = trpc.clients.get.useQuery(
    { id: clientIdNum },
    { enabled: isAuthenticated && clientIdNum > 0 }
  );

  const { data: sessions = [], refetch: refetchSessions } = trpc.sessions.listByClient.useQuery(
    { clientId: clientIdNum },
    { enabled: isAuthenticated && clientIdNum > 0 }
  );

  const { data: messages = [] } = trpc.messages.list.useQuery(
    { sessionId: selectedSessionId ?? 0 },
    { enabled: selectedSessionId !== null && selectedSessionId > 0 }
  );

  const { data: selectedSession } = trpc.sessions.get.useQuery(
    { id: selectedSessionId ?? 0 },
    { enabled: selectedSessionId !== null && selectedSessionId > 0 }
  );

  const updateSession = trpc.sessions.update.useMutation({
    onSuccess: () => {
      toast.success("メモを保存しました");
      setSavingNotes(false);
      refetchSessions();
    },
    onError: (e) => { toast.error(e.message); setSavingNotes(false); },
  });

  const logoutMutation = trpc.admin.logout.useMutation({
    onSuccess: () => { window.location.href = `/admin/${slug}`; },
  });

  function handleSelectSession(sessionId: number) {
    setSelectedSessionId(sessionId);
    const session = sessions.find((s) => s.id === sessionId);
    setSessionNotes(session?.adminNotes ?? "");
  }

  function handleSaveNotes() {
    if (!selectedSessionId) return;
    setSavingNotes(true);
    updateSession.mutate({ id: selectedSessionId, adminNotes: sessionNotes });
  }

  const filteredSessions = sessions.filter((s) => {
    if (filterStatus !== "all" && s.status !== filterStatus) return false;
    if (filterType !== "all" && s.sessionType !== filterType) return false;
    return true;
  });

  // Calculate totals
  const completedSessions = sessions.filter((s) => s.status === "completed");
  const totalMinutes = completedSessions.reduce(
    (sum, s) => sum + s.durationMinutes + s.carryoverMinutes, 0
  );

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center" style={{ background: colors.main }}><div style={{ color: colors.subText }}>読み込み中...</div></div>;
  }

  if (!isAuthenticated) return <AdminLogin slug={slug} onSuccess={refetchAuth} />;

  return (
    <div className="min-h-screen" style={{ background: colors.main }}>
      <AngeliqueHeader isAdmin slug={slug} onLogout={() => logoutMutation.mutate({ slug })} />

      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Breadcrumb */}
        <div style={{ fontSize: "13px", color: colors.subText, marginBottom: "20px" }}>
          <button onClick={() => navigate(`/admin/${slug}/clients`)} style={{ background: "none", border: "none", color: colors.accent, cursor: "pointer", padding: 0 }}>
            お客様一覧
          </button>
          {" › "}
          <span>{client?.name ?? "読み込み中..."}</span>
        </div>

        {/* Client Summary */}
        {client && (
          <div className="angelique-card p-6 mb-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "26px", color: colors.text, fontWeight: 400, marginBottom: "4px" }}>
                  {client.name} 様
                </h1>
                <div style={{ fontSize: "13px", color: colors.subText }}>{client.email}</div>
              </div>
              <div className="flex gap-6 text-center">
                <div>
                  <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "28px", color: colors.accent, lineHeight: 1 }}>{completedSessions.length}</div>
                  <div style={{ fontSize: "11px", color: colors.subText, marginTop: "2px" }}>セッション回数</div>
                </div>
                <div>
                  <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "28px", color: colors.accent, lineHeight: 1 }}>{totalMinutes}</div>
                  <div style={{ fontSize: "11px", color: colors.subText, marginTop: "2px" }}>合計分数</div>
                </div>
                <div>
                  <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "28px", color: client.carryoverMinutes > 0 ? colors.accent : colors.subText, lineHeight: 1 }}>{client.carryoverMinutes}</div>
                  <div style={{ fontSize: "11px", color: colors.subText, marginTop: "2px" }}>繰越分</div>
                </div>
              </div>
            </div>
            {client.notes && (
              <div style={{ marginTop: "12px", padding: "10px 14px", background: colors.main, borderRadius: "8px", border: `1px solid ${colors.border}`, fontSize: "13px", color: colors.subText }}>
                {client.notes}
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Session List */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 style={{ fontSize: "16px", color: colors.text, fontWeight: 500 }}>
                セッション一覧 ({filteredSessions.length})
              </h2>
            </div>

            {/* Filters */}
            <div className="flex gap-2 mb-4 flex-wrap">
              <select
                className="angelique-input"
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                style={{ width: "auto", padding: "6px 12px", fontSize: "12px" }}
              >
                <option value="all">全ステータス</option>
                <option value="completed">完了</option>
                <option value="scheduled">予約済</option>
                <option value="active">進行中</option>
                <option value="cancelled">キャンセル</option>
              </select>
              <select
                className="angelique-input"
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                style={{ width: "auto", padding: "6px 12px", fontSize: "12px" }}
              >
                <option value="all">全鑑定方法</option>
                <option value="chat">チャット</option>
                <option value="voice">音声</option>
                <option value="video">ビデオ</option>
              </select>
            </div>

            <div className="grid gap-3">
              {filteredSessions.length === 0 ? (
                <div className="angelique-card p-8 text-center" style={{ color: colors.subText }}>
                  セッションがありません
                </div>
              ) : (
                filteredSessions.map((s) => (
                  <div
                    key={s.id}
                    className="angelique-card p-4 cursor-pointer"
                    style={{
                      borderLeft: selectedSessionId === s.id ? `3px solid ${colors.accent}` : "3px solid transparent",
                      opacity: s.status === "cancelled" ? 0.6 : 1,
                    }}
                    onClick={() => handleSelectSession(s.id)}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span style={{ fontSize: "14px", fontWeight: 500, color: colors.text }}>
                        {format(new Date(s.scheduledAt), "M/d (E) HH:mm", { locale: ja })}
                      </span>
                      <span style={{
                        fontSize: "11px", padding: "2px 8px", borderRadius: "8px",
                        background: s.sessionType === "voice" ? "#e8f5e9" : s.sessionType === "video" ? "#e3f2fd" : colors.main,
                        color: s.sessionType === "voice" ? "#2e7d32" : s.sessionType === "video" ? "#1565c0" : colors.subText,
                        border: s.sessionType === "voice" ? "1px solid #a5d6a7" : s.sessionType === "video" ? "1px solid #90caf9" : `1px solid ${colors.border}`,
                      }}>
                        {s.sessionType === "voice" ? "🎙 音声" : s.sessionType === "video" ? "📹 ビデオ" : "💬 チャット"}
                      </span>
                    </div>
                    <div style={{ fontSize: "12px", color: colors.subText }}>
                      {s.durationMinutes}分{s.carryoverMinutes > 0 ? ` (+${s.carryoverMinutes}分繰越)` : ""} · {StatusLabel(s.status)}
                    </div>
                    {s.adminNotes && (
                      <div style={{ fontSize: "11px", color: colors.subText, marginTop: "4px", padding: "4px 8px", background: colors.main, borderRadius: "6px" }}>
                        📝 {s.adminNotes.slice(0, 60)}{s.adminNotes.length > 60 ? "..." : ""}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Session Detail */}
          <div>
            {selectedSessionId && selectedSession ? (
              <div>
                <h2 style={{ fontSize: "16px", color: colors.text, fontWeight: 500, marginBottom: "16px" }}>
                  セッション詳細
                </h2>

                <div className="angelique-card p-5 mb-4">
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", fontSize: "13px" }}>
                    <div>
                      <div style={{ color: colors.subText, fontSize: "11px", marginBottom: "2px" }}>日時</div>
                      <div style={{ color: colors.text }}>{format(new Date(selectedSession.scheduledAt), "yyyy/M/d (E) HH:mm", { locale: ja })}</div>
                    </div>
                    <div>
                      <div style={{ color: colors.subText, fontSize: "11px", marginBottom: "2px" }}>鑑定方法</div>
                      <div style={{ color: colors.text }}>
                        {selectedSession.sessionType === "voice" ? "🎙 音声鑑定" : selectedSession.sessionType === "video" ? "📹 ビデオ鑑定" : "💬 チャット鑑定"}
                      </div>
                    </div>
                    <div>
                      <div style={{ color: colors.subText, fontSize: "11px", marginBottom: "2px" }}>時間</div>
                      <div style={{ color: colors.text }}>{selectedSession.durationMinutes}分{selectedSession.carryoverMinutes > 0 ? ` (+${selectedSession.carryoverMinutes}分繰越)` : ""}</div>
                    </div>
                    <div>
                      <div style={{ color: colors.subText, fontSize: "11px", marginBottom: "2px" }}>ステータス</div>
                      <div style={{ color: colors.text }}>{StatusLabel(selectedSession.status)}</div>
                    </div>
                    {selectedSession.startedAt && (
                      <div>
                        <div style={{ color: colors.subText, fontSize: "11px", marginBottom: "2px" }}>開始時刻</div>
                        <div style={{ color: colors.text }}>{format(new Date(selectedSession.startedAt), "HH:mm:ss")}</div>
                      </div>
                    )}
                    {selectedSession.endedAt && (
                      <div>
                        <div style={{ color: colors.subText, fontSize: "11px", marginBottom: "2px" }}>終了時刻</div>
                        <div style={{ color: colors.text }}>{format(new Date(selectedSession.endedAt), "HH:mm:ss")}</div>
                      </div>
                    )}
                  </div>

                  {/* Admin Notes */}
                  <div style={{ marginTop: "16px", paddingTop: "16px", borderTop: `1px solid ${colors.border}` }}>
                    <label style={{ fontSize: "12px", color: colors.subText, display: "block", marginBottom: "6px" }}>
                      📝 鑑定士メモ
                    </label>
                    <textarea
                      className="angelique-input"
                      value={sessionNotes}
                      onChange={(e) => setSessionNotes(e.target.value)}
                      placeholder="セッションの記録・メモを入力..."
                      rows={4}
                      style={{ resize: "vertical", fontSize: "13px" }}
                    />
                    <button
                      className="angelique-btn mt-2"
                      onClick={handleSaveNotes}
                      disabled={savingNotes}
                      style={{ fontSize: "12px", padding: "6px 16px" }}
                    >
                      {savingNotes ? "保存中..." : "メモを保存"}
                    </button>
                  </div>
                </div>

                {/* Chat Log */}
                <div className="angelique-card overflow-hidden">
                  <div style={{ padding: "14px 16px", borderBottom: `1px solid ${colors.border}`, fontSize: "13px", fontWeight: 500, color: colors.text }}>
                    チャットログ ({messages.length}件)
                  </div>
                  {messages.length === 0 ? (
                    <div style={{ padding: "20px", textAlign: "center", color: colors.subText, fontSize: "13px" }}>
                      チャットログがありません
                    </div>
                  ) : (
                    <div style={{ maxHeight: "480px", overflowY: "auto", padding: "12px" }}>
                      {messages.map((msg) => (
                        <MessageBubble key={msg.id} message={msg as Message} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="angelique-card p-12 text-center" style={{ color: colors.subText }}>
                <div style={{ fontSize: "32px", marginBottom: "8px" }}>✦</div>
                <p>左のリストからセッションを選択してください</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusLabel(status: string): string {
  const labels: Record<string, string> = {
    scheduled: "予約済",
    active: "進行中",
    paused: "一時停止",
    completed: "完了",
    cancelled: "キャンセル",
  };
  return labels[status] ?? status;
}

function MessageBubble({ message }: { message: Message }) {
  const { colors } = useBrand();
  const isAdmin = message.sender === "admin";
  const isSystem = message.sender === "system";

  if (isSystem) {
    return (
      <div style={{ textAlign: "center", margin: "8px 0" }}>
        <span style={{ fontSize: "11px", color: colors.subText, padding: "3px 10px", background: colors.main, borderRadius: "10px", border: `1px solid ${colors.border}` }}>
          {message.content}
        </span>
        <div style={{ fontSize: "10px", color: colors.subText, marginTop: "2px" }}>
          {format(new Date(message.createdAt), "HH:mm")}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: isAdmin ? "row-reverse" : "row", marginBottom: "10px", gap: "8px", alignItems: "flex-end" }}>
      <div
        style={{
          maxWidth: "75%",
          padding: "8px 12px",
          borderRadius: isAdmin ? "16px 4px 16px 16px" : "4px 16px 16px 16px",
          background: isAdmin ? colors.accent : colors.main,
          color: isAdmin ? "#fff" : colors.text,
          fontSize: "13px",
          lineHeight: 1.5,
          border: isAdmin ? "none" : `1px solid ${colors.border}`,
          wordBreak: "break-word",
        }}
      >
        {message.imageUrl ? (
          <img
            src={message.imageUrl}
            alt="送信画像"
            style={{ maxWidth: "200px", borderRadius: "8px", display: "block", marginBottom: message.content ? "6px" : 0 }}
          />
        ) : null}
        {message.content && <span>{message.content}</span>}
      </div>
      <div style={{ fontSize: "10px", color: colors.subText, flexShrink: 0 }}>
        {format(new Date(message.createdAt), "HH:mm")}
      </div>
    </div>
  );
}
