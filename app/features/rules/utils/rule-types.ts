// 出荷ルールで共有するシンプルな型定義
export type ProductRule = {
  id: string | null;
  productIds: string[];
  days: number;
};

// 商品の最小限サマリー
export type ProductSummary = {
  id: string;
  title: string;
  imageUrl: string | null;
};

// 商品情報を含んだルール
export type ProductRuleWithProducts = ProductRule & {products: ProductSummary[]};

