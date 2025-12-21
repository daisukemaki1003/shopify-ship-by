import {useEffect} from "react";
import {useAppBridge} from "@shopify/app-bridge-react";

type SuccessToastProps = {
  message?: string | null;
  duration?: number;
  nonce?: string | number;
};

export function SuccessToast({message, duration = 5000, nonce}: SuccessToastProps) {
  const shopify = useAppBridge();

  useEffect(() => {
    const text = message?.trim();
    if (!text) return;
    shopify.toast.show(text, {duration});
  }, [duration, message, nonce, shopify]);

  return null;
}
