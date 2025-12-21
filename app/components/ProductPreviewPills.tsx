import {InlineStack, Text, UnstyledButton} from "@shopify/polaris";

import {FALLBACK_PRODUCT_TITLE} from "../utils/products";
import type {ProductSummary} from "../utils/rule-types";

// 選択済み商品をピルで簡易表示し、クリックでピッカーを開くUI
export function ProductPreviewPills({
  products,
  onClick,
  disabled,
}: {
  products: ProductSummary[];
  onClick?: () => void;
  disabled?: boolean;
}) {
  const hasProducts = products.length > 0;
  const isDisabled = Boolean(disabled);
  const content = hasProducts ? (
    <InlineStack gap="100" wrap>
      {products.map((product) => (
        <div
          key={product.id}
          style={{
            display: "flex",
            alignItems: "center",
            background: "#e3e3e3",
            height: "28px",
            borderRadius: "4px",
            padding: "0 6px 0 28px",
            position: "relative",
          }}
        >
          <div
            style={{
              width: "20px",
              height: "20px",
              position: "absolute",
              top: "4px",
              left: "4px",
              overflow: "hidden",
              borderRadius: "4px",
            }}
          >
            <img
              src={product.imageUrl || ""}
              alt={product.title || FALLBACK_PRODUCT_TITLE}
              style={{
                width: "28px",
                height: "28px",
                objectFit: "cover",
                position: "absolute",
                top: "-4px",
                left: "-4px",
              }}
            />
          </div>

          <Text as="span" variant="bodySm">
            {product.title || FALLBACK_PRODUCT_TITLE}
          </Text>
        </div>

      ))}
    </InlineStack>
  ) : (
    <Text as="span" tone="subdued">
      商品を選択
    </Text>
  );

  return (
    <UnstyledButton
      onClick={onClick}
      disabled={isDisabled}
      accessibilityLabel={hasProducts ? "商品を変更" : "商品を選択"}
      style={{
        width: "100%",
        height: "36px",
        padding: "3px",
        margin: 0,
        textAlign: "left",
        cursor: isDisabled ? "not-allowed" : "pointer",
        background: isDisabled ? "#f3f3f3" : "transparent",
        border: "1px solid #ccc",
        borderRadius: "var(--p-border-radius-200)",
        opacity: isDisabled ? 0.6 : 1,
      }}
    >
      {content}

      {/* {fieldLike} */}
    </UnstyledButton>
  );
}
