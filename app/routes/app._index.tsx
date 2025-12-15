import { useEffect } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { BlockStack, Button, Card, InlineStack, Layout, Link, List, Page, Text } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  return null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const color = ["Red", "Orange", "Yellow", "Green"][
    Math.floor(Math.random() * 4)
  ];
  const response = await admin.graphql(
    `#graphql
      mutation populateProduct($product: ProductCreateInput!) {
        productCreate(product: $product) {
          product {
            id
            title
            handle
            status
            variants(first: 10) {
              edges {
                node {
                  id
                  price
                  barcode
                  createdAt
                }
              }
            }
          }
        }
      }`,
    {
      variables: {
        product: {
          title: `${color} Snowboard`,
        },
      },
    },
  );
  const responseJson = await response.json();

  const product = responseJson.data!.productCreate!.product!;
  const variantId = product.variants.edges[0]!.node!.id!;

  const variantResponse = await admin.graphql(
    `#graphql
    mutation shopifyReactRouterTemplateUpdateVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        productVariants {
          id
          price
          barcode
          createdAt
        }
      }
    }`,
    {
      variables: {
        productId: product.id,
        variants: [{ id: variantId, price: "100.00" }],
      },
    },
  );

  const variantResponseJson = await variantResponse.json();

  return {
    product: responseJson!.data!.productCreate!.product,
    variant:
      variantResponseJson!.data!.productVariantsBulkUpdate!.productVariants,
  };
};

export default function Index() {
  const fetcher = useFetcher<typeof action>();

  const shopify = useAppBridge();
  const isLoading =
    ["loading", "submitting"].includes(fetcher.state) &&
    fetcher.formMethod === "POST";

  useEffect(() => {
    if (fetcher.data?.product?.id) {
      shopify.toast.show("Product created");
    }
  }, [fetcher.data?.product?.id, shopify]);

  const generateProduct = () => fetcher.submit({}, { method: "POST" });

  return (
    <Page
      title="Shopify app template"
      primaryAction={
        <Button variant="primary" onClick={generateProduct} loading={isLoading}>
          Generate a product
        </Button>
      }
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">
                  Congrats on creating a new Shopify app
                </Text>
                <Text as="p">
                  This embedded app template uses{" "}
                  <Link url="https://shopify.dev/docs/apps/tools/app-bridge" target="_blank">
                    App Bridge
                  </Link>{" "}
                  interface examples like an <Link url="/app/additional">additional page</Link>, as well as an{" "}
                  <Link url="https://shopify.dev/docs/api/admin-graphql" target="_blank">
                    Admin GraphQL
                  </Link>{" "}
                  mutation demo, to provide a starting point for app development.
                </Text>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">
                  Get started with products
                </Text>
                <Text as="p">
                  Generate a product with GraphQL and get the JSON output for that product. Learn more about the{" "}
                  <Link
                    url="https://shopify.dev/docs/api/admin-graphql/latest/mutations/productCreate"
                    target="_blank"
                  >
                    productCreate
                  </Link>{" "}
                  mutation in our API references.
                </Text>
                <InlineStack gap="200">
                  <Button onClick={generateProduct} loading={isLoading}>
                    Generate a product
                  </Button>
                  {fetcher.data?.product && (
                    <Button
                      variant="tertiary"
                      onClick={() => {
                        shopify.intents.invoke?.("edit:shopify/Product", {
                          value: fetcher.data?.product?.id,
                        });
                      }}
                    >
                      Edit product
                    </Button>
                  )}
                </InlineStack>

                {fetcher.data?.product ? (
                  <BlockStack gap="200">
                    <Text as="h3" variant="headingSm">
                      productCreate mutation
                    </Text>
                    <div style={{margin: 0}}>
                      <pre style={{margin: 0}}>
                        <code>{JSON.stringify(fetcher.data.product, null, 2)}</code>
                      </pre>
                    </div>
                    <Text as="h3" variant="headingSm">
                      productVariantsBulkUpdate mutation
                    </Text>
                    <div style={{margin: 0}}>
                      <pre style={{margin: 0}}>
                        <code>{JSON.stringify(fetcher.data.variant, null, 2)}</code>
                      </pre>
                    </div>
                  </BlockStack>
                ) : null}
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">
                  App template specs
                </Text>
                <List>
                  <List.Item>
                    Framework: <Link url="https://reactrouter.com/" target="_blank">React Router</Link>
                  </List.Item>
                  <List.Item>
                    Interface: <Text as="span">Polaris (React)</Text>
                  </List.Item>
                  <List.Item>
                    API: <Link url="https://shopify.dev/docs/api/admin-graphql" target="_blank">GraphQL</Link>
                  </List.Item>
                  <List.Item>
                    Database: <Link url="https://www.prisma.io/" target="_blank">Prisma</Link>
                  </List.Item>
                </List>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">
                  Next steps
                </Text>
                <List>
                  <List.Item>
                    <Link
                      url="https://shopify.dev/docs/apps/getting-started/build-app-example"
                      target="_blank"
                    >
                      Build an example app
                    </Link>
                  </List.Item>
                  <List.Item>
                    <Link url="https://shopify.dev/docs/apps/tools/graphiql-admin-api" target="_blank">
                      Explore Shopify&apos;s API with GraphiQL
                    </Link>
                  </List.Item>
                </List>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
