import {useEffect, useRef} from "react";
import {useAppBridge} from "@shopify/app-bridge-react";

type SuccessToastProps = {
  message?: string | null;
  duration?: number;
};

export function SuccessToast({message, duration = 5000}: SuccessToastProps) {
  const shopify = useAppBridge();
  const lastMessageRef = useRef<string | null>(null);

  useEffect(() => {
    const text = message?.trim();
    if (!text) return;
    if (lastMessageRef.current === text) return;
    lastMessageRef.current = text;
    shopify.toast.show(text, {duration});
  }, [duration, message, shopify]);

  return null;
}
