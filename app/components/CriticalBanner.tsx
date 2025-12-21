import {Banner} from "@shopify/polaris";

type CriticalBannerProps = {
  message?: string | null;
};

export function CriticalBanner({message}: CriticalBannerProps) {
  if (!message) return null;

  return (
    <Banner tone="critical">
      <p>{message}</p>
    </Banner>
  );
}
