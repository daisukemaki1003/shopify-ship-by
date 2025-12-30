import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { updateShopScope } from "../features/shop/server/shop.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, session, topic, shop } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  const current = Array.isArray(payload.current)
    ? payload.current
    : [payload.current].filter(Boolean);
  const scope = current.join(",");

  if (session) {
    await db.session.update({
      where: { id: session.id },
      data: { scope },
    });
  }

  await updateShopScope(shop, scope || null);

  return new Response();
};
