import type * as trpcNext from "@trpc/server/adapters/next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reqWithHeaders = (headers: { [name: string]: string }) =>
  ({ req: { headers } }) as unknown as trpcNext.CreateNextContextOptions;

describe("createTrpcContext", () => {
  beforeEach(() => {
    vi.stubEnv("SECRET_KEY", "test_secret_key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("prefers APP_API_BASE_URL over the request Host header", async () => {
    vi.stubEnv("APP_API_BASE_URL", "http://host.docker.internal:3002");
    const { createTrpcContext } = await import("./trpc-context");

    const ctx = await createTrpcContext(reqWithHeaders({ host: "localhost:3002" }));

    expect(ctx.baseUrl).toBe("http://host.docker.internal:3002");
  });

  it("falls back to the request Host header when APP_API_BASE_URL is not set", async () => {
    vi.stubEnv("APP_API_BASE_URL", "");
    const { createTrpcContext } = await import("./trpc-context");

    const ctx = await createTrpcContext(reqWithHeaders({ host: "localhost:3002" }));

    expect(ctx.baseUrl).toBe("http://localhost:3002");
  });

  it("still extracts the saleor-api-url and authorization-bearer headers", async () => {
    const { createTrpcContext } = await import("./trpc-context");

    const ctx = await createTrpcContext(
      reqWithHeaders({
        host: "localhost:3002",
        "saleor-api-url": "http://api.childnest.co.uk:8080/graphql/",
        "authorization-bearer": "dummy-client-token",
      }),
    );

    expect(ctx.saleorApiUrl).toBe("http://api.childnest.co.uk:8080/graphql/");
    expect(ctx.token).toBe("dummy-client-token");
  });
});
