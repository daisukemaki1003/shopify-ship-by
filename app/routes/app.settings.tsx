import { useFetcher, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  getShippingRates,
  setShippingRateEnabled,
  syncShippingRates,
  type ShippingRateEntry,
} from "../services/shipping-rates.server";

type LoaderData = {
  shop: string;
  shippingRates: ShippingRateEntry[];
};

type ActionData = { shippingRates: ShippingRateEntry[] };

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shippingRates = await getShippingRates(session.shop);

  return { shop: session.shop, shippingRates };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const actionType = form.get("_action");

  if (actionType === "sync") {
    const shippingRates = await syncShippingRates(session.shop);
    return { shippingRates };
  }

  if (actionType === "toggle") {
    const key = String(form.get("key") ?? "");
    const enabled = form.get("enabled") === "true";
    const shippingRates = await setShippingRateEnabled(session.shop, key, enabled);
    return { shippingRates };
  }

  return { shippingRates: await getShippingRates(session.shop) };
};

export default function SettingsPage() {
  const loaderData = useLoaderData<LoaderData>();
  const syncFetcher = useFetcher<ActionData>();
  const toggleFetcher = useFetcher<ActionData>();

  const shippingRates =
    toggleFetcher.data?.shippingRates ??
    syncFetcher.data?.shippingRates ??
    loaderData.shippingRates;

  const entries = shippingRates;

  return (
    <s-page heading="設定">
      <s-section heading="配送ケース（Shipping Rates）">
        <s-stack direction="inline" gap="base">
          <syncFetcher.Form method="post">
            <input type="hidden" name="_action" value="sync" />
            <s-button type="submit" {...(syncFetcher.state !== "idle"
                ? { loading: true }
                : {})}>
              配送ケースを同期
            </s-button>
          </syncFetcher.Form>
          <s-text>Shop: {loaderData.shop}</s-text>
        </s-stack>

        {entries.length === 0 ? (
          <s-box padding="base" background="subdued" borderWidth="base">
            <s-text>配送ケースがありません。同期ボタンを押してください。</s-text>
          </s-box>
        ) : (
          <s-stack direction="block" gap="base">
            {entries.map((value) => (
              <s-box
                key={value.shippingRateId}
                padding="base"
                background="subdued"
                borderWidth="base"
                borderRadius="base"
              >
                <s-stack direction="inline" gap="base">
                  <s-text>{value.title || value.shippingRateId}</s-text>
                  <s-badge tone={value.enabled ? "success" : "warning"}>
                    {value.enabled ? "有効" : "無効"}
                  </s-badge>
                  {value.zoneName ? <s-text>zone: {value.zoneName}</s-text> : null}
                  <s-text>ID: {value.shippingRateId}</s-text>
                  <s-text>handle: {value.handle}</s-text>
                  <toggleFetcher.Form method="post" style={{ marginLeft: "auto" }}>
                    <input type="hidden" name="_action" value="toggle" />
                    <input type="hidden" name="key" value={value.shippingRateId} />
                    <input
                      type="hidden"
                      name="enabled"
                      value={value.enabled ? "false" : "true"}
                    />
                    <s-button type="submit" variant="tertiary">
                      {value.enabled ? "無効化" : "有効化"}
                    </s-button>
                  </toggleFetcher.Form>
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}
