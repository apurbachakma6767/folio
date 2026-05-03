import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, unauthorized } from '@/lib/auth';

// POST /api/ai/agent — autonomous Hedera AI agent endpoint
// The agent uses MiniMax M1 + Hedera Agent Kit to execute on-chain operations
// via natural language. Qualifies for Hedera AI & Agentic Payments bounty.
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth.authenticated) return unauthorized(auth.error);

  try {
    const { prompt, action } = await req.json();

    if (!prompt && !action) {
      return NextResponse.json({ error: 'prompt or action required' }, { status: 400 });
    }

    const { runAgent } = await import('@/lib/hedera-agent');

    // Build the agent prompt from either freeform or structured action
    let agentPrompt: string;
    if (action) {
      // Structured actions from the frontend
      switch (action.type) {
        case 'check-balance':
          agentPrompt = `Check the token balances for account ${action.accountId}. List all tokens with their balances.`;
          break;
        case 'audit-log':
          agentPrompt = `Submit an audit message to the HCS topic with the following data: ${JSON.stringify(action.data)}`;
          break;
        case 'analyze-collar':
          agentPrompt = `Analyze a collar position for ${action.symbol}: the user wants to spend $${action.amount} against their shares at the current price of $${action.stockPrice}. Check the treasury USDC balance to confirm we can fund this advance, then recommend if the position looks safe.`;
          break;
        default:
          agentPrompt = prompt || `Execute this action: ${JSON.stringify(action)}`;
      }
    } else {
      agentPrompt = prompt;
    }

    const result = await runAgent(agentPrompt);

    return NextResponse.json({
      response: result.text,
      toolCalls: result.toolCalls,
      agent: 'hedera-ai-agent-kit + minimax-m1',
    });
  } catch (error) {
    console.error('AI agent error:', error);
    return NextResponse.json(
      { error: 'Agent failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
