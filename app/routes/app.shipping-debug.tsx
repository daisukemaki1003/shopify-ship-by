import {useLoaderData} from "react-router";
import type {LoaderFunctionArgs} from "react-router";
import {authenticate} from "../shopify.server";
import {fetchShippingRates} from "../services/shipping-rates.server";

type LoaderData =
  | {ok: true; shop: string; rates: unknown[]}
  | {ok: false; error: string};

export const loader = async ({request}: LoaderFunctionArgs) => {
  try {
    const {session} = await authenticate.admin(request);
    const rates = await fetchShippingRates(session.shop);

    console.log("[shipping-debug]", session.shop, rates);

    return {ok: true, shop: session.shop, rates} as LoaderData;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error fetching rates";
    console.error("[shipping-debug:error]", message);
    return {ok: false, error: message} as LoaderData;
  }
};

export default function ShippingDebug() {
  const data = useLoaderData<LoaderData>();

  return (
    <s-page heading="Shipping rates debug">
      <s-section heading="Result">
        <s-box padding="base" background="subdued" borderWidth="base">
          <pre style={{margin: 0, whiteSpace: "pre-wrap"}}>
            {JSON.stringify(data, null, 2)}
          </pre>
        </s-box>
      </s-section>
    </s-page>
  );
}

