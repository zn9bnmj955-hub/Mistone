import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("./staff", () => ({ getStaffActor: async () => null }));

const { clientAddress, clientIp, ipRateLimitKey } = await import("./http");
const req = (headers: Record<string, string>) => ({ headers: new Headers(headers) });

describe("client IP for rate limits", () => {
  it("prefers the hosting platform's header", () => {
    expect(clientIp(req({ "x-nf-client-connection-ip": "198.51.100.7", "x-forwarded-for": "1.2.3.4" }))).toBe("198.51.100.7");
  });
  it("ignores the spoofable left-most forwarded value", () => {
    expect(clientIp(req({ "x-forwarded-for": "203.0.113.77, 198.51.100.9" }))).toBe("198.51.100.9");
  });
  it("falls back to a fixed key locally", () => {
    expect(clientIp(req({}))).toBe("local");
    expect(clientAddress(req({}))).toBeNull();
  });
  it("uses the /64 prefix of the platform's IPv6 address", () => {
    const a = clientIp(req({ "x-nf-client-connection-ip": "2001:db8:abcd:12:1111:2222:3333:4444" }));
    const b = clientIp(req({ "x-nf-client-connection-ip": "2001:0DB8:ABCD:0012:ffff:0:0:1" }));
    expect(a).toBe("2001:db8:abcd:12::/64");
    expect(b).toBe(a);
    expect(clientIp(req({ "x-forwarded-for": "9.9.9.9, 2001:db8:abcd:12::99" }))).toBe(a);
  });
  it("keeps the real address for services that need it (Turnstile)", () => {
    expect(clientAddress(req({ "x-nf-client-connection-ip": "2001:db8:abcd:12::99" }))).toBe("2001:db8:abcd:12::99");
  });
  it("shares one logged key for an unreadable address", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(clientIp(req({ "x-nf-client-connection-ip": "not-an-ip" }))).toBe("unknown");
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

describe("rate-limit key of an address", () => {
  it("keeps IPv4 as is", () => {
    expect(ipRateLimitKey("198.51.100.7")).toBe("198.51.100.7");
    expect(ipRateLimitKey(" 198.51.100.7:4433 ")).toBe("198.51.100.7");
  });
  it("gives the same key to two addresses of the same /64", () => {
    expect(ipRateLimitKey("2a01:e0a:1:2:aaaa::1")).toBe(ipRateLimitKey("2a01:e0a:1:2:bbbb:cccc:dddd:eeee"));
  });
  it("gives different keys to neighbouring /64", () => {
    expect(ipRateLimitKey("2a01:e0a:1:2::1")).not.toBe(ipRateLimitKey("2a01:e0a:1:3::1"));
  });
  it("normalizes compression, leading zeros, case, zone and brackets", () => {
    const key = "2001:db8:0:1::/64";
    for (const a of [
      "2001:db8:0:1::5",
      "2001:0db8:0000:0001:0000:0000:0000:0005",
      "2001:DB8::1:0:0:0:5",
      "2001:db8:0:1::5%eth0",
      "[2001:db8:0:1::5]",
      "[2001:db8:0:1::5]:443",
      "2001:db8:0:1:0:0:1.2.3.4",
    ]) expect(ipRateLimitKey(a)).toBe(key);
    expect(ipRateLimitKey("::1")).toBe("0:0:0:0::/64");
    expect(ipRateLimitKey("::")).toBe("0:0:0:0::/64");
  });
  it("treats IPv4-mapped IPv6 as IPv4", () => {
    expect(ipRateLimitKey("::ffff:1.2.3.4")).toBe("1.2.3.4");
    expect(ipRateLimitKey("::FFFF:0102:0304")).toBe("1.2.3.4");
    expect(ipRateLimitKey("0:0:0:0:0:ffff:1.2.3.4")).toBe("1.2.3.4");
  });
  it("rejects unreadable addresses", () => {
    for (const a of ["", "local", "1.2.3", "256.1.1.1", "1.2.3.4.5", "2001:db8::1::2", "2001:db8:1:2:3:4:5:6:7", "1:2:3:4:5:6:7", "12345::1", "g::1", ":::", "::ffff:1.2.3.999", "1.2.3.4::"]) {
      expect(ipRateLimitKey(a)).toBeNull();
    }
  });
});
