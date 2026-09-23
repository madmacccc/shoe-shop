import {
  collection,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  query,
  where,
} from 'firebase/firestore'

import { db } from './firebase'

export const PRODUCT_STATUS = ['active', 'inactive']
export const USER_ROLES = ['owner', 'staff']

export const userConverter = {
  toFirestore(user) {
    return {
      ...user,
      updatedAt: serverTimestamp(),
    }
  },
  fromFirestore(snapshot) {
    const data = snapshot.data()
    return {
      id: snapshot.id,
      ...data,
      createdAt: data.createdAt?.toDate?.() ?? data.createdAt ?? null,
      updatedAt: data.updatedAt?.toDate?.() ?? data.updatedAt ?? null,
    }
  },
}

export const productConverter = {
  toFirestore(product) {
    return {
      ...product,
      updatedAt: serverTimestamp(),
    }
  },
  fromFirestore(snapshot) {
    const data = snapshot.data()
    return {
      id: snapshot.id,
      ...data,
      createdAt: data.createdAt?.toDate?.() ?? data.createdAt ?? null,
      updatedAt: data.updatedAt?.toDate?.() ?? data.updatedAt ?? null,
    }
  },
}

export const publicProductConverter = {
  toFirestore(product) {
    return {
      ...product,
      updatedAt: serverTimestamp(),
    }
  },
  fromFirestore(snapshot) {
    const data = snapshot.data()
    return {
      id: snapshot.id,
      ...data,
      createdAt: data.createdAt?.toDate?.() ?? data.createdAt ?? null,
      updatedAt: data.updatedAt?.toDate?.() ?? data.updatedAt ?? null,
    }
  },
}

export const saleConverter = {
  toFirestore(sale) {
    return {
      ...sale,
      createdAt: sale.createdAt ?? serverTimestamp(),
    }
  },
  fromFirestore(snapshot) {
    const data = snapshot.data()
    return {
      id: snapshot.id,
      ...data,
      createdAt: data.createdAt?.toDate?.() ?? data.createdAt ?? null,
    }
  },
}

export const inventoryTransactionConverter = {
  toFirestore(entry) {
    return {
      ...entry,
      createdAt: entry.createdAt ?? serverTimestamp(),
    }
  },
  fromFirestore(snapshot) {
    const data = snapshot.data()
    return {
      id: snapshot.id,
      ...data,
      createdAt: data.createdAt?.toDate?.() ?? data.createdAt ?? null,
    }
  },
}

export function toCurrency(value) {
  return Number(value || 0).toFixed(2)
}

