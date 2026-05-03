// Hedera AI Agent — autonomous agent that executes Hedera operations via LLM tool calling
//
// Uses the Hedera Agent Kit with MiniMax M1 as the LLM backbone via Vercel AI SDK.
// The agent can autonomously check balances, transfer tokens, mint NFTs,
// and submit HCS audit messages — qualifying for the AI & Agentic Payments bounty.

import {
  HederaAIToolkit,
  AgentMode,
  coreTokenPluginToolNames,
  coreTokenQueryPluginToolNames,
  coreConsensusPluginToolNames,
  coreAccountQueryPluginToolNames,
} from 'hedera-agent-kit';
import { Client, PrivateKey } from '@hashgraph/sdk';

// Relevant tool names for Folio's use case (scoped to what the agent needs)
const FOLIO_TOOLS = [
  // Token transfers (collateral lock, USDC advance, repayment)
  coreTokenPluginToolNames.MINT_FUNGIBLE_TOKEN_TOOL,
  coreTokenPluginToolNames.MINT_NON_FUNGIBLE_TOKEN_TOOL,
  coreTokenPluginToolNames.TRANSFER_FUNGIBLE_TOKEN_WITH_ALLOWANCE_TOOL,
  coreTokenPluginToolNames.ASSOCIATE_TOKEN_TOOL,
  // Token queries (balance checks)
  coreTokenQueryPluginToolNames.GET_TOKEN_INFO_QUERY_TOOL,
  // Account queries (balance, info)
  coreAccountQueryPluginToolNames.GET_HBAR_BALANCE_QUERY_TOOL,
  coreAccountQueryPluginToolNames.GET_ACCOUNT_TOKEN_BALANCES_QUERY_TOOL,
  // HCS audit logging
  coreConsensusPluginToolNames.SUBMIT_TOPIC_MESSAGE_TOOL,
];

let toolkitInstance: HederaAIToolkit | null = null;

export function getHederaAgentToolkit(): HederaAIToolkit | null {
  if (toolkitInstance) return toolkitInstance;

  const operatorId = process.env.HEDERA_OPERATOR_ID;
  const operatorKey = process.env.HEDERA_OPERATOR_KEY;
  if (!operatorId || !operatorKey) return null;

  const client = Client.forTestnet().setOperator(operatorId, PrivateKey.fromStringDer(operatorKey));

  toolkitInstance = new HederaAIToolkit({
    // @hashgraph/sdk version mismatch between project and hedera-agent-kit bundle
    client: client as unknown as ConstructorParameters<typeof HederaAIToolkit>[0]['client'],
    configuration: {
      tools: FOLIO_TOOLS,
      plugins: [],
      context: {
        mode: AgentMode.AUTONOMOUS,
      },
    },
  });

  return toolkitInstance;
}

/** System prompt that gives the agent Folio-specific context */
export function getFolioAgentSystemPrompt(): string {
  const tokenInfo = [
    process.env.MOCK_TSLA_TOKEN_ID ? `MOCK-TSLA token: ${process.env.MOCK_TSLA_TOKEN_ID}` : null,
    process.env.MOCK_AAPL_TOKEN_ID ? `MOCK-AAPL token: ${process.env.MOCK_AAPL_TOKEN_ID}` : null,
    process.env.USDC_TEST_TOKEN_ID ? `USDC-TEST token: ${process.env.USDC_TEST_TOKEN_ID}` : null,
    process.env.SPEND_NOTE_TOKEN_ID ? `Spend Note NFT token: ${process.env.SPEND_NOTE_TOKEN_ID}` : null,
    process.env.AUDIT_TOPIC_ID ? `HCS Audit Topic: ${process.env.AUDIT_TOPIC_ID}` : null,
    process.env.HEDERA_OPERATOR_ID ? `Treasury/Operator account: ${process.env.HEDERA_OPERATOR_ID}` : null,
  ].filter(Boolean).join('\n');

  return `You are Folio's AI financial agent operating on Hedera Testnet. You autonomously manage collateralized lending operations.

FOLIO CONTEXT:
Folio lets users borrow against their stock portfolio at 0% interest using zero-cost equity collars on Hedera Token Service. When a user "spends" against their shares, the system:
1. Locks their tokenized shares (MOCK-TSLA, MOCK-AAPL) as collateral
2. Advances USDC-TEST to the user or a recipient
3. Mints an NFT Spend Note as an on-chain receipt
4. Logs the transaction to HCS for immutable audit trail

HEDERA TOKEN IDS:
${tokenInfo}

YOUR CAPABILITIES:
- Check token balances for any account
- Transfer fungible tokens (USDC, stock tokens) between accounts
- Mint NFTs (Spend Notes)
- Submit audit messages to HCS topics
- Query account and token information

RULES:
- Always verify balances before executing transfers
- Log all material actions to the HCS audit topic
- Be precise with token amounts (USDC uses 6 decimals, stock tokens use 6 decimals)
- When transferring, specify exact token IDs from the list above
- Report results clearly with transaction IDs`;
}

/**
 * Run the Hedera AI agent with a user prompt.
 * Uses MiniMax M1 via Vercel AI SDK with Hedera Agent Kit tools.
 */
export async function runAgent(userPrompt: string): Promise<{
  text: string;
  toolCalls: Array<{ tool: string; args: Record<string, unknown>; result: unknown }>;
}> {
  const toolkit = getHederaAgentToolkit();
  if (!toolkit) {
    throw new Error('Hedera not configured — set HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY');
  }

  if (!process.env.MINIMAX_API_KEY) {
    throw new Error('MiniMax API key not configured');
  }

  const { generateText, stepCountIs } = await import('ai');
  const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible');

  const minimax = createOpenAICompatible({
    name: 'minimax',
    baseURL: 'https://api.minimax.io/v1',
    apiKey: process.env.MINIMAX_API_KEY,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools = toolkit.getTools() as any;
  const systemPrompt = getFolioAgentSystemPrompt();

  const result = await generateText({
    model: minimax('MiniMax-M1'),
    system: systemPrompt,
    prompt: userPrompt,
    tools,
    stopWhen: stepCountIs(10),
  });

  // Extract tool calls from all steps
  const allToolCalls: Array<{ tool: string; args: Record<string, unknown>; result: unknown }> = [];
  for (const step of result.steps) {
    for (const call of step.toolCalls ?? []) {
      const matchingResult = (step.toolResults ?? []).find(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (r: any) => r.toolCallId === call.toolCallId
      );
      allToolCalls.push({
        tool: call.toolName,
        /* eslint-disable @typescript-eslint/no-explicit-any */
        args: (call as any).args ?? {},
        result: matchingResult ? (matchingResult as any).result : null,
        /* eslint-enable @typescript-eslint/no-explicit-any */
      });
    }
  }

  return { text: result.text, toolCalls: allToolCalls };
}
