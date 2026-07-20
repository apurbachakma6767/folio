-- Allow processing status for auto-confirm pipeline
ALTER TABLE public.broker_orders DROP CONSTRAINT IF EXISTS broker_orders_status_check;
ALTER TABLE public.broker_orders ADD CONSTRAINT broker_orders_status_check
  CHECK (status IN ('pending', 'processing', 'filled', 'cancelled', 'failed'));
