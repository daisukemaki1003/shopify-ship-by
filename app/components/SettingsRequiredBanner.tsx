import {Banner, BlockStack, Button, Text} from "@shopify/polaris";

type SettingsRequiredBannerProps = {
  message?: string;
  actionLabel?: string;
  actionUrl?: string;
};

export function SettingsRequiredBanner({
  message = "全体設定が未完了のため操作できません。",
  actionLabel = "全体設定へ",
  actionUrl = "/app/settings",
}: SettingsRequiredBannerProps) {
  return (
    <Banner tone="critical">
      <BlockStack gap="200">
        <Text as="p">{message}</Text>
        <div>
          <Button url={actionUrl}>{actionLabel}</Button>
        </div>
      </BlockStack>
    </Banner>
  );
}
