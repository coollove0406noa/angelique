import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @sendgrid/mail
vi.mock("@sendgrid/mail", () => ({
  default: {
    setApiKey: vi.fn(),
    send: vi.fn().mockResolvedValue([{ statusCode: 202 }]),
  },
}));

import sgMail from "@sendgrid/mail";
import { sendSessionInviteEmail } from "./mailer";

describe("sendSessionInviteEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns error when SENDGRID_API_KEY is not set", async () => {
    const original = process.env.SENDGRID_API_KEY;
    delete process.env.SENDGRID_API_KEY;

    const result = await sendSessionInviteEmail({
      toEmail: "test@example.com",
      toName: "テスト太郎",
      sessionUrl: "https://example.com/session/abc123",
      scheduledAt: new Date("2026-04-10T10:00:00Z"),
      durationMinutes: 60,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("SENDGRID_API_KEY not configured");
    process.env.SENDGRID_API_KEY = original;
  });

  it("calls sgMail.send with correct params when API key is set", async () => {
    process.env.SENDGRID_API_KEY = "SG.test_key_for_validation";
    process.env.SENDGRID_FROM_EMAIL = "info@noakayou.com";

    const result = await sendSessionInviteEmail({
      toEmail: "client@example.com",
      toName: "山田花子",
      sessionUrl: "https://angeliqueapp.manus.space/session/tok123",
      scheduledAt: new Date("2026-04-15T14:00:00+09:00"),
      durationMinutes: 60,
    });

    expect(sgMail.setApiKey).toHaveBeenCalledWith("SG.test_key_for_validation");
    expect(sgMail.send).toHaveBeenCalledTimes(1);

    const callArg = vi.mocked(sgMail.send).mock.calls[0][0] as {
      to: { email: string; name: string };
      from: { email: string; name: string };
      subject: string;
    };
    expect(callArg.to).toMatchObject({ email: "client@example.com", name: "山田花子" });
    expect(callArg.from).toMatchObject({ email: "info@noakayou.com", name: "angelique" });
    expect(callArg.subject).toContain("angelique");
    expect(result.success).toBe(true);
  });

  it("returns error when sgMail.send throws", async () => {
    process.env.SENDGRID_API_KEY = "SG.test_key";
    vi.mocked(sgMail.send).mockRejectedValueOnce(new Error("Unauthorized"));

    const result = await sendSessionInviteEmail({
      toEmail: "fail@example.com",
      toName: "失敗テスト",
      sessionUrl: "https://example.com/session/fail",
      scheduledAt: new Date(),
      durationMinutes: 30,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Unauthorized");
  });
});
