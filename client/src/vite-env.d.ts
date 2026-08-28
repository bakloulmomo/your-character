/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Chiave pubblicabile Stripe. Se assente, il pagamento con carta non viene offerto. */
  readonly VITE_STRIPE_PUBLISHABLE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
