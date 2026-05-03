import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { decryptWebhookPayload } from '@/lib/dynamic-delegation';
import { supabase } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();

    // Verify HMAC signature
    const signature = req.headers.get('x-dynamic-signature-256');
    if (!signature) {
      return NextResponse.json({ error: 'Missing signature' }, { status: 401 });
    }

    const secret = process.env.DYNAMIC_WEBHOOK_SECRET;
    if (!secret) {
      return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
    }
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    const sigBuffer = Buffer.from(signature, 'utf-8');
    const expectedBuffer = Buffer.from(expectedSignature, 'utf-8');
    if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    // Parse payload
    const body = JSON.parse(rawBody);
    const email = body?.data?.user?.email;
    const userId = body?.data?.user?.id;

    if (!email) {
      return NextResponse.json(
        { error: 'Missing user email in webhook payload' },
        { status: 400 },
      );
    }

    // Decrypt delegation credentials
    const encryptedData = body?.data?.encryptedCredentials;
    if (!encryptedData) {
      return NextResponse.json(
        { error: 'Missing encrypted credentials in payload' },
        { status: 400 },
      );
    }

    const { walletId, walletApiKey, keyShare } = decryptWebhookPayload(encryptedData);

    // Store delegation credentials in Supabase
    const { error: updateError } = await supabase
      .from('users')
      .update({
        delegation_wallet_id: walletId,
        delegation_api_key: walletApiKey,
        delegation_key_share: keyShare,
      })
      .eq('email', email);

    if (updateError) {
      console.error('Failed to store delegation credentials:', updateError);
      return NextResponse.json(
        { error: 'Failed to store delegation credentials' },
        { status: 500 },
      );
    }

    console.log(`Delegation credentials stored for user ${userId} (${email})`);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delegation webhook error:', error);
    return NextResponse.json(
      {
        error: 'Webhook processing failed',
      },
      { status: 500 },
    );
  }
}
