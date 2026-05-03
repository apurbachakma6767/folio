import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, unauthorized } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth.authenticated) {
    return unauthorized(auth.error);
  }

  try {
    const { evmAddress } = await req.json();

    if (!evmAddress || typeof evmAddress !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(evmAddress)) {
      return NextResponse.json({ error: 'Invalid EVM address' }, { status: 400 });
    }

    const { error } = await supabase
      .from('users')
      .update({ evm_wallet_address: evmAddress })
      .eq('email', auth.email);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Mint fUSDC to the user's embedded wallet on Base Sepolia (demo funding)
    let mintTxHash: string | undefined;
    const mockUsdcAddress = process.env.MOCK_USDC_BASE_ADDRESS;
    const serverWalletId = process.env.DYNAMIC_SERVER_WALLET_ID;
    if (mockUsdcAddress && serverWalletId) {
      try {
        const { serverWalletSignTransaction } = await import('@/lib/dynamic-server');
        const { encodeFunctionData } = await import('viem');
        // Mint 1,000 fUSDC to the new user's embedded wallet
        const mintData = encodeFunctionData({
          abi: [{ name: 'mint', type: 'function', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [] }],
          functionName: 'mint',
          args: [evmAddress as `0x${string}`, BigInt(25_000_000)], // 25 USDC (6 decimals)
        });
        mintTxHash = await serverWalletSignTransaction(serverWalletId, {
          to: mockUsdcAddress,
          value: '0',
          data: mintData,
          chainId: 84532, // Base Sepolia
        });
      } catch (mintErr) {
        // Non-blocking — user can still use the app without Base USDC
        console.error('fUSDC mint to user failed (non-blocking):', mintErr);
      }
    }

    return NextResponse.json({ success: true, mintTxHash });
  } catch (error) {
    console.error('Store EVM wallet error:', error);
    return NextResponse.json(
      { error: 'Failed to store EVM wallet address' },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth.authenticated) {
    return unauthorized(auth.error);
  }

  try {
    const { data, error } = await supabase
      .from('users')
      .select('evm_wallet_address')
      .eq('email', auth.email)
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ evmAddress: data?.evm_wallet_address || null });
  } catch (error) {
    console.error('Fetch EVM wallet error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch EVM wallet address' },
      { status: 500 }
    );
  }
}
