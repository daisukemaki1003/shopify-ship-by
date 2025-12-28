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
  const borderStyle = checked ? "solid" : "dotted";
  const borderColor = checked ? "#000" : "var(--p-color-border-secondary)";
  const background = checked ? "#000" : "var(--p-color-bg-surface)";
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
        border: `1px ${borderStyle} ${borderColor}`,
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
      ) : null}
    </span>
  );
}
