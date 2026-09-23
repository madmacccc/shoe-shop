import { get, ref, set } from 'firebase/database'

import { database, firebaseIsConfigured } from './firebase'

export const STORAGE_KEY = 'shoe-shop-local-data-v1'

const defaultSettings = {
  shopName: 'Shoe Shop',
  gstNumber: '',
  currency: 'INR',
  lowStockThreshold: 5,
  invoicePrefix: 'INV',
  theme: 'pleasant',
  accentColor: '#10b981',
  developerName: 'Store Admin',
}

function createUniqueUnitId(existingUnits = []) {
  const used = new Set((existingUnits || []).map((unit) => String(unit.id || '')))
  let candidate = `UNIT-${String(Date.now()).slice(-8)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
  let counter = 1

  while (used.has(candidate)) {
    candidate = `UNIT-${String(Date.now()).slice(-8)}-${counter.toString().padStart(4, '0')}`
    counter += 1
  }

  return candidate
}

function createUniqueUnitQr(existingUnits = []) {
  const used = new Set((existingUnits || []).map((unit) => String(unit.qrCode || '')))
  let candidate = `shoe-shop://product/unit/${String(Date.now()).slice(-10)}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`
  let counter = 1

  while (used.has(candidate)) {
    candidate = `shoe-shop://product/unit/${String(Date.now()).slice(-10)}-${counter.toString().padStart(4, '0')}`
    counter += 1
  }

  return candidate
}

function createUniqueUnitBarcode(existingUnits = []) {
  const used = new Set((existingUnits || []).map((unit) => String(unit.barcode || '')))
  let candidate = `B${String(Date.now()).slice(-10)}${Math.random().toString(36).slice(2, 5).toUpperCase()}`
  let counter = 1

  while (used.has(candidate)) {
    candidate = `B${String(Date.now()).slice(-10)}${counter.toString().padStart(4, '0')}`
    counter += 1
  }

  return candidate
}

export function createProductUnitsForStock(productId, existingUnits = [], stockCount = 0) {
  const safeUnits = Array.isArray(existingUnits) ? existingUnits : []
  const normalized = safeUnits.map((unit, index) => ({
    id: String(unit.id || `UNIT-${index + 1}`),
    productId: unit.productId || productId,
    qrCode: unit.qrCode || createUniqueUnitQr(safeUnits),
    barcode: unit.barcode || createUniqueUnitBarcode(safeUnits),
    status: unit.status === 'sold' ? 'sold' : 'available',
    createdAt: unit.createdAt || new Date().toISOString(),
    soldAt: unit.soldAt || null,
    saleId: unit.saleId || null,
  }))

  if (Number(stockCount || 0) <= 0) return []

  const nextUnits = [...normalized]
  while (nextUnits.length < Number(stockCount || 0)) {
    nextUnits.push({
      id: createUniqueUnitId(nextUnits),
      productId,
      qrCode: createUniqueUnitQr(nextUnits),
      barcode: createUniqueUnitBarcode(nextUnits),
      status: 'available',
      createdAt: new Date().toISOString(),
      soldAt: null,
      saleId: null,
    })
  }

  return nextUnits.slice(0, Number(stockCount || 0))
}

export function normalizeProductUnits(product) {
  if (!product) return product

  const safeUnits = Array.isArray(product.units) ? product.units : []
  const normalizedUnits = safeUnits.map((unit, index) => ({
    id: String(unit.id || `UNIT-${index + 1}`),
    productId: unit.productId || product.id,
    qrCode: unit.qrCode || createUniqueUnitQr(safeUnits),
    barcode: unit.barcode || createUniqueUnitBarcode(safeUnits),
    status: unit.status === 'sold' ? 'sold' : 'available',
    createdAt: unit.createdAt || new Date().toISOString(),
    soldAt: unit.soldAt || null,
    saleId: unit.saleId || null,
  }))

  if (normalizedUnits.length) {
    return { ...product, units: normalizedUnits }
  }

  const legacyStock = Array.isArray(product.variants)
    ? product.variants.reduce((sum, variant) => sum + Number(variant.stock || 0), 0)
    : 0

  if (legacyStock > 0) {
    return { ...product, units: createProductUnitsForStock(product.id, [], legacyStock) }
  }

  return { ...product, units: [] }
}

export function createDefaultStorageData() {
  return {
    products: [],
    publicProducts: [],
    sales: [],
    inventoryTransactions: [],
    settings: { ...defaultSettings },
  }
}

export function buildPublicProduct(product) {
  if (!product) return null

  const colors = [...new Set((product.variants || []).map((variant) => variant.color).filter(Boolean))]
  const sizes = [...new Set((product.variants || []).map((variant) => variant.size).filter(Boolean))]

  const availability = {}
  for (const variant of product.variants || []) {
    const key = `${variant.color || 'default'}::${variant.size || 'default'}`
    const unitCount = Array.isArray(product.units)
      ? product.units.filter((unit) => unit.status !== 'sold').length
      : Number(variant.stock || 0)
    availability[key] = Number(unitCount || 0) > 0
  }

  return {
    id: product.id,
    name: product.name,
    brand: product.brand,
    images: product.images || [],
    sellingPrice: Number(product.sellingPrice || 0),
    MRP: Number(product.MRP || 0),
    discount: Number(product.discount || 0),
    colors,
    sizes,
    availability,
    status: product.status === 'active' ? 'active' : 'inactive',
  }
}

export function syncPublicProducts(data) {
  const safeData = data || createDefaultStorageData()
  const products = Array.isArray(safeData.products) ? safeData.products.map((product) => normalizeProductUnits(product)) : []
  const publicProducts = Array.isArray(safeData.publicProducts) ? safeData.publicProducts : []
  const byId = new Map(publicProducts.map((item) => [item.id, item]))

  const nextPublicProducts = products.map((product) => {
    const existing = byId.get(product.id)
    const nextProduct = buildPublicProduct(product)
    if (!existing) return nextProduct
    return { ...existing, ...nextProduct, id: product.id }
  })

  return {
    ...safeData,
    products,
    publicProducts: nextPublicProducts,
  }
}

export async function getRemoteData() {
  const defaults = syncPublicProducts(createDefaultStorageData())

  if (!firebaseIsConfigured || !database) {
    return defaults
  }

  try {
    const appDataRef = ref(database, 'appData')
    const snapshot = await get(appDataRef)

    if (!snapshot.exists()) {
      return defaults
    }

    const value = snapshot.val() || {}
    const merged = {
      ...defaults,
      ...value,
      settings: {
        ...defaults.settings,
        ...(value.settings || {}),
      },
    }

    return syncPublicProducts(merged)
  } catch (error) {
    console.warn('Realtime Database fetch failed, using default app state.', error)
    return defaults
  }
}

export async function saveRemoteData(data) {
  if (!firebaseIsConfigured || !database) {
    return
  }

  try {
    const synced = syncPublicProducts(data)
    const appDataRef = ref(database, 'appData')
    await set(appDataRef, synced)
  } catch (error) {
    console.warn('Realtime Database save failed.', error)
  }
}

