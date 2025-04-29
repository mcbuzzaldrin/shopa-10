// lib/context.js
import React, { createContext, useContext, useEffect, useState } from 'react'
import { Base64 } from 'base64-string'

// get our API clients (shopify + sanity)
import { getSanityClient } from '@lib/sanity'
import shopify from '@lib/shopify'

// get our global image GROQ
import { queries } from '@data'

// Set our initial context states
const initialContext = {
  isPageTransition: false,
  meganav: { isOpen: false, activeID: null },
  productCounts: [],
  shopifyClient: shopify,
  isLoading: true,
  isAdding: false,
  isUpdating: false,
  isCartOpen: false,
  checkout: { id: null, lineItems: [], subTotal: 0, webUrl: '' },
}

const SiteContext = createContext({
  context: initialContext,
  setContext: () => {},
})

// ——— Helpers to build/fetch Shopify checkouts ———

const createNewCheckout = (ctx) =>
  ctx.shopifyClient?.checkout.create({ presentmentCurrencyCode: 'USD' })

const fetchCheckout = (ctx, id) =>
  ctx.shopifyClient?.checkout.fetch(id)

/**
 * Fetch a single productVariant by its Shopify variantID
 * (with cartPhotos pulled in)
 */
async function fetchVariant(variantID) {
  const groq = `
    *[_type == "productVariant" && variantID == $variantID][0]{
      // join back to the parent product
      "product": *[_type == "product" && productID == ^.productID][0]{
        title,
        "slug": slug.current
      },
      "id": variantID,
      title,
      price,
      comparePrice,
      inStock,
      lowStock,
      options[]{ name, position, value },
      // pull in your cart‐photo metadata
      "photos": {
        "cart": *[_type == "product" && productID == ^.productID][0]
          .cartPhotos[]{
            forOption,
            "default": cartPhoto{
              ${queries.imageMeta}
            }
          }
      }
    }
  `
  return getSanityClient().fetch(groq, { variantID: Number(variantID) })
}

async function setCheckoutState(checkout, setContext, openCart) {
  if (!checkout) return
  if (typeof window !== 'undefined') {
    localStorage.setItem('shopify_checkout_id', checkout.id)
  }

  // hydrate lineItems with Sanity data
  const lineItems = await Promise.all(
    checkout.lineItems.map(async (item) => {
      const variantID = item.variant.id.split(
        'gid://shopify/ProductVariant/'
      )[1]
      const v = await fetchVariant(variantID)
      return { ...v, quantity: item.quantity, lineID: item.id }
    })
  )

  // ✂️ new: convert the MoneyV2 amount into integer cents
  const subtotalCents = Math.round(
    parseFloat(checkout.lineItemsSubtotalPrice.amount) * 100
  )

  setContext((cs) => ({
    ...cs,
    isAdding: false,
    isLoading: false,
    isUpdating: false,
    isCartOpen: openCart ? true : cs.isCartOpen,
    checkout: {
      id: checkout.id,
      lineItems,
      subTotal: subtotalCents,
      webUrl: checkout.webUrl,
    },
  }))
}

// ——— Provider ———

export function SiteContextProvider({ data, children }) {
  const [ctx, setCtx] = useState({
    ...initialContext,
    productCounts: data.productCounts,
  })
  const [started, setStarted] = useState(false)

  useEffect(() => {
    if (started) return
    setStarted(true)

    const init = async () => {
      const stored = localStorage.getItem('shopify_checkout_id')
      if (stored) {
        try {
          const existing = await fetchCheckout(ctx, stored)
          if (!existing.completedAt) {
            return setCheckoutState(existing, setCtx, false)
          }
        } catch (e) {
          console.warn('Existing checkout fetch failed, creating new one')
        }
      }
      const fresh = await createNewCheckout(ctx)
      setCheckoutState(fresh, setCtx, false)
    }
    init()
  }, [started, ctx])

  return (
    <SiteContext.Provider value={{ context: ctx, setContext: setCtx }}>
      {children}
    </SiteContext.Provider>
  )
}

// ——— Core hook to read full context ———

export function useSiteContext() {
  return useContext(SiteContext).context
}

// ——— Page / Mega‐nav toggles ———

export function useTogglePageTransition() {
  const {
    context: { isPageTransition },
    setContext,
  } = useContext(SiteContext)
  return (state) => setContext((cs) => ({ ...cs, isPageTransition: state }))
}

export function useToggleMegaNav() {
  const {
    context: { meganav },
    setContext,
  } = useContext(SiteContext)
  return (state, id = null) =>
    setContext((cs) => ({
      ...cs,
      meganav: {
        isOpen: state === 'toggle' ? !meganav.isOpen : state,
        activeID: state === 'toggle' && meganav.isOpen ? null : id,
      },
    }))
}

// ——— Collection counts ———

export function useProductCount() {
  const {
    context: { productCounts },
  } = useContext(SiteContext)
  return (slug) => {
    const found = productCounts.find((c) => c.slug === slug)
    return found ? found.count : 0
  }
}

// ——— Cart & checkout hooks ———

export function useCartCount() {
  const {
    context: { checkout },
  } = useContext(SiteContext)
  return checkout.lineItems?.reduce((sum, i) => sum + i.quantity, 0) || 0
}

export function useCartTotals() {
  const {
    context: { checkout },
  } = useContext(SiteContext)

  // ✂️ no more `* 100` here— it's already in cents
  return { subTotal: checkout.subTotal || 0 }
}

export function useCartItems() {
  return useContext(SiteContext).context.checkout.lineItems
}

export function useAddItem() {
  const {
    context: { checkout, shopifyClient },
    setContext,
  } = useContext(SiteContext)

  return async (variantID, qty, attrs) => {
    setContext((cs) => ({ ...cs, isAdding: true, isUpdating: true }))
    const enc = new Base64().urlEncode(
      `gid://shopify/ProductVariant/${variantID}`
    )
    const newC = await shopifyClient.checkout.addLineItems(checkout.id, {
      variantId: enc,
      quantity: qty,
      customAttributes: attrs,
    })
    setCheckoutState(newC, setContext, true)
  }
}

export function useUpdateItem() {
  const {
    context: { checkout, shopifyClient },
    setContext,
  } = useContext(SiteContext)

  return async (lineID, qty) => {
    setContext((cs) => ({ ...cs, isUpdating: true }))
    const newC = await shopifyClient.checkout.updateLineItems(checkout.id, [
      { id: lineID, quantity: qty },
    ])
    setCheckoutState(newC, setContext, false)
  }
}

export function useRemoveItem() {
  const {
    context: { checkout, shopifyClient },
    setContext,
  } = useContext(SiteContext)

  return async (lineID) => {
    setContext((cs) => ({ ...cs, isUpdating: true }))
    const newC = await shopifyClient.checkout.removeLineItems(checkout.id, [
      lineID,
    ])
    setCheckoutState(newC, setContext, false)
  }
}

export function useCheckout() {
  return useContext(SiteContext).context.checkout.webUrl
}

export function useToggleCart() {
  const {
    context: { isCartOpen },
    setContext,
  } = useContext(SiteContext)
  return () => setContext((cs) => ({ ...cs, isCartOpen: !isCartOpen }))
}
