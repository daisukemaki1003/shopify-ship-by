import {graphqlWithRetry} from "./admin-client.server";
import {toISODate} from "./ship-by.server";

export const SHIP_BY_METAFIELD = {
  namespace: "shipping",
  key: "ship_by",
  type: "date",
  name: "Ship-by date",
  description: "Calculated ship-by date",
  ownerType: "ORDER",
} as const;

type MetafieldSetInput = {
  ownerId: string;
  namespace: string;
  key: string;
  type: string;
  value: string;
};

export const buildShipByMetafieldInput = (
  orderGid: string,
  shipBy: Date,
): MetafieldSetInput => ({
  ownerId: orderGid,
  namespace: SHIP_BY_METAFIELD.namespace,
  key: SHIP_BY_METAFIELD.key,
  type: SHIP_BY_METAFIELD.type,
  value: toISODate(shipBy),
});

export const ensureShipByMetafieldDefinition = async (shop: string) => {
  const response = await graphqlWithRetry(
    shop,
    `#graphql
    mutation ShipByMetafieldDefinitionCreate($definition: MetafieldDefinitionInput!) {
      metafieldDefinitionCreate(definition: $definition) {
        createdDefinition {
          id
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        definition: {
          name: SHIP_BY_METAFIELD.name,
          namespace: SHIP_BY_METAFIELD.namespace,
          key: SHIP_BY_METAFIELD.key,
          type: SHIP_BY_METAFIELD.type,
          ownerType: SHIP_BY_METAFIELD.ownerType,
          description: SHIP_BY_METAFIELD.description,
        },
      },
    },
    {action: "metafield_definition_create"},
  );

  if (!response.ok) {
    throw new Error(
      `metafieldDefinitionCreate failed: ${response.status} ${response.statusText}`,
    );
  }

  const payload = await response.json();
  const userErrors = payload?.data?.metafieldDefinitionCreate?.userErrors ?? [];

  if (Array.isArray(userErrors) && userErrors.length > 0) {
    console.warn("[ship-by-metafield] definition create errors", userErrors);
  }
};