export function buildPublicProductPayload(product) {
  const colors = [...new Set((product.variants || []).map((variant) => variant.color).filter(Boolean))]
  const sizes = [...new Set((product.variants || []).map((variant) => variant.size).filter(Boolean))]

  const availability = {}
  for (const variant of product.variants || []) {
    availability[`${variant.color}::${variant.size}`] = Number(variant.stock || 0) > 0
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

export async function getPublicProduct(productId) {
  const ref = doc(db, 'publicProducts', productId).withConverter(publicProductConverter)
  const snapshot = await getDoc(ref)
  return snapshot.exists() ? snapshot.data() : null
}

export async function createSaleTransaction({
  productId,
  variantId,
  qty,
  unitPrice,
  taxAmount,
  paymentMethod,
  staffId,
  customerId = null,
  invoiceNo,
}) {
  if (!productId || !variantId || Number(qty) <= 0) {
    throw new Error('Invalid sale payload.')
  }

  const productRef = doc(db, 'products', productId).withConverter(productConverter)
  const publicProductRef = doc(db, 'publicProducts', productId).withConverter(publicProductConverter)
  const saleRef = doc(collection(db, 'sales'))
  const inventoryRef = doc(collection(db, 'inventoryTransactions'))

  return runTransaction(db, async (transaction) => {
    const productSnapshot = await transaction.get(productRef)
    if (!productSnapshot.exists()) {
      throw new Error('Product not found.')
    }

    const product = productSnapshot.data()
    const selectedVariant = (product.variants || []).find((variant) => variant.id === variantId)

    if (!selectedVariant) {
      throw new Error('Selected variant was not found.')
    }

    if (Number(selectedVariant.stock || 0) < Number(qty)) {
      throw new Error(`Insufficient stock for ${selectedVariant.color} / ${selectedVariant.size}.`)
    }

    const productGross = Number(unitPrice || product.sellingPrice || 0) * Number(qty)
    const lineTax = Number(taxAmount || 0)
    const total = Number((productGross + lineTax).toFixed(2))

    const nextVariantStock = Number(selectedVariant.stock || 0) - Number(qty)
    const nextSoldCount = Number(selectedVariant.sold || 0) + Number(qty)

    const updatedVariants = (product.variants || []).map((variant) =>
      variant.id === variantId
        ? {
            ...variant,
            stock: nextVariantStock,
            sold: nextSoldCount,
          }
        : variant,
    )

    const saleRecord = {
      id: saleRef.id,
      invoiceNo: invoiceNo || `INV-${Date.now()}`,
      lineItems: [
        {
          productId,
          variantId,
          color: selectedVariant.color,
          size: selectedVariant.size,
          price: Number(unitPrice || product.sellingPrice || 0),
          costPrice: Number(product.costPrice || 0),
          qty: Number(qty),
          taxAmount: Number(lineTax),
        },
      ],
      total,
      taxTotal: Number(lineTax),
      paymentMethod: paymentMethod || 'cash',
      staffId: staffId || 'system',
      customerId: customerId || null,
      createdAt: serverTimestamp(),
    }

    const inventoryEntry = {
      id: inventoryRef.id,
      variantId,
      productId,
      type: 'sale',
      delta: -Number(qty),
      beforeStock: Number(selectedVariant.stock || 0),
      afterStock: nextVariantStock,
      reason: 'Point-of-sale sale',
      userId: staffId || 'system',
      createdAt: serverTimestamp(),
    }

    transaction.update(productRef, {
      variants: updatedVariants,
      updatedAt: serverTimestamp(),
    })

    const publicProductSnapshot = await transaction.get(publicProductRef)
    if (publicProductSnapshot.exists()) {
      const publicProduct = publicProductSnapshot.data()
      const nextAvailability = { ...publicProduct.availability }
      const variantKey = `${selectedVariant.color}::${selectedVariant.size}`
      nextAvailability[variantKey] = nextVariantStock > 0

      transaction.update(publicProductRef, {
        availability: nextAvailability,
        updatedAt: serverTimestamp(),
      })
    }

    transaction.set(saleRef, saleRecord)
    transaction.set(inventoryRef, inventoryEntry)

    return { id: saleRef.id, ...saleRecord }
  })
}

export async function getAllUsers() {
  const usersRef = collection(db, 'users').withConverter(userConverter)
  const snapshot = await getDocs(usersRef)
  return snapshot.docs.map((docSnapshot) => docSnapshot.data())
}

export async function getUserProfile(uid) {
  const ref = doc(db, 'users', uid).withConverter(userConverter)
  const snapshot = await getDoc(ref)
  return snapshot.exists() ? snapshot.data() : null
}

export async function createUserProfile(user) {
  const ref = doc(db, 'users', user.uid).withConverter(userConverter)
  await setDoc(ref, user)
  return user
}

export async function writeInventoryAdjustment({
  productId,
  variantId,
  type,
  delta,
  reason,
  userId,
}) {
  const productRef = doc(db, 'products', productId).withConverter(productConverter)

  await runTransaction(db, async (transaction) => {
    const productSnapshot = await transaction.get(productRef)
    if (!productSnapshot.exists()) {
      throw new Error('Product not found.')
    }

    const product = productSnapshot.data()
    const variant = (product.variants || []).find((item) => item.id === variantId)
    if (!variant) {
      throw new Error('Variant not found.')
    }

    const beforeStock = Number(variant.stock || 0)
    const afterStock = beforeStock + Number(delta)
    if (afterStock < 0) {
      throw new Error('Inventory adjustment cannot create negative stock.')
    }

    const updatedVariants = (product.variants || []).map((item) =>
      item.id === variantId
        ? {
            ...item,
            stock: afterStock,
          }
        : item,
    )

    const ledgerRef = doc(collection(db, 'inventoryTransactions'))
    transaction.update(productRef, {
      variants: updatedVariants,
      updatedAt: serverTimestamp(),
    })
    transaction.set(ledgerRef, {
      id: ledgerRef.id,
      variantId,
      productId,
      type,
      delta: Number(delta),
      beforeStock,
      afterStock,
      reason,
      userId,
      createdAt: serverTimestamp(),
    })
  })
}

export async function syncPublicProduct(product) {
  const ref = doc(db, 'publicProducts', product.id).withConverter(publicProductConverter)
  await setDoc(ref, buildPublicProductPayload(product), { merge: true })
  return buildPublicProductPayload(product)
}
