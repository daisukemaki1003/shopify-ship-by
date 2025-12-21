import { graphqlWithRetry } from "./admin-client.server";

const SHIP_BY_NAMESPACE = "ship_by";
const SHIP_BY_KEY = "deadline";

type Result = { ok: true; created: boolean } | { ok: false; message: string };

const extractErrors = (payload: {
  errors?: Array<{ message?: string }>;
  data?: {
    metafieldDefinitionCreate?: {
      userErrors?: Array<{ message?: string }>;
    };
  };
}) => {
  const graphqlErrors = payload.errors?.map((error) => error.message).filter(Boolean) ?? [];
  const userErrors =
    payload.data?.metafieldDefinitionCreate?.userErrors
      ?.map((error) => error.message)
      .filter(Boolean) ?? [];
  return [...graphqlErrors, ...userErrors];
};

export const ensureShipByMetafieldDefinition = async (shop: string): Promise<Result> => {
  try {
    const lookupResponse = await graphqlWithRetry(
      shop,
      `#graphql
      query ShipByMetafieldDefinition($namespace: String!, $key: String!) {
        metafieldDefinition(namespace: $namespace, key: $key, ownerType: ORDER) {
          id
        }
      }`,
      { variables: { namespace: SHIP_BY_NAMESPACE, key: SHIP_BY_KEY } },
      { action: "ship_by_definition_lookup" },
    );

    const lookupJson = (await lookupResponse.json()) as {
      data?: { metafieldDefinition?: { id?: string | null } | null };
      errors?: Array<{ message?: string }>;
    };

    if (lookupJson.errors?.length) {
      return { ok: false, message: "Failed to read metafield definition" };
    }

    if (lookupJson.data?.metafieldDefinition?.id) {
      return { ok: true, created: false };
    }

    const createResponse = await graphqlWithRetry(
      shop,
      `#graphql
      mutation ShipByMetafieldDefinitionCreate($definition: MetafieldDefinitionInput!) {
        metafieldDefinitionCreate(definition: $definition) {
          createdDefinition {
            id
          }
          userErrors {
            message
          }
        }
      }`,
      {
        variables: {
          definition: {
            name: "Ship by deadline",
            namespace: SHIP_BY_NAMESPACE,
            key: SHIP_BY_KEY,
            type: "date",
            ownerType: "ORDER",
            description: "Auto-created by ShipBy app",
            visibleToStorefrontApi: false,
          },
        },
      },
      { action: "ship_by_definition_create" },
    );

    const createJson = (await createResponse.json()) as {
      data?: {
        metafieldDefinitionCreate?: {
          createdDefinition?: { id?: string | null } | null;
          userErrors?: Array<{ message?: string }>;
        };
      };
      errors?: Array<{ message?: string }>;
    };

    const errors = extractErrors(createJson);
    if (errors.length > 0) {
      return { ok: false, message: errors.join("; ") };
    }

    if (!createJson.data?.metafieldDefinitionCreate?.createdDefinition?.id) {
      return { ok: false, message: "Metafield definition create returned no id" };
    }

    return { ok: true, created: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return { ok: false, message };
  }
};
