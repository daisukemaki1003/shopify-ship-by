import { useFetcher, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  getShippingMethodSettings,
  setShippingMethodEnabled,
  syncShippingMethodSettings,
} from "../services/shipping-rates.server";

type ShippingMethodSettings = Awaited<
  ReturnType<typeof getShippingMethodSettings>
>;

type LoaderData = {
  shop: string;
  settings: ShippingMethodSettings;
};

type ActionData = { settings: ShippingMethodSettings };

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const settings = await getShippingMethodSettings(session.shop);

  return { shop: session.shop, settings };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const actionType = form.get("_action");

  if (actionType === "sync") {
    const settings = await syncShippingMethodSettings(session.shop);
    return { settings };
  }

  if (actionType === "toggle") {
    const key = String(form.get("key") ?? "");
    const enabled = form.get("enabled") === "true";
    const settings = await setShippingMethodEnabled(session.shop, key, enabled);
    return { settings };
  }

  return { settings: await getShippingMethodSettings(session.shop) };
};

export default function SettingsPage() {
  const loaderData = useLoaderData<LoaderData>();
  const syncFetcher = useFetcher<ActionData>();
  const toggleFetcher = useFetcher<ActionData>();

  const settings =
    toggleFetcher.data?.settings ??
    syncFetcher.data?.settings ??
    loaderData.settings;

  const entries = Object.entries(settings);

  return (
    <s-page heading="設定">
      <s-section heading="配送方法">
        <s-stack direction="inline" gap="base">
          <syncFetcher.Form method="post">
            <input type="hidden" name="_action" value="sync" />
            <s-button type="submit" {...(syncFetcher.state !== "idle"
                ? { loading: true }
                : {})}>
              配送方法を同期
            </s-button>
          </syncFetcher.Form>
          <s-text>Shop: {loaderData.shop}</s-text>
        </s-stack>

        {entries.length === 0 ? (
          <s-box padding="base" background="subdued" borderWidth="base">
            <s-text>配送方法がありません。同期ボタンを押してください。</s-text>
          </s-box>
        ) : (
          <s-stack direction="block" gap="base">
            {entries.map(([key, value]) => (
              <s-box
                key={key}
                padding="base"
                background="subdued"
                borderWidth="base"
                borderRadius="base"
              >
                <s-stack direction="inline" gap="base">
                  <s-text>{value.title || key}</s-text>
                  <s-badge tone={value.enabled ? "success" : "warning"}>
                    {value.enabled ? "有効" : "無効"}
                  </s-badge>
                  <s-text>
                    {value.price ? `${value.price} ${value.currency ?? ""}` : ""}
                  </s-text>
                  <s-text>code: {key}</s-text>
                  <toggleFetcher.Form method="post" style={{ marginLeft: "auto" }}>
                    <input type="hidden" name="_action" value="toggle" />
                    <input type="hidden" name="key" value={key} />
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
