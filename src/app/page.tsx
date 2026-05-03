'use client';

import { useState, useEffect, useCallback } from 'react';
import Sidebar from '@/components/Sidebar';
import BottomNav from '@/components/BottomNav';
import Portfolio from '@/components/Portfolio';
import StockDetail from '@/components/StockDetail';
import SpendFlow, { type SpendMode } from '@/components/SpendFlow';
import Confirmation from '@/components/Confirmation';
import CardResult from '@/components/CardResult';
import CardDetail from '@/components/CardDetail';
import CardsList from '@/components/CardsList';
import NotesList from '@/components/NotesList';
import NoteDetail from '@/components/NoteDetail';
import Settings from '@/components/Settings';
import Spinner from '@/components/Spinner';
import { AuthGuard } from '@/components/auth/auth-guard';
import { usePlaidHoldings } from '@/lib/use-plaid-holdings';
import { useUserRegistration } from '@/lib/use-user-registration';
import AiBubble from '@/components/AiBubble';
import type { ActiveNote } from '@/components/AiBubble';
import { authFetch } from '@/lib/use-auth-fetch';
import type { Holding } from '@/lib/types';

export type Screen = 'portfolio' | 'stock-detail' | 'spend' | 'confirm' | 'card-result' | 'card-detail' | 'cards' | 'notes' | 'note-detail' | 'settings';

export interface PriceData {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  lastUpdated: string;
  source: 'live' | 'cached' | 'fallback' | 'chainlink';
  collar?: {
    floor: number;
    cap: number;
    volatility: number;
  };
}

export interface SpendResult {
  symbol: string;
  amount: number;
  shares: number;
  durationMonths: number;
  expiryDate: string;
  noteId: number;
  txId: string;
  // Virtual card fields (present when card is issued)
  card?: {
    pan: string;
    cvv: string;
    expMonth: string;
    expYear: string;
    lastFour: string;
    token: string;
  };
  // P2P fields (present when send flow is used)
  recipientName?: string; // Hedera account ID of recipient
  recipientAccountId?: string;
  // Collar price boundaries
  floor?: number;
  cap?: number;
  floorPct?: number;
  capPct?: number;
  // AI collar optimization details
  ai?: {
    confidence: number;
    riskLevel: string;
    reasoning: string;
    warnings: string[];
    oneLiner?: string;
  };
}

