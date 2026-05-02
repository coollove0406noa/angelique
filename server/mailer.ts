import sgMail from "@sendgrid/mail";

// SendGrid の ResponseError 型（@sendgrid/helpers/classes/response-error）
interface SendGridResponseError extends Error {
  code?: number;
  response?: {
    headers?: Record<string, string>;
    body?: {
      errors?: Array<{ message: string; field?: string | null; help?: string | null }>;
    };
    statusCode?: number;
  };
}

/**
 * SendGrid エラーオブジェクトから詳細メッセージを生成する。
 * response.body.errors が存在する場合はその内容を優先して返す。
 */
function extractSendGridError(err: unknown): string {
  const sgErr = err as SendGridResponseError;
  const statusCode = sgErr.response?.statusCode ?? sgErr.code;
  const bodyErrors = sgErr.response?.body?.errors;

  if (bodyErrors && bodyErrors.length > 0) {
    const details = bodyErrors.map((e) => e.message).join("; ");
    return `[HTTP ${statusCode ?? "?"}] ${details}`;
  }

  const baseMsg = sgErr.message ?? String(err);
  if (statusCode) {
    return `[HTTP ${statusCode}] ${baseMsg}`;
  }
  return baseMsg;
}

/** 指定ミリ秒待機するユーティリティ */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sendSessionInviteEmail({
  toEmail,
  toName,
  sessionUrl,
  scheduledAt,
  durationMinutes,
  brandName = "angelique",
  mainColor = "#f3e7e5",
  accentColor = "#c9a8a3",
}: {
  toEmail: string;
  toName: string;
  sessionUrl: string;
  scheduledAt: Date;
  durationMinutes: number;
  brandName?: string;
  mainColor?: string;
  accentColor?: string;
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
    body { font-family: 'Noto Sans JP', sans-serif; background: ${mainColor}; color: #4a3b38; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 40px auto; background: #fff; border-radius: 20px; padding: 40px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
    .logo { font-family: 'Cormorant Garamond', serif; font-size: 28px; color: ${accentColor}; text-align: center; margin-bottom: 8px; }
    .subtitle { text-align: center; color: #9e8480; font-size: 13px; margin-bottom: 32px; }
    h2 { color: #4a3b38; font-size: 18px; }
    .info-box { background: ${mainColor}; border-radius: 12px; padding: 20px; margin: 24px 0; }
    .info-row { display: flex; margin-bottom: 8px; }
    .info-label { color: #9e8480; min-width: 120px; font-size: 14px; }
    .info-value { color: #4a3b38; font-size: 14px; font-weight: 600; }
    .btn { display: block; width: fit-content; margin: 32px auto; background: ${accentColor}; color: #ffffff; text-decoration: none; padding: 14px 40px; border-radius: 24px; font-size: 16px; font-weight: 600; }
    .notice { background: ${mainColor}; border-radius: 12px; padding: 16px; font-size: 13px; color: #9e8480; margin-top: 24px; }
    .footer { text-align: center; color: #bbb; font-size: 12px; margin-top: 32px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">✦ ${brandName} ✦</div>
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
    <div class="footer">${brandName} &copy; ${new Date().getFullYear()}</div>
  </div>
</body>
</html>
`;

  const message = {
    to: { email: toEmail, name: toName },
    from: { email: fromEmail, name: brandName },
    subject: `【${brandName}】セッションのご案内 - ${dateStr}`,
    html: htmlContent,
    text: `${toName}様\n\nセッションのご案内です。\n日時：${dateStr}\n時間：${durationMinutes}分\n\n参加URL：${sessionUrl}\n\n※URLは本人のみご利用ください。`,
  };

  // 最大3回試行（初回 + リトライ2回）
  // 429（Rate exceeded）の場合は少し待ってリトライする
  const MAX_ATTEMPTS = 3;
  const RETRY_DELAY_MS = 2000; // 2秒待機

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await sgMail.send(message);
      console.log(`[Mailer] Email sent successfully to ${toEmail} (attempt ${attempt})`);
      return { success: true };
    } catch (err: unknown) {
      const sgErr = err as SendGridResponseError;
      const statusCode = sgErr.response?.statusCode ?? sgErr.code;
      const errorMsg = extractSendGridError(err);

      // 詳細ログ出力
      console.error(`[Mailer] SendGrid error (attempt ${attempt}/${MAX_ATTEMPTS}):`, errorMsg);

      // response.body 全体もログ出力（デバッグ用）
      if (sgErr.response?.body) {
        console.error("[Mailer] SendGrid response body:", JSON.stringify(sgErr.response.body));
      }

      // 429 Rate exceeded → リトライ
      if (statusCode === 429 && attempt < MAX_ATTEMPTS) {
        console.warn(`[Mailer] Rate limited (429). Retrying in ${RETRY_DELAY_MS}ms...`);
        await sleep(RETRY_DELAY_MS);
        continue;
      }

      // それ以外のエラー、またはリトライ上限に達した場合は失敗を返す
      return { success: false, error: errorMsg };
    }
  }

  // ここには到達しないが TypeScript のために
  return { success: false, error: "Max retry attempts exceeded" };
}
