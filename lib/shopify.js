// lib/shopify.js
// ———————————————————————————————————————————————————————————————
// Shopify “Storefront” client for your React components
// ———————————————————————————————————————————————————————————————

import Client from 'shopify-buy'
import { isBrowser } from '@lib/helpers'

// These two must match your .env names exactly:
const STORE_DOMAIN = process.env.NEXT_PUBLIC_SHOPIFY_STORE_ID        // e.g. "my-store"
const STOREFRONT_TOKEN = process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN

const hasShopify = STORE_DOMAIN && STOREFRONT_TOKEN

if (!hasShopify && isBrowser) {
  console.warn('⚠️  Shopify .env variables are missing or mis-named')
}

const domain = STORE_DOMAIN.includes('.myshopify.com')
  ? STORE_DOMAIN
  : `${STORE_DOMAIN}.myshopify.com`

const clientOptions = {
  domain,
  storefrontAccessToken: STOREFRONT_TOKEN,
}

export default hasShopify ? Client.buildClient(clientOptions) : null