export default function Home() {
  const [screen, setScreen] = useState<Screen>('portfolio');
  const [prices, setPrices] = useState<Record<string, PriceData>>({});
  const [lastSpend, setLastSpend] = useState<SpendResult | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<number | null>(null);
  const [selectedHolding, setSelectedHolding] = useState<Holding | null>(null);
  const [spendMode, setSpendMode] = useState<SpendMode>('send');

  const {
    folioUser,
    needsPassphrase,
    needsRecovery,
    isNewUser,
    submitPassphrase,
    submitRecoveryPassphrase,
    registering,
    status: regStatus,
    error: regError,
  } = useUserRegistration();
  const { status: plaidStatus, holdings, openLink, isPlaidAvailable, isDemo } = usePlaidHoldings(folioUser?.hederaAccountId);
  const [passphraseInput, setPassphraseInput] = useState('');
  const [cryptoHoldings, setCryptoHoldings] = useState<Holding[]>([]);
  const [activeNotes, setActiveNotes] = useState<ActiveNote[]>([]);

  const navMap: Record<Screen, string> = {
    portfolio: 'portfolio',
    'stock-detail': 'portfolio',
    spend: spendMode === 'card' ? 'cards' : 'spend',
    confirm: 'spend',
    'card-result': 'cards',
    'card-detail': 'cards',
    cards: 'cards',
    notes: 'notes',
    'note-detail': 'notes',
    settings: 'settings',
  };

  const fetchNotes = useCallback(async () => {
    try {
      const res = await authFetch('/api/notes');
      const data = await res.json();
      const notes = (data.notes ?? [])
        .filter((n: ActiveNote) => n.status === 'active')
        .map((n: ActiveNote) => ({
          id: n.id, symbol: n.symbol, amount: n.amount, shares: n.shares,
          floor: n.floor, cap: n.cap, expiryDate: n.expiryDate, status: n.status,
        }));
      setActiveNotes(notes);
    } catch {
      setActiveNotes([]);
    }
  }, []);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  const fetchPrices = useCallback(async () => {
    try {
      // Build symbols list from holdings + active note collateral
      const symbols = holdings
        .filter((h) => h.shares > 0)
        .map((h) => h.symbol);
      const noteSymbols = activeNotes.map((n) => n.symbol);
      // Always include TSLA and AAPL for fallback display
      const allSymbols = [...new Set(['TSLA', 'AAPL', ...symbols, ...noteSymbols])];
      const query = allSymbols.length > 0 ? `?symbols=${allSymbols.join(',')}` : '';

      const res = await authFetch(`/api/price${query}`);
      const data = await res.json();
      setPrices(data);
    } catch {
      setPrices({
        TSLA: { symbol: 'TSLA', price: 225, change: 0, changePercent: 0, lastUpdated: '2025-01-01T00:00:00Z', source: 'fallback' },
        AAPL: { symbol: 'AAPL', price: 178.5, change: 0, changePercent: 0, lastUpdated: '2025-01-01T00:00:00Z', source: 'fallback' },
      });
    }
  }, [holdings, activeNotes]);

  useEffect(() => {
    fetchPrices();
    const interval = setInterval(fetchPrices, 30000);
    return () => clearInterval(interval);
  }, [fetchPrices]);

  const fetchCryptoBalances = useCallback(async () => {
    if (!folioUser?.hederaAccountId) return;
    try {
      const res = await authFetch(`/api/users/balances?accountId=${folioUser.hederaAccountId}`);
      if (res.ok) {
        const data = await res.json();
        setCryptoHoldings(data.holdings || []);
      }
    } catch { /* ignore */ }
  }, [folioUser]);

  // Fetch user's on-chain token balances (USDC, stocks, etc.)
  // On first load after registration, retry with backoff to handle sync delay
  useEffect(() => {
    if (!folioUser?.hederaAccountId) return;
    let cancelled = false;

    async function initialFetch() {
      for (let attempt = 0; attempt <= 3; attempt++) {
        if (cancelled) return;
        await fetchCryptoBalances();
        // If we got holdings or exhausted retries, stop
        if (attempt === 3) break;
        // Wait before retrying (gives mirror node time to sync)
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      }
    }

    initialFetch();
    const interval = setInterval(fetchCryptoBalances, 15000);
    return () => { cancelled = true; clearInterval(interval); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folioUser?.hederaAccountId]);

  const handleViewHolding = (holding: Holding) => {
    setSelectedHolding(holding);
    setScreen('stock-detail');
  };

  const handleSpendFromHolding = (holding: Holding, mode: SpendMode = 'send') => {
    setSelectedHolding(holding);
    setSpendMode(mode);
    setScreen('spend');
  };

  const handleSpendComplete = (result: SpendResult) => {
    setLastSpend(result);
    setScreen(result.card ? 'card-result' : 'confirm');
    fetchNotes();
    fetchCryptoBalances();
  };

  const handleViewNote = (noteId: number) => {
    setSelectedNoteId(noteId);
    setScreen('note-detail');
  };

  // Loading gate — block UI while registration is in flight
  // This prevents navigating to spend before folioUser is populated
  if (registering) {
    return (
      <AuthGuard>
        <div className="min-h-screen flex items-center justify-center main-gradient px-6">
          <div className="w-full max-w-[380px]">
            <div className="card p-8 text-center space-y-4">
              <div className="w-16 h-16 mx-auto rounded-full flex items-center justify-center"
                style={{ background: 'var(--accent-muted)' }}>
                <Spinner size={28} />
              </div>
              <div className="text-[18px] font-bold" style={{ color: 'var(--text-primary)' }}>
                {regStatus === 'generating-key' ? 'Generating wallet key...'
                  : regStatus === 'creating-account' ? 'Creating Hedera account...'
                  : regStatus === 'signing-association' ? 'Signing token associations...'
                  : regStatus === 'completing' ? 'Completing setup...'
                  : regStatus === 'encrypting-key' ? 'Encrypting & backing up key...'
                  : regStatus === 'recovering-key' ? 'Decrypting wallet...'
                  : 'Setting up...'}
              </div>
              <div className="text-[13px]" style={{ color: 'var(--text-tertiary)' }}>
                This only takes a few seconds
              </div>
            </div>
          </div>
        </div>
      </AuthGuard>
    );
  }

  // Passphrase prompt for new users or key recovery
  if (needsPassphrase || needsRecovery) {
    return (
      <AuthGuard>
        <div className="min-h-screen flex items-center justify-center main-gradient px-6">
          <div className="w-full max-w-[380px] space-y-6">
            <div className="card p-8 space-y-6">
              <div className="text-center">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center"
                  style={{ background: 'var(--accent-muted)' }}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                </div>
                <div className="text-[20px] font-bold" style={{ color: 'var(--text-primary)' }}>
                  {isNewUser ? 'Create Passphrase' : 'Enter Passphrase'}
                </div>
                <div className="text-[13px] mt-2 leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
                  {isNewUser
                    ? 'This passphrase encrypts your wallet key. You\'ll need it to log in on a new device.'
                    : 'Enter the passphrase you created during registration to unlock your wallet.'}
                </div>
              </div>

              <input
                type="password"
                value={passphraseInput}
                onChange={(e) => setPassphraseInput(e.target.value)}
                placeholder={isNewUser ? 'Choose a passphrase (6+ characters)' : 'Enter your passphrase'}
                className="w-full px-4 py-3.5 rounded-xl text-[15px] bg-transparent"
                style={{ border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-primary)' }}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && passphraseInput.length >= 6) {
                    if (needsRecovery) submitRecoveryPassphrase(passphraseInput);
                    else submitPassphrase(passphraseInput);
                    setPassphraseInput('');
                  }
                }}
              />

              {regError && (
                <div className="text-[13px] text-center" style={{ color: 'var(--negative)' }}>
                  {regError}
                </div>
              )}

              <button
                onClick={() => {
                  if (needsRecovery) submitRecoveryPassphrase(passphraseInput);
                  else submitPassphrase(passphraseInput);
                  setPassphraseInput('');
                }}
                disabled={passphraseInput.length < 6 || registering}
                className="btn-primary w-full py-4 text-[15px]"
              >
                {registering
                  ? (regStatus === 'generating-key' ? 'Generating key...'
                    : regStatus === 'creating-account' ? 'Creating account...'
                    : regStatus === 'signing-association' ? 'Signing...'
                    : regStatus === 'encrypting-key' ? 'Encrypting...'
                    : regStatus === 'recovering-key' ? 'Decrypting...'
                    : 'Setting up...')
                  : (isNewUser ? 'Create Wallet' : 'Unlock Wallet')}
              </button>

              {isNewUser && (
                <div className="text-[11px] text-center leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
                  Your private key is encrypted with this passphrase and backed up securely. The server never sees your key.
                </div>
              )}
            </div>
          </div>
        </div>
      </AuthGuard>
    );
  }

  return (
    <AuthGuard>
    <div className="flex min-h-screen">
      <Sidebar activeTab={navMap[screen]} onNavigate={(s) => {
        if (s === 'spend') setSpendMode('send');
        setScreen(s as Screen);
      }} />

      <main className="flex-1 flex justify-center pb-20 md:pb-0 main-gradient">
        <div className="w-full max-w-[420px] md:max-w-[640px] px-6 py-10">
          {screen === 'portfolio' && (
            <Portfolio
              holdings={holdings}
              cryptoHoldings={cryptoHoldings}
              prices={prices}
              plaidStatus={plaidStatus}
              isPlaidAvailable={isPlaidAvailable}
              isDemo={isDemo}
              activeNotes={activeNotes}
              onConnectBrokerage={openLink}
              onSpendFromHolding={handleViewHolding}
              onSpend={() => {
                const first = holdings.find((h) => h.shares > 0);
                if (first) handleSpendFromHolding(first, 'send');
                else { setSpendMode('send'); setScreen('spend'); }
              }}
              onViewNotes={() => setScreen('notes')}
              onViewCards={() => setScreen('cards')}
              onSettleNote={fetchNotes}
            />
          )}
          {screen === 'stock-detail' && selectedHolding && (
            <StockDetail
              holding={selectedHolding}
              price={prices[selectedHolding.symbol]}
              totalPortfolioValue={
                holdings.reduce((sum, h) => sum + h.shares * (prices[h.symbol]?.price ?? 0), 0)
                + cryptoHoldings.reduce((sum, h) => sum + (h.symbol === 'USDC' ? h.shares : 0), 0)
              }
              onBack={() => setScreen('portfolio')}
              onSpend={() => handleSpendFromHolding(selectedHolding)}
            />
          )}
          {screen === 'spend' && (
            <SpendFlow
              mode={spendMode}
              selectedHolding={selectedHolding || holdings.find((h) => h.shares > 0) || holdings[0]}
              holdings={holdings}
              prices={prices}
              currentUserAccountId={folioUser?.hederaAccountId}
              activeNotes={activeNotes}
              onBack={() => spendMode === 'card' ? setScreen('cards') : setScreen('portfolio')}
              onComplete={handleSpendComplete}
            />
          )}
          {screen === 'confirm' && lastSpend && (
            <Confirmation
              result={lastSpend}
              onViewDetails={() => {
                setSelectedNoteId(lastSpend.noteId);
                setScreen('note-detail');
              }}
              onDone={() => setScreen('portfolio')}
            />
          )}
          {screen === 'card-result' && lastSpend && (
            <CardResult
              result={lastSpend}
              onViewCardDetail={() => {
                setSelectedNoteId(lastSpend.noteId);
                setScreen('card-detail');
              }}
              onDone={() => setScreen('portfolio')}
            />
          )}
          {screen === 'card-detail' && selectedNoteId !== null && (
            <CardDetail
              noteId={selectedNoteId}
              onBack={() => setScreen('cards')}
            />
          )}
          {screen === 'cards' && (
            <CardsList
              onGetCard={() => {
                const first = holdings.find((h) => h.shares > 0);
                if (first) handleSpendFromHolding(first, 'card');
                else { setSpendMode('card'); setScreen('spend'); }
              }}
              onSelectCard={(noteId) => {
                setSelectedNoteId(noteId);
                setScreen('card-detail');
              }}
            />
          )}
          {screen === 'notes' && (
            <NotesList onSelectNote={handleViewNote} />
          )}
          {screen === 'note-detail' && selectedNoteId !== null && (
            <NoteDetail noteId={selectedNoteId} onBack={() => setScreen('notes')} />
          )}
          {screen === 'settings' && (
            <Settings
              plaidStatus={plaidStatus}
              isPlaidAvailable={isPlaidAvailable}
              isDemo={isDemo}
              onConnectBrokerage={openLink}
            />
          )}
        </div>
      </main>

      <AiBubble activeNotes={activeNotes} prices={prices} onRepaySuccess={fetchNotes} />
      <BottomNav activeTab={navMap[screen]} onNavigate={(s) => {
        if (s === 'spend') setSpendMode('send');
        setScreen(s as Screen);
      }} />
    </div>
    </AuthGuard>
  );
}
