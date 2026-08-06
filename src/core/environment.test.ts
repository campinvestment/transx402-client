import { afterEach, describe, expect, test, vi } from "vitest";
import {
  resolveFacilitatorUrl,
  FACILITATOR_PRESETS,
  assertApiKeyMatchesEnvironment,
} from "./environment.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("environment resolution", () => {
  test("local maps to localhost:3402", () => {
    const resolved = resolveFacilitatorUrl({
      apiKey: "ipk_sandbox_test",
      environment: "local",
      settlement: "direct",
    });
    expect(resolved.facilitatorUrl).toBe(FACILITATOR_PRESETS.local);
    expect(resolved.configSection).toBe("sandbox");
  });

  test("environment without apiKey resolves for server settlement", () => {
    const resolved = resolveFacilitatorUrl({
      environment: "local",
    });
    expect(resolved.facilitatorUrl).toBe(FACILITATOR_PRESETS.local);
    expect(resolved.configSection).toBe("sandbox");
  });

  test("camp without apiKey resolves sandbox config section", () => {
    const resolved = resolveFacilitatorUrl({
      environment: "camp",
    });
    expect(resolved.facilitatorUrl).toBe("https://api.transx402.com");
    expect(resolved.configSection).toBe("sandbox");
  });

  test("camp maps to hosted facilitator with sandbox config", () => {
    const resolved = resolveFacilitatorUrl({
      apiKey: "ipk_sandbox_test",
      environment: "camp",
      settlement: "direct",
    });
    expect(resolved.facilitatorUrl).toBe("https://api.transx402.com");
    expect(resolved.configSection).toBe("sandbox");
  });

  test("base maps to production API URL", () => {
    const resolved = resolveFacilitatorUrl({
      apiKey: "ipk_live_test",
      environment: "base",
      settlement: "direct",
    });
    expect(resolved.facilitatorUrl).toBe(FACILITATOR_PRESETS.base);
    expect(resolved.configSection).toBe("production");
  });

  test("camp with facilitatorUrl override uses custom host and sandbox section", () => {
    const resolved = resolveFacilitatorUrl({
      environment: "camp",
      facilitatorUrl: "http://localhost:3402",
    });
    expect(resolved.facilitatorUrl).toBe("http://localhost:3402");
    expect(resolved.configSection).toBe("sandbox");
    expect(resolved.environment).toBe("camp");
  });

  test("base with facilitatorUrl override uses custom host and production section", () => {
    const resolved = resolveFacilitatorUrl({
      apiKey: "ipk_live_test",
      environment: "base",
      facilitatorUrl: "http://localhost:3402",
      settlement: "direct",
    });
    expect(resolved.facilitatorUrl).toBe("http://localhost:3402");
    expect(resolved.configSection).toBe("production");
    expect(resolved.environment).toBe("base");
  });

  test("throws when neither environment nor facilitatorUrl is set", () => {
    expect(() =>
      resolveFacilitatorUrl({
        apiKey: "ipk_sandbox_test",
        settlement: "direct",
      } as never)
    ).toThrow(/Set `environment`/i);
  });

  test("throws when sandbox key used with base environment", () => {
    expect(() =>
      assertApiKeyMatchesEnvironment("ipk_sandbox_test", "base")
    ).toThrow(/does not match environment "base"/);
  });

  test("throws when live key used with local environment", () => {
    expect(() =>
      assertApiKeyMatchesEnvironment("ipk_live_test", "local")
    ).toThrow(/does not match environment "local"/);
  });

  test("publishable sandbox key resolves with local environment", () => {
    const resolved = resolveFacilitatorUrl({
      apiKey: "ipk_pub_sandbox_test",
      environment: "local",
      settlement: "direct",
    });
    expect(resolved.facilitatorUrl).toBe(FACILITATOR_PRESETS.local);
    expect(resolved.configSection).toBe("sandbox");
  });

  test("publishable live key resolves with base environment", () => {
    const resolved = resolveFacilitatorUrl({
      apiKey: "ipk_pub_live_test",
      environment: "base",
      settlement: "direct",
    });
    expect(resolved.configSection).toBe("production");
  });

  test("custom facilitatorUrl uses API key family for config section", () => {
    const resolved = resolveFacilitatorUrl({
      apiKey: "ipk_sandbox_test",
      facilitatorUrl: "http://custom.example:3402",
    });
    expect(resolved.facilitatorUrl).toBe("http://custom.example:3402");
    expect(resolved.configSection).toBe("sandbox");
    expect(resolved.environment).toBeNull();
  });

  test("configProxyPath uses same-origin base for server settlement", () => {
    const resolved = resolveFacilitatorUrl({
      environment: "camp",
      configProxyPath: "/api/transx402",
    });
    expect(resolved.facilitatorUrl).toBe("/api/transx402");
    expect(resolved.configSection).toBe("sandbox");
  });

  test("configProxyPath normalizes trailing slashes", () => {
    const resolved = resolveFacilitatorUrl({
      environment: "camp",
      configProxyPath: "/api/transx402/",
    });
    expect(resolved.facilitatorUrl).toBe("/api/transx402");
  });

  test("throws when configProxyPath and facilitatorUrl are both set", () => {
    expect(() =>
      resolveFacilitatorUrl({
        environment: "camp",
        configProxyPath: "/api/transx402",
        facilitatorUrl: "http://localhost:3402",
      })
    ).toThrow(/either `facilitatorUrl` or `configProxyPath`/i);
  });

  test("throws when configProxyPath used with direct settlement", () => {
    expect(() =>
      resolveFacilitatorUrl({
        environment: "camp",
        configProxyPath: "/api/transx402",
        settlement: "direct",
        apiKey: "ipk_sandbox_test",
      })
    ).toThrow(/only supported for server settlement/i);
  });
});
