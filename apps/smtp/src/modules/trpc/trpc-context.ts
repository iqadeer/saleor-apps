import { SALEOR_API_URL_HEADER, SALEOR_AUTHORIZATION_BEARER_HEADER } from "@saleor/app-sdk/headers";
import { type inferAsyncReturnType } from "@trpc/server";
import type * as trpcNext from "@trpc/server/adapters/next";

import { env } from "../../env";
import { getBaseUrl } from "../../lib/get-base-url";

/**
 * Base URL of this app as seen from the Saleor instance, not from the browser.
 * Used to build webhook target URLs, which the Saleor backend calls - e.g. in
 * local dev the browser reaches the app at `localhost` while Saleor (running in
 * Docker) reaches it via `host.docker.internal`.
 */
const getAppBaseUrl = (headers: { [name: string]: string | string[] | undefined }) =>
  env.APP_API_BASE_URL || getBaseUrl(headers);

export const createTrpcContext = async ({ req }: trpcNext.CreateNextContextOptions) => {
  const baseUrl = getAppBaseUrl(req.headers);

  return {
    token: req.headers[SALEOR_AUTHORIZATION_BEARER_HEADER] as string | undefined,
    saleorApiUrl: req.headers[SALEOR_API_URL_HEADER] as string | undefined,
    appId: undefined as undefined | string,
    ssr: undefined as undefined | boolean,
    baseUrl,
  };
};

export type TrpcContext = inferAsyncReturnType<typeof createTrpcContext>;
