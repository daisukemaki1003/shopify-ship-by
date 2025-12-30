import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import type { Session } from "@shopify/shopify-api";

import { unauthenticated } from "../shopify.server";

interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  action?: string;
}

type ResponseLike = {
  status?: number;
  headers?: Headers;
};

const RETRYABLE_STATUS = new Set([401, 429]);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function executeWithRetry<T extends ResponseLike>(
  requestFn: () => Promise<T>,
  shop: string,
  { maxAttempts = 2, baseDelayMs = 500, action }: RetryOptions = {},
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await requestFn();

      const status = response.status ?? 200;

      if (!RETRYABLE_STATUS.has(status) || attempt === maxAttempts - 1) {
        return response;
      }

      const retryAfterHeader =
        response.headers instanceof Headers
          ? response.headers.get("Retry-After")
          : null;
      const retryAfterSeconds = retryAfterHeader
        ? Number.parseFloat(retryAfterHeader)
        : NaN;

      const delayMs =
        status === 429 && Number.isFinite(retryAfterSeconds)
          ? retryAfterSeconds * 1000
          : baseDelayMs * (attempt + 1);

      console.warn(
        `[adminClient] retrying ${action ?? "request"} for ${shop} after ${
          status
        } (attempt ${attempt + 2}/${maxAttempts})`,
      );

      await sleep(delayMs);
    } catch (error) {
      lastError = error;

      if (attempt === maxAttempts - 1) {
        throw error;
      }

      console.warn(
        `[adminClient] retrying ${action ?? "request"} for ${shop} after error`,
        error,
      );
      await sleep(baseDelayMs * (attempt + 1));
    }
  }

  if (lastError) {
    throw lastError;
  }

  throw new Error("Unknown admin client retry failure");
}

export interface AdminClient {
  admin: AdminApiContext;
  session: Session;
  withRetry: (
    requestFn: (admin: AdminApiContext) => Promise<ResponseLike>,
    options?: RetryOptions,
  ) => Promise<ResponseLike>;
}

export async function getAdminClient(shop: string): Promise<AdminClient> {
  const { admin, session } = await unauthenticated.admin(shop);

  const withRetry = (
    requestFn: (admin: AdminApiContext) => Promise<ResponseLike>,
    options?: RetryOptions,
  ) => executeWithRetry(() => requestFn(admin), session.shop, options);

  return { admin, session, withRetry };
}

export type GraphqlClient = AdminApiContext["graphql"];

export async function graphqlWithRetry(
  shop: string,
  request: Parameters<AdminApiContext["graphql"]>[0],
  init?: Parameters<AdminApiContext["graphql"]>[1],
  options?: RetryOptions,
): Promise<Awaited<ReturnType<AdminApiContext["graphql"]>>> {
  const { admin, session } = await unauthenticated.admin(shop);

  return executeWithRetry(
    () => admin.graphql(request, init),
    session.shop,
    { ...options, action: options?.action ?? "graphql" },
  );
}
