// 1以上の整数のみを受け付け、その他はnullを返す
export const parsePositiveInt = (value: unknown): number | null => {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
};

