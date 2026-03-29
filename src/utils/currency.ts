import { CURRENCIES, CurrencyInfo } from "@/types";

export function getCurrencySymbol(code: string): string {
  const c = CURRENCIES.find((c) => c.code === code);
  return c ? c.symbol : code;
}

export function formatAmount(amount: number, currencyCode: string): string {
  const symbol = getCurrencySymbol(currencyCode);
  const abs = Math.abs(amount);
  return `${symbol}${abs.toFixed(2)}`;
}

export function getCurrencyByCode(code: string): CurrencyInfo | undefined {
  return CURRENCIES.find((c) => c.code === code);
}
