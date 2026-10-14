import { createContext, useCallback, useContext } from "react";
import type { ReactNode } from "react";
import {
  DEFAULT_CURRENCY_CODE,
  formatCurrency,
  type CurrencyCode,
  type FormatCurrencyOptions
} from "../domain/money";

/** The open game's currency. Components outside a provider (and older tests) get US dollars. */
const CurrencyContext = createContext<CurrencyCode>(DEFAULT_CURRENCY_CODE);

export function CurrencyProvider({
  currencyCode,
  children
}: {
  currencyCode: CurrencyCode;
  children: ReactNode;
}) {
  return <CurrencyContext.Provider value={currencyCode}>{children}</CurrencyContext.Provider>;
}

export function useCurrencyCode(): CurrencyCode {
  return useContext(CurrencyContext);
}

/** formatCurrency bound to the open game's currency and the user's locale. */
export function useFormatCurrency(): (cents: number, options?: FormatCurrencyOptions) => string {
  const currencyCode = useCurrencyCode();
  return useCallback(
    (cents: number, options?: FormatCurrencyOptions) => formatCurrency(cents, currencyCode, options),
    [currencyCode]
  );
}
