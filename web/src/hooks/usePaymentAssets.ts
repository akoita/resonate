"use client";

import { useEffect, useState } from "react";
import {
  getFundingOptions,
  getPaymentAssets,
  getPaymentQuote,
  type FundingOption,
  type PaymentAsset,
  type PaymentAssetQuote,
  type PaymentSurface,
} from "../lib/payments";

type PaymentAssetsState = {
  assets: PaymentAsset[];
  defaultAsset: string | null;
  source: string | null;
  loading: boolean;
  error: Error | null;
};

export function usePaymentAssets(chainId?: number) {
  const [state, setState] = useState<PaymentAssetsState>({
    assets: [],
    defaultAsset: null,
    source: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    getPaymentAssets(chainId)
      .then((res) => {
        if (cancelled) return;
        setState({
          assets: res.assets,
          defaultAsset: res.defaultAsset,
          source: res.source,
          loading: false,
          error: null,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          assets: [],
          defaultAsset: null,
          source: null,
          loading: false,
          error: err instanceof Error ? err : new Error(String(err)),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [chainId]);

  return state;
}

type FundingOptionsState = {
  options: FundingOption[];
  loading: boolean;
  error: Error | null;
};

export function useFundingOptions(input: {
  chainId?: number;
  wallet?: string | null;
  assetId?: string;
  surface?: PaymentSurface;
}) {
  const [state, setState] = useState<FundingOptionsState>({
    options: [],
    loading: true,
    error: null,
  });
  const wallet = input.wallet ?? null;

  useEffect(() => {
    let cancelled = false;
    getFundingOptions({
      chainId: input.chainId,
      wallet,
      assetId: input.assetId,
      surface: input.surface,
    })
      .then((res) => {
        if (cancelled) return;
        setState({ options: res.options, loading: false, error: null });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          options: [],
          loading: false,
          error: err instanceof Error ? err : new Error(String(err)),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [input.chainId, wallet, input.assetId, input.surface]);

  return state;
}

type PaymentQuoteState = {
  quotes: PaymentAssetQuote[];
  defaultAsset: string | null;
  amountUsd: string | null;
  requestKey: string | null;
  loading: boolean;
  error: Error | null;
};

export function usePaymentQuote(input: {
  amountUsd?: string | number | null;
  chainId?: number;
  assetId?: string;
  surface?: PaymentSurface;
}) {
  const skipQuote = input.amountUsd === undefined || input.amountUsd === null || input.amountUsd === "";
  const quoteKey = skipQuote
    ? null
    : `${input.amountUsd}|${input.chainId ?? ""}|${input.assetId ?? ""}|${input.surface ?? ""}`;
  const [state, setState] = useState<PaymentQuoteState>({
    quotes: [],
    defaultAsset: null,
    amountUsd: null,
    requestKey: null,
    loading: false,
    error: null,
  });

  useEffect(() => {
    if (skipQuote) {
      return;
    }

    let cancelled = false;
    const amountUsd = input.amountUsd as string | number;
    getPaymentQuote({
      amountUsd,
      chainId: input.chainId,
      assetId: input.assetId,
      surface: input.surface,
    })
      .then((res) => {
        if (cancelled) return;
        setState({
          quotes: res.quotes,
          defaultAsset: res.defaultAsset,
          amountUsd: res.amountUsd,
          requestKey: quoteKey,
          loading: false,
          error: null,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          quotes: [],
          defaultAsset: null,
          amountUsd: null,
          requestKey: quoteKey,
          loading: false,
          error: err instanceof Error ? err : new Error(String(err)),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [skipQuote, quoteKey, input.amountUsd, input.chainId, input.assetId, input.surface]);

  return skipQuote
    ? {
        quotes: [],
        defaultAsset: null,
        amountUsd: null,
        requestKey: null,
        loading: false,
        error: null,
      }
    : {
        ...state,
        loading: state.requestKey !== quoteKey,
      };
}
