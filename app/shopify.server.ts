import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import { DeliveryMethod } from "@shopify/shopify-api";
import prisma from "./db.server";
import { upsertShopFromSession } from "./services/shop.server";
import { ensureShipByMetafieldDefinition } from "./services/ship-by-metafield.server";

const defaultScopes = [
  "read_orders",
  "write_orders",
  "read_products",
  "read_shipping",
];

const envScopes = process.env.SCOPES?.split(",")
  .map((scope) => scope.trim())
  .filter(Boolean);

const scopes = envScopes?.length ? envScopes : defaultScopes;

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.October25,
  scopes,
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  webhooks: {
    APP_UNINSTALLED: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/app/uninstalled",
    },
    APP_SCOPES_UPDATE: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/app/scopes_update",
    },
    ORDERS_CREATE: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/orders/create",
    },
  },
  hooks: {
    afterAuth: async ({ session }) => {
      await upsertShopFromSession(session);
      await shopify.registerWebhooks({ session });
      try {
        await ensureShipByMetafieldDefinition(session.shop);
      } catch (error) {
        console.error("[shopify] failed to ensure ship-by metafield", error);
      }
    },
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.October25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
