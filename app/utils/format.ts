export const formatDateTime = (value: Date | null): string | null => {
  if (!value) return null;
  const pad = (n: number) => n.toString().padStart(2, "0");
  const year = value.getFullYear();
  const month = pad(value.getMonth() + 1);
  const day = pad(value.getDate());
  const hour = pad(value.getHours());
  const minute = pad(value.getMinutes());
  return `${year}-${month}-${day} ${hour}:${minute}`;
};
