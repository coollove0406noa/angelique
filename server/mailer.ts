import sgMail from "@sendgrid/mail";

export async function sendSessionInviteEmail({
  toEmail,
  toName,
  sessionUrl,
  scheduledAt,
  durationMinutes,
}: {
  toEmail: string;
  toName: string;
  sessionUrl: string;
  scheduledAt: Date;
  durationMinutes: number;
}): Promise<{ success: boolean; error?: string }> {
  const apiKey = process.env.SENDGRID_API_KEY;
  const fromEmail = process.env.SENDGRID_FROM_EMAIL || "noreply@noakayou.com";

  if (!apiKey) {
    console.warn("[Mailer] SENDGRID_API_KEY not set, skipping email send");
    return { success: false, error: "SENDGRID_API_KEY not configured" };
  }

  sgMail.setApiKey(apiKey);

  const dateStr = scheduledAt.toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const htmlContent = `
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: 'Noto Sans JP', sans-serif; background: #f9f5f4; color: #6b5b58; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 40px auto; background: #fff; border-radius: 20px; padding: 40px; box-shadow: 0 2px 12px rgba(107,91,88,0.08); }
    .logo { font-family: 'Cormorant Garamond', serif; font-size: 28px; color: #c9a8a3; text-align: center; margin-bottom: 8px; }
    .subtitle { text-align: center; color: #9e8480; font-size: 13px; margin-bottom: 32px; }
    h2 { color: #6b5b58; font-size: 18px; }
    .info-box { background: #f3e7e5; border-radius: 12px; padding: 20px; margin: 24px 0; }
    .info-row { display: flex; margin-bottom: 8px; }
    .info-label { color: #9e8480; min-width: 120px; font-size: 14px; }
    .info-value { color: #6b5b58; font-size: 14px; font-weight: 600; }
    .btn { display: block; width: fit-content; margin: 32px auto; background: #c9a8a3; color: #fff; text-decoration: none; padding: 14px 40px; border-radius: 24px; font-size: 16px; font-weight: 600; }
    .notice { background: #f9f5f4; border-radius: 12px; padding: 16px; font-size: 13px; color: #9e8480; margin-top: 24px; }
    .footer { text-align: center; color: #d4bfbb; font-size: 12px; margin-top: 32px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">✦ angelique ✦</div>
    <div class="subtitle">言葉にならない声を整える場所</div>
    <h2>${toName} 様</h2>
    <p>この度はご予約いただきありがとうございます。<br>以下の内容でオンラインセッションのご案内をお送りします。</p>
    <div class="info-box">
      <div class="info-row">
        <span class="info-label">📅 セッション日時</span>
        <span class="info-value">${dateStr}</span>
      </div>
      <div class="info-row">
        <span class="info-label">⏱ セッション時間</span>
        <span class="info-value">${durationMinutes}分</span>
      </div>
    </div>
    <p>下のボタンからセッションにご参加ください：</p>
    <a href="${sessionUrl}" class="btn">✦ セッションに参加する</a>
    <div class="notice">
      <strong>【ご注意事項】</strong><br>
      ・URLは本人のみご利用ください。第三者への共有はご遠慮ください。<br>
      ・セッション開始時刻の少し前にURLを開いてお待ちください。<br>
      ・通信環境の良い場所でご参加ください。<br>
      ・ご不明な点はお気軽にお問い合わせください。
    </div>
    <div class="footer">angelique &copy; ${new Date().getFullYear()}</div>
  </div>
</body>
</html>
`;

  try {
    await sgMail.send({
      to: { email: toEmail, name: toName },
      from: { email: fromEmail, name: "angelique" },
      subject: `【angelique】セッションのご案内 - ${dateStr}`,
      html: htmlContent,
      text: `${toName}様\n\nセッションのご案内です。\n日時：${dateStr}\n時間：${durationMinutes}分\n\n参加URL：${sessionUrl}\n\n※URLは本人のみご利用ください。`,
    });
    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Mailer] SendGrid error:", msg);
    return { success: false, error: msg };
  }
}
