'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { useDynamicContext } from '@dynamic-labs/sdk-react-core';
import { ConnectButton } from './connect-button';
import FolioLogo from '../FolioLogo';

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const { user } = useDynamicContext();

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return <>{children}</>;

  const isAuthenticated = user !== undefined && user !== null;

  if (!isAuthenticated) {
    return (
      <div className="landing-shell min-h-screen relative overflow-hidden">
        <div className="landing-blob landing-blob-a" aria-hidden />
        <div className="landing-blob landing-blob-b" aria-hidden />
        <div className="landing-blob landing-blob-c" aria-hidden />

        <div className="relative z-10 min-h-screen flex flex-col">
          {/* Navbar — logo left, CTA login top-right */}
          <header className="flex items-center justify-between px-5 md:px-10 py-4 md:py-5 sticky top-0 z-20 landing-nav">
            <div className="flex items-center gap-2.5">
              <FolioLogo size={32} />
              <span className="text-[16px] font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
                Folio
              </span>
            </div>
            <nav className="hidden md:flex items-center gap-8 text-[13px] font-medium" style={{ color: 'var(--text-secondary)' }}>
              <a href="#how" className="hover:opacity-80 transition-opacity">How it works</a>
              <a href="#features" className="hover:opacity-80 transition-opacity">Features</a>
              <a href="#gasless" className="hover:opacity-80 transition-opacity">Gasless</a>
            </nav>
            <div className="flex items-center gap-3">
              <span className="hidden sm:inline landing-glass-chip text-[11px] font-medium px-3 py-1.5">
                0% · keep your shares
              </span>
              <ConnectButton />
            </div>
          </header>

          {/* Hero */}
          <section className="flex flex-col lg:flex-row items-center justify-between gap-12 lg:gap-16 px-5 md:px-10 pt-8 md:pt-14 pb-16 max-w-6xl mx-auto w-full">
            <div className="max-w-xl text-center lg:text-left space-y-6 flex-1">
              <div
                className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider px-3 py-1.5 rounded-full landing-glass-chip"
                style={{ color: 'var(--accent)' }}
              >
                Portfolio-backed credit
              </div>
              <h1
                className="text-[34px] sm:text-[42px] md:text-[48px] font-bold tracking-tight leading-[1.08]"
                style={{ color: 'var(--text-primary)' }}
              >
                Spend against your stocks.{' '}
                <span style={{ color: 'var(--accent)' }}>Without selling a single share.</span>
              </h1>
              <p className="text-[15px] md:text-[17px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                Folio gives you a 0% credit line backed by your equity. Lock tokens as collateral,
                send payments in USDC, repay anytime. Fees on Hedera are covered for you —{' '}
                <strong style={{ color: 'var(--text-primary)' }}>gasless for users</strong>.
              </p>
              <div className="flex flex-col sm:flex-row items-center gap-3 justify-center lg:justify-start">
                <ConnectButton />
                <a
                  href="#how"
                  className="text-[14px] font-semibold px-5 py-3 rounded-xl"
                  style={{ color: 'var(--text-secondary)', background: 'var(--bg-elevated)' }}
                >
                  See how it works
                </a>
              </div>
              <div className="flex flex-wrap gap-4 justify-center lg:justify-start pt-2 text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
                <span>✓ Email login</span>
                <span>✓ Gasless txs</span>
                <span>✓ 0% interest</span>
                <span>✓ Hedera mainnet-ready</span>
              </div>
            </div>

            {/* Product visual */}
            <div className="flex-1 flex justify-center lg:justify-end w-full max-w-md">
              <div className="landing-glass p-3 md:p-4 relative">
                <div
                  className="absolute -inset-4 rounded-[32px] opacity-40 blur-2xl pointer-events-none"
                  style={{ background: 'radial-gradient(circle, rgba(16,185,129,0.35), transparent 70%)' }}
                />
                <Image
                  src="/images/landing-hero.jpg"
                  alt="Folio app — portfolio and available to spend"
                  width={360}
                  height={640}
                  className="relative rounded-2xl w-full h-auto object-cover shadow-2xl"
                  priority
                />
              </div>
            </div>
          </section>

          {/* How it works */}
          <section id="how" className="px-5 md:px-10 py-16 max-w-6xl mx-auto w-full">
            <div className="text-center mb-10">
              <div className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--accent)' }}>
                How it works
              </div>
              <h2 className="text-[28px] font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
                Three steps to liquidity
              </h2>
            </div>
            <div className="grid md:grid-cols-3 gap-5">
              {[
                {
                  step: '01',
                  title: 'Fund your wallet',
                  body: 'Sign in with email. Deposit USDC or buy equity tokens. No seed phrases, no MetaMask required.',
                },
                {
                  step: '02',
                  title: 'Lock & spend',
                  body: 'Pick a stock position, choose an amount, and send USDC or apply for a card. Shares stay yours — only temporarily locked.',
                },
                {
                  step: '03',
                  title: 'Repay anytime',
                  body: 'Pay back the advance at 0% interest to unlock collateral. Or let the collar settle at expiry.',
                },
              ].map((c) => (
                <div key={c.step} className="landing-glass p-6 space-y-3">
                  <div className="text-[12px] font-bold" style={{ color: 'var(--accent)' }}>
                    {c.step}
                  </div>
                  <div className="text-[17px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {c.title}
                  </div>
                  <p className="text-[13px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                    {c.body}
                  </p>
                </div>
              ))}
            </div>
          </section>

          {/* Features */}
          <section id="features" className="px-5 md:px-10 py-16 max-w-6xl mx-auto w-full">
            <div className="text-center mb-10">
              <div className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--accent)' }}>
                Product
              </div>
              <h2 className="text-[28px] font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
                Built like a neobank, settled on Hedera
              </h2>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { t: '0% credit line', d: 'Advances against equity with zero interest.' },
                { t: 'Trade equities', d: 'Buy and sell stock tokens with live market prices.' },
                { t: 'Send payments', d: 'P2P USDC to other Folio users in seconds.' },
                { t: 'Card applications', d: 'Apply when ready — issuer review before card issue.' },
              ].map((f) => (
                <div key={f.t} className="card p-5 space-y-2">
                  <div className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {f.t}
                  </div>
                  <p className="text-[13px] leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
                    {f.d}
                  </p>
                </div>
              ))}
            </div>
          </section>

          {/* Gasless */}
          <section id="gasless" className="px-5 md:px-10 py-16 max-w-6xl mx-auto w-full">
            <div className="landing-glass p-8 md:p-10 flex flex-col md:flex-row gap-8 items-center">
              <div className="flex-1 space-y-3 text-center md:text-left">
                <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--accent)' }}>
                  Gasless by design
                </div>
                <h2 className="text-[24px] md:text-[28px] font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
                  You sign. We pay network fees.
                </h2>
                <p className="text-[14px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                  On Hedera, Folio sets the operator as the fee payer for token associations, collateral
                  locks, allowances, and repayments. You authorize with your key — you don&apos;t need
                  to hold HBAR for everyday spend flows.
                </p>
              </div>
              <div className="flex flex-col gap-3 w-full md:w-auto min-w-[220px]">
                {[
                  'No HBAR for spend txs',
                  'Operator-sponsored fees',
                  'Sign-only UX',
                ].map((x) => (
                  <div
                    key={x}
                    className="flex items-center gap-3 px-4 py-3 rounded-xl text-[13px] font-medium"
                    style={{ background: 'rgba(16,185,129,0.1)', color: 'var(--accent)' }}
                  >
                    <span>✓</span> {x}
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Bottom CTA */}
          <section className="px-5 md:px-10 py-16 max-w-3xl mx-auto w-full text-center space-y-6">
            <h2 className="text-[28px] font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
              Ready when you are
            </h2>
            <p className="text-[15px]" style={{ color: 'var(--text-secondary)' }}>
              Create your wallet with email OTP and open a 0% line against your portfolio.
            </p>
            <div className="flex justify-center">
              <ConnectButton />
            </div>
          </section>

          <footer className="px-6 py-8 text-center text-[11px] border-t" style={{ color: 'var(--text-tertiary)', borderColor: 'var(--border)' }}>
            Folio · Equity-backed credit · Gasless Hedera settlement · Not financial advice
          </footer>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
