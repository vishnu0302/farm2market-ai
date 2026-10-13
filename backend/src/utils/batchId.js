export function isValidBatchId(batchId) {
  const match = /^FM-(\d{4})(\d{2})(\d{2})-[A-F0-9]{6}$/.exec(batchId);
  if (!match) return false;

  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() === Number(month) - 1 &&
    date.getUTCDate() === Number(day);
}
