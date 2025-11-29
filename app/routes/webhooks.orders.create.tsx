import type { ActionFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import { handleOrdersCreate } from "../services/orders-create.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  await handleOrdersCreate(shop, payload);

  return new Response();
};
