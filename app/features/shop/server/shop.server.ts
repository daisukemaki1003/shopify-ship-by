import type { Session } from "@shopify/shopify-api";

import prisma from "../../db.server";

// Prisma client in this environment lacks generated Shop types; cast for now.
type ShopDelegate = {
  upsert: (...args: unknown[]) => Promise<unknown>;
  updateMany: (...args: unknown[]) => Promise<unknown>;
  update: (...args: unknown[]) => Promise<unknown>;
  findUnique: (...args: unknown[]) => Promise<unknown>;
};

const db = prisma as typeof prisma & { shop: ShopDelegate };

export async function upsertShopFromSession(session: Session) {
  const shopDomain = session.shop;

  await db.shop.upsert({
    where: { id: shopDomain },
    update: {
      shopDomain,
      accessToken: session.accessToken,
      scope: session.scope,
      uninstalledAt: null,
    },
    create: {
      id: shopDomain,
      shopDomain,
      accessToken: session.accessToken,
      scope: session.scope,
      installedAt: new Date(),
    },
  });
}

export async function markShopUninstalled(shopDomain: string) {
  await db.shop.upsert({
    where: { id: shopDomain },
    update: { accessToken: null, uninstalledAt: new Date() },
    create: {
      id: shopDomain,
      shopDomain,
      accessToken: null,
      scope: null,
      installedAt: new Date(),
      uninstalledAt: new Date(),
    },
  });
}

export async function updateShopScope(
  shopDomain: string,
  scope: string | null,
) {
  await db.shop.upsert({
    where: { id: shopDomain },
    create: {
      id: shopDomain,
      shopDomain,
      scope: scope ?? undefined,
      installedAt: new Date(),
    },
    update: {
      scope,
    },
  });
}
