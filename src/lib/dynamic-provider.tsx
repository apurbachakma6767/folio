'use client';

import { DynamicContextProvider } from '@dynamic-labs/sdk-react-core';
import { SdkViewSectionType, SdkViewType } from '@dynamic-labs/sdk-api';
import { EthereumWalletConnectors } from '@dynamic-labs/ethereum';

const cssOverrides = `
  .dynamic-shadow-dom {
    --dynamic-font-family-primary: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    --dynamic-base-1: #141415;
    --dynamic-base-2: #1C1C1E;
    --dynamic-base-3: #0A0A0B;
    --dynamic-base-4: #1C1C1E;
    --dynamic-base-5: #1C1C1E;
    --dynamic-text-primary: #F5F5F7;
    --dynamic-text-secondary: #A1A1AA;
    --dynamic-text-tertiary: #71717A;
    --dynamic-brand-primary-color: #10B981;
    --dynamic-brand-hover-color: #059669;
    --dynamic-brand-secondary-color: rgba(16, 185, 129, 0.12);
    --dynamic-connection-green: #10B981;
    --dynamic-border-radius: 12px;
    --dynamic-hover: rgba(255, 255, 255, 0.04);
    --dynamic-modal-border: 1px solid rgba(255, 255, 255, 0.06);
    --dynamic-modal-width: 24rem;
    --dynamic-modal-padding: 1.5rem;
    --dynamic-overlay: rgba(0, 0, 0, 0.6);
    --dynamic-shadow-down-1: 0 4px 12px rgba(0, 0, 0, 0.5);
    --dynamic-shadow-down-2: 0 4px 12px rgba(0, 0, 0, 0.5);
    --dynamic-shadow-down-3: 0 8px 24px rgba(0, 0, 0, 0.6);
    --dynamic-footer-background-color: #141415;
    --dynamic-footer-text-color: #A1A1AA;
    --dynamic-footer-border: 1px solid rgba(255, 255, 255, 0.06);
    --dynamic-connect-button-background: #10B981;
    --dynamic-connect-button-color: #000;
    --dynamic-connect-button-border: none;
    --dynamic-connect-button-shadow: none;
    --dynamic-connect-button-background-hover: #059669;
    --dynamic-connect-button-color-hover: #000;
    --dynamic-connect-button-border-hover: none;
    --dynamic-connect-button-shadow-hover: 0 4px 16px rgba(16, 185, 129, 0.35);
    --dynamic-search-bar-background: #1C1C1E;
    --dynamic-search-bar-background-hover: #1C1C1E;
    --dynamic-search-bar-background-focus: #1C1C1E;
    --dynamic-search-bar-border: 1px solid rgba(255, 255, 255, 0.06);
    --dynamic-search-bar-border-hover: 1px solid rgba(255, 255, 255, 0.1);
    --dynamic-search-bar-border-focus: 1px solid #10B981;
    --dynamic-text-link: #10B981;
    --dynamic-error-1: #EF4444;
    --dynamic-error-2: rgba(239, 68, 68, 0.1);
    --dynamic-badge-background: #1C1C1E;
    --dynamic-badge-color: #F5F5F7;
    --dynamic-badge-dot-background: #10B981;
  }

  .dynamic-shadow-dom .modal-header__title {
    font-weight: 600;
  }
`;

export function DynamicProvider({ children }: { children: React.ReactNode }) {
  return (
    <DynamicContextProvider
      theme="dark"
      settings={{
        environmentId: process.env.NEXT_PUBLIC_DYNAMIC_ENV_ID ?? 'placeholder',
        walletConnectors: [EthereumWalletConnectors],
        appName: 'Folio',
        appLogoUrl: '/logo.svg',
        overrides: {
          views: [
            {
              type: SdkViewType.Login,
              sections: [
                {
                  type: SdkViewSectionType.Email,
                },
              ],
            },
          ],
        },
        cssOverrides,
      }}
    >
      {children}
    </DynamicContextProvider>
  );
}
