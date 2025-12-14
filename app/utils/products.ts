import type {ProductSummary} from "./rule-types";

// 商品情報が欠けている場合のデフォルト値
export const FALLBACK_PRODUCT_TITLE = "商品";

// 商品情報が取得できない場合に使うダミー商品
export const toFallbackProduct = (id: string): ProductSummary => ({
  id,
  title: FALLBACK_PRODUCT_TITLE,
  imageUrl: null,
});

// 商品ピッカーのレスポンスから最初に見つかった画像URLを取り出す
export const pickFirstImageUrl = (item: any): string | null => {
  const candidates = [
    item?.featuredMedia?.preview?.image?.url,
    item?.featuredMedia?.preview?.image?.src,
    item?.featuredMedia?.preview?.image?.originalSrc,
    item?.featuredMedia?.preview_image?.url,
    item?.featuredMedia?.preview_image?.src,
    item?.featuredMedia?.preview_image?.originalSrc,
    item?.featuredMedia?.preview_image?.transformedSrc,
    item?.featured_media?.preview_image?.transformedSrc,
    item?.featuredMedia?.thumbnail?.url,
    item?.featuredMedia?.thumbnail?.src,
    item?.featuredMedia?.thumbnail?.transformedSrc,
    item?.media?.[0]?.preview?.image?.url,
    item?.media?.[0]?.preview?.image?.src,
    item?.media?.[0]?.preview?.image?.originalSrc,
    item?.media?.[0]?.preview?.image?.transformedSrc,
    item?.featuredImage?.url,
    item?.featuredImage?.src,
    item?.featuredImage?.originalSrc,
    item?.featuredImage?.transformedSrc,
    item?.featured_image?.url,
    item?.featured_image?.src,
    item?.featured_image?.originalSrc,
    item?.featured_image?.transformedSrc,
    item?.image?.url,
    item?.image?.src,
    item?.image?.originalSrc,
    item?.image?.transformedSrc,
    item?.images?.[0]?.url,
    item?.images?.[0]?.src,
    item?.images?.[0]?.originalSrc,
    item?.images?.[0]?.transformedSrc,
    item?.images?.nodes?.[0]?.url,
    item?.images?.nodes?.[0]?.src,
    item?.images?.nodes?.[0]?.originalSrc,
    item?.images?.nodes?.[0]?.transformedSrc,
    item?.images?.edges?.[0]?.node?.url,
    item?.images?.edges?.[0]?.node?.src,
    item?.images?.edges?.[0]?.node?.originalSrc,
    item?.images?.edges?.[0]?.node?.transformedSrc,
    item?.variants?.edges?.[0]?.node?.image?.url,
    item?.variants?.edges?.[0]?.node?.image?.src,
    item?.variants?.edges?.[0]?.node?.image?.originalSrc,
    item?.variants?.edges?.[0]?.node?.image?.transformedSrc,
  ];

  const found = candidates.find((candidate) => Boolean(candidate));
  return found ? String(found) : null;
};

// 商品ピッカーから受け取ったアイテムをアプリ内のサマリー形式に変換
export const selectionToProductSummary = (item: any): ProductSummary | null => {
  if (!item) return null;

  const id = item.id ?? item.admin_graphql_api_id;
  if (!id) return null;
  // バリエーションは選択対象外
  const idStr = String(id);
  if (idStr.includes("ProductVariant")) return null;

  const title = item.title ?? FALLBACK_PRODUCT_TITLE;
  const imageCandidate = pickFirstImageUrl(item);

  return {
    id: String(id),
    title: String(title),
    imageUrl: imageCandidate ? String(imageCandidate) : null,
  };
};

