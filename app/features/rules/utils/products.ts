import type {ProductSummary} from "./rule-types";

type MediaImage = {
  url?: unknown;
  src?: unknown;
  originalSrc?: unknown;
  transformedSrc?: unknown;
};

type MediaPreview = {
  image?: MediaImage | null;
};

type FeaturedMedia = {
  preview?: MediaPreview | null;
  preview_image?: MediaImage | null;
  thumbnail?: MediaImage | null;
};

type ImageNode = MediaImage;

type ImageEdge = {
  node?: ImageNode | null;
};

type Images =
  | ImageNode[]
  | {
      nodes?: ImageNode[] | null;
      edges?: ImageEdge[] | null;
    };

type ProductSelection = {
  id?: unknown;
  admin_graphql_api_id?: unknown;
  title?: unknown;
  featuredMedia?: FeaturedMedia | null;
  featured_media?: FeaturedMedia | null;
  featuredImage?: ImageNode | null;
  featured_image?: ImageNode | null;
  image?: ImageNode | null;
  images?: Images | null;
  media?: Array<{preview?: MediaPreview | null}> | null;
  variants?: {edges?: Array<{node?: {image?: MediaImage | null} | null}> | null} | null;
};

// 商品情報が欠けている場合のデフォルト値
export const FALLBACK_PRODUCT_TITLE = "商品";

// 商品情報が取得できない場合に使うダミー商品
export const toFallbackProduct = (id: string): ProductSummary => ({
  id,
  title: FALLBACK_PRODUCT_TITLE,
  imageUrl: null,
});

// 商品ピッカーのレスポンスから最初に見つかった画像URLを取り出す
export const pickFirstImageUrl = (item: ProductSelection | null | undefined): string | null => {
  const imagesValue = item?.images ?? null;
  const imageArray = Array.isArray(imagesValue) ? imagesValue : null;
  const imageNodes = !Array.isArray(imagesValue) ? imagesValue?.nodes ?? null : null;
  const imageEdges = !Array.isArray(imagesValue) ? imagesValue?.edges ?? null : null;
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
    imageArray?.[0]?.url,
    imageArray?.[0]?.src,
    imageArray?.[0]?.originalSrc,
    imageArray?.[0]?.transformedSrc,
    imageNodes?.[0]?.url,
    imageNodes?.[0]?.src,
    imageNodes?.[0]?.originalSrc,
    imageNodes?.[0]?.transformedSrc,
    imageEdges?.[0]?.node?.url,
    imageEdges?.[0]?.node?.src,
    imageEdges?.[0]?.node?.originalSrc,
    imageEdges?.[0]?.node?.transformedSrc,
    item?.variants?.edges?.[0]?.node?.image?.url,
    item?.variants?.edges?.[0]?.node?.image?.src,
    item?.variants?.edges?.[0]?.node?.image?.originalSrc,
    item?.variants?.edges?.[0]?.node?.image?.transformedSrc,
  ];

  const found = candidates.find((candidate) => Boolean(candidate));
  return found ? String(found) : null;
};

// 商品ピッカーから受け取ったアイテムをアプリ内のサマリー形式に変換
export const selectionToProductSummary = (item: unknown): ProductSummary | null => {
  if (!item) return null;

  const value = item as ProductSelection;
  const id = value.id ?? value.admin_graphql_api_id;
  if (!id) return null;
  // バリエーションは選択対象外
  const idStr = String(id);
  if (idStr.includes("ProductVariant")) return null;

  const title = value.title ?? FALLBACK_PRODUCT_TITLE;
  const imageCandidate = pickFirstImageUrl(value);

  return {
    id: String(id),
    title: String(title),
    imageUrl: imageCandidate ? String(imageCandidate) : null,
  };
};
