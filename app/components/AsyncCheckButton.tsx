import { Icon, Spinner } from "@shopify/polaris";
import { CheckIcon } from "@shopify/polaris-icons";

const DEFAULT_SIZE = 20;

type AsyncCheckButtonProps = {
  label: string;
  checked: boolean;
  loading?: boolean;
  size?: number;
};

export function AsyncCheckButton({
  label,
  checked,
  loading = false,
  size = DEFAULT_SIZE,
}: AsyncCheckButtonProps) {
  const ariaLabel = loading
    ? `${label} を確認中`
    : checked
      ? `${label} は完了`
      : `${label} は未完了`;
  const border = checked ? "1px solid #000" : "1px solid transparent";
  const background = checked ? "#000" : "var(--p-color-bg-surface)";
  const ringColor = "var(--p-color-text)";
  const iconColor = checked ? "#fff" : "inherit";

  return (
    <span
      role="img"
      aria-label={ariaLabel}
      aria-busy={loading || undefined}
      style={{
        width: size,
        height: size,
        borderRadius: "999px",
        border,
        background,
        padding: 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {loading ? (
        <Spinner size="small" accessibilityLabel="読み込み中" />
      ) : checked ? (
        <span style={{ color: iconColor }}>
          <Icon source={CheckIcon} tone="inherit" />
        </span>
      ) : (
        <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
          <circle
            cx="10"
            cy="10"
            r="8"
            fill="none"
            stroke={ringColor}
            strokeWidth="2"
            strokeDasharray="3 4"
            strokeLinecap="round"
          />
        </svg>
      )}
    </span>
  );
}
