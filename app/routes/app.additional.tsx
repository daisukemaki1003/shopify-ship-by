import {BlockStack, Card, Layout, Link, List, Page, Text} from "@shopify/polaris";

export default function AdditionalPage() {
  return (
    <Page title="Additional page">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">
                Multiple pages
              </Text>
              <Text as="p">
                The app template comes with an additional page which demonstrates how to create
                multiple pages within app navigation using{" "}
                <Link url="https://shopify.dev/docs/apps/tools/app-bridge" target="_blank">
                  App Bridge
                </Link>
                .
              </Text>
              <Text as="p">
                To create your own page and have it show up in the app navigation, add a page
                inside <code>app/routes</code>, and a link to it in the{" "}
                <code>&lt;ui-nav-menu&gt;</code> component found in{" "}
                <code>app/routes/app.tsx</code>.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">
                Resources
              </Text>
              <List>
                <List.Item>
                  <Link
                    url="https://shopify.dev/docs/apps/design-guidelines/navigation#app-nav"
                    target="_blank"
                  >
                    App nav best practices
                  </Link>
                </List.Item>
              </List>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
